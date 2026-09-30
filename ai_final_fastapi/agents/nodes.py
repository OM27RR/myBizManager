"""
agents/nodes.py
==================

One function per box in the diagram. Every node except
recommendation_agent is pure tool orchestration through mcp_client —
none of them touch MongoDB or an external API directly, matching Step 4
of the architecture doc.

Each node takes the full AgentState and returns a PARTIAL dict of the
keys it changed (standard LangGraph node contract) — it does not mutate
or return the full state.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from langgraph.types import interrupt

from mcp_service.client import MCPToolError, mcp_client
from mcp_service.common import log_agent_action

from .prompts import (
    RECOMMENDATION_SYSTEM_PROMPT,
    build_recommendation_user_prompt,
)
from .state import AgentState, SupplierOption

# Loaded here so this module works correctly even if run standalone
load_dotenv()

logger = logging.getLogger("agents.nodes")


# ---------------------------------------------------------------------------
# [StockRiskDetected]
# ---------------------------------------------------------------------------

async def stock_risk_detected(state: AgentState) -> dict[str, Any]:
    """
    Entry node. Validates that whoever triggered the graph handed over 
    the minimum required signal.
    """
    missing = [k for k in ("item_id", "owner_id") if not state.get(k)]
    if missing:
        return {
            "status": "error",
            "error": f"stock_risk_detected: missing required state field(s): {missing}",
        }
    return {
        "status": "pending_approval",
        "trigger_reason": state.get(
            "trigger_reason",
            f"Item {state['item_id']} projected to stock out in "
            f"{state.get('days_to_stockout', 'an unknown number of')} days",
        ),
    }


# ---------------------------------------------------------------------------
# [SupplierLookupAgent]
# ---------------------------------------------------------------------------

async def supplier_lookup_agent(state: AgentState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    tool_args = {"item_id": state["item_id"]}
    if state.get("owner_id"):
        tool_args["owner_id"] = state["owner_id"]

    try:
        result = await mcp_client.call_tool(
            "suppliers", "get_suppliers_for_item", tool_args
        )
    except MCPToolError as exc:
        return {"status": "error", "error": f"supplier_lookup_agent: {exc}"}

    suppliers = result.get("suppliers", [])

    # Escalation runs (after a supplier rejected / went out of stock) pass
    # in every supplier already tried for this item so RecommendationAgent
    # can only ever pick a fresh one — see state.py::excluded_supplier_ids.
    excluded = {str(sid) for sid in (state.get("excluded_supplier_ids") or [])}
    if excluded:
        suppliers = [s for s in suppliers if str(s.get("supplier_id")) not in excluded]

    if not suppliers:
        return {
            "suppliers": [],
            "status": "error",
            "error": "supplier_lookup_agent: no suppliers left to try for this item",
        }

    return {"suppliers": suppliers}


# ---------------------------------------------------------------------------
# [PriceComparisonAgent]
# ---------------------------------------------------------------------------

async def price_comparison_agent(state: AgentState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    suppliers = state.get("suppliers") or []
    if not suppliers:
        return {"status": "error", "error": "price_comparison_agent: no suppliers to compare prices for"}

    price_signals: dict[str, Any] = {}
    for supplier in suppliers:
        supplier_id = supplier.get("supplier_id")
        if not supplier_id:
            continue
        try:
            price_signals[supplier_id] = await mcp_client.call_tool(
                "suppliers",
                "get_price_history",
                {"supplier_id": supplier_id, "item_id": state["item_id"]},
            )
        except MCPToolError as exc:
            logger.warning("price_comparison_agent: %s", exc)
            price_signals[supplier_id] = {"history": [], "percent_change_vs_previous": None}

    return {"price_signals": price_signals}


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# [RecommendationAgent]
# ---------------------------------------------------------------------------

async def recommendation_agent(state: AgentState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    suppliers = state.get("suppliers") or []
    if not suppliers:
        return {"status": "error", "error": "recommendation_agent: no suppliers available to recommend from"}

    # Run ML Demand Forecasting on previous sales history
    from forecasting.engine import predict_demand_for_item

    item_id = state.get("item_id")
    owner_id = state.get("owner_id", "OWNER001")
    lead_time_hint = min((s.get("lead_time_days") or 2 for s in suppliers), default=2)

    try:
        demand_forecast = await predict_demand_for_item(
            item_id=item_id,
            owner_id=owner_id,
            lead_time_days=lead_time_hint,
        )
    except Exception as exc:
        logger.warning("recommendation_agent: ML forecast failed (%s); using baseline", exc)
        demand_forecast = {
            "recommended_qty": 20,
            "confidence_score": 80.0,
            "is_irregular": False,
            "irregularity_reason": None,
            "classification": "Baseline",
            "method": "Baseline Fallback",
        }

    # Attach forecast to state for LLM prompt context
    state["demand_forecast"] = demand_forecast

    recommendation = await _draft_recommendation(state)
    if "error" in recommendation:
        return {"status": "error", "error": recommendation["error"]}

    # Ensure ML fields are guaranteed on recommendation
    if not recommendation.get("predicted_qty"):
        recommendation["predicted_qty"] = demand_forecast.get("recommended_qty")
    if recommendation.get("forecast_confidence") is None:
        recommendation["forecast_confidence"] = demand_forecast.get("confidence_score")
    if recommendation.get("is_irregular_demand") is None:
        recommendation["is_irregular_demand"] = demand_forecast.get("is_irregular", False)
    if not recommendation.get("irregularity_reason"):
        recommendation["irregularity_reason"] = demand_forecast.get("irregularity_reason")

    recommendation["demand_forecast"] = demand_forecast

    # Prepare complete list of candidate suppliers for the frontend dynamic buttons
    evaluated_candidates = _build_candidate_supplier_options(state, recommendation)
    recommendation["candidate_suppliers"] = evaluated_candidates

    action_id = await log_agent_action(
        action_type="purchase_recommendation",
        trigger_reason=state.get("trigger_reason", "stock risk detected"),
        recommendation=recommendation,
        metadata={
            "item_id": state["item_id"],
            "suppliers_considered": [s.get("supplier_id") for s in suppliers],
            "candidate_suppliers": evaluated_candidates,
            "predicted_quantity": demand_forecast.get("recommended_qty"),
            "forecast_confidence": demand_forecast.get("confidence_score"),
            "is_irregular_demand": demand_forecast.get("is_irregular", False),
            "irregularity_reason": demand_forecast.get("irregularity_reason"),
            "demand_forecast": demand_forecast,
        },
    )
    return {
        "demand_forecast": demand_forecast,
        "recommendation": recommendation,
        "candidate_suppliers": evaluated_candidates,
        "action_id": action_id,
    }


def _build_candidate_supplier_options(state: AgentState, recommendation: dict[str, Any]) -> list[SupplierOption]:
    suppliers = state.get("suppliers") or []
    price_signals = state.get("price_signals") or {}
    primary_sid = recommendation.get("supplier_id")

    evaluated: list[SupplierOption] = []
    for s in suppliers:
        sid = s.get("supplier_id")
        sig = price_signals.get(sid, {})
        evaluated.append({
            "supplier_id": sid,
            "name": s.get("name") or s.get("supplier_name") or sid,
            "email": s.get("email"),
            "current_price": s.get("current_price") or s.get("unit_price"),
            "unit_price": s.get("unit_price") or s.get("current_price"),
            "lead_time_days": s.get("lead_time_days"),
            "reliability_score": s.get("reliability_score"),
            "moq": s.get("moq"),
            "is_recommended": (sid == primary_sid),
        })
    return evaluated


async def _draft_recommendation(state: AgentState) -> dict[str, Any]:
    try:
        return await _draft_with_llm(state)
    except Exception as exc:
        logger.warning("recommendation_agent: LLM draft failed (%s); using heuristic fallback", exc)
        return _draft_with_heuristic(state)


async def _draft_with_llm(state: AgentState) -> dict[str, Any]:
    from openai import AsyncOpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not found in the process environment.")

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    client = AsyncOpenAI(api_key=api_key)

    kwargs: dict[str, Any] = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": RECOMMENDATION_SYSTEM_PROMPT},
            {"role": "user", "content": build_recommendation_user_prompt(state)},
        ],
    }

    if not any(k in model.lower() for k in ["o1", "o3", "terra"]):
        kwargs["temperature"] = 0

    response = await client.chat.completions.create(**kwargs)
    text = response.choices[0].message.content or ""
    return _parse_recommendation_json(text)


def _parse_recommendation_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
    data = json.loads(cleaned)
    if "supplier_id" not in data or "qty" not in data:
        raise ValueError("model JSON response missing required 'supplier_id' or 'qty'")
    return data


def _draft_with_heuristic(state: AgentState) -> dict[str, Any]:
    suppliers = state.get("suppliers") or []
    days_left = state.get("days_to_stockout")
    forecast = state.get("demand_forecast") or {}

    def fits(s: dict[str, Any]) -> bool:
        lt = s.get("lead_time_days")
        return lt is not None and days_left is not None and lt <= days_left

    candidates = [s for s in suppliers if fits(s)]
    if not candidates:
        candidates = sorted(
            suppliers, key=lambda s: (s.get("lead_time_days") is None, s.get("lead_time_days", float("inf")))
        )
    chosen = min(
        candidates,
        key=lambda s: (s.get("current_price") is None, s.get("current_price", float("inf"))),
    )

    avg_daily_usage = state.get("avg_daily_usage") or 1.5
    # Use ML forecast recommended quantity
    qty = forecast.get("recommended_qty") or round(avg_daily_usage * 14)
    confidence = forecast.get("confidence_score", 85.0)
    is_irregular = forecast.get("is_irregular", False)
    irregular_reason = forecast.get("irregularity_reason")

    if is_irregular:
        justification = (
            f"Recommended {qty} units from {chosen.get('name') or chosen.get('supplier_name') or chosen.get('supplier_id')}. "
            f"Note: Sales pattern is irregular ({confidence}% prediction accuracy). Please review and adjust quantity if needed."
        )
    else:
        justification = (
            f"Recommended {qty} units from {chosen.get('name') or chosen.get('supplier_name') or chosen.get('supplier_id')} "
            f"based on steady sales demand ({confidence}% prediction accuracy)."
        )

    return {
        "supplier_id": chosen.get("supplier_id"),
        "qty": float(qty),
        "predicted_qty": float(qty),
        "forecast_confidence": float(confidence),
        "is_irregular_demand": is_irregular,
        "irregularity_reason": irregular_reason,
        "justification": justification,
        "risk_notes": irregular_reason if is_irregular else None,
    }


# ---------------------------------------------------------------------------
# [HumanApprovalNode] — dynamic supplier override
# ---------------------------------------------------------------------------

async def human_approval_node(state: AgentState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    recommendation = state.get("recommendation") or {}
    candidates = state.get("candidate_suppliers") or recommendation.get("candidate_suppliers", [])

    decision_payload: dict[str, Any] = interrupt(
        {
            "action_id": state.get("action_id"),
            "item_id": state.get("item_id"),
            "recommendation": recommendation,
            "candidate_suppliers": candidates,
            "question": "Choose a supplier and approve, reject, or modify this order:",
        }
    )

    decision_payload = decision_payload or {}
    decision = decision_payload.get("decision", "rejected")

    # Generic extraction across all incoming payload variations
    chosen_name = (
        decision_payload.get("supplier_name")
        or decision_payload.get("selected_supplier_name")
        or (decision_payload.get("selected_supplier") or {}).get("name")
        or (decision_payload.get("selected_supplier") or {}).get("supplier_name")
        or (decision_payload.get("selectedSupplier") or {}).get("name")
        or state.get("selected_supplier_name")
    )

    chosen_sid = (
        decision_payload.get("selected_supplier_id")
        or decision_payload.get("supplier_id")
        or decision_payload.get("chosen_supplier_id")
        or (decision_payload.get("selected_supplier") or {}).get("supplier_id")
        or (decision_payload.get("selectedSupplier") or {}).get("supplier_id")
        or state.get("selected_supplier_id")
        or recommendation.get("supplier_id")
    )

    chosen_qty = (
        decision_payload.get("qty") 
        or state.get("recommended_qty") 
        or recommendation.get("qty")
    )

    print(f"\n=======================================================")
    print(f"[HUMAN APPROVAL NODE] Incoming decision: '{decision}'")
    print(f"[HUMAN APPROVAL NODE] Dynamic Target Supplier: '{chosen_name}' (ID: '{chosen_sid}')")
    print(f"=======================================================\n")

    chosen_action_id = decision_payload.get("action_id") or state.get("action_id")

    update: dict[str, Any] = {
        "owner_decision": decision,
        "action_id": str(chosen_action_id) if chosen_action_id else None,
        "selected_supplier_id": str(chosen_sid) if chosen_sid else None,
        "selected_supplier_name": str(chosen_name) if chosen_name else None,
    }

    updated_rec = dict(recommendation)
    if chosen_sid:
        updated_rec["supplier_id"] = str(chosen_sid)
        for sup in (candidates or state.get("suppliers", [])):
            sup_name = sup.get("name") or sup.get("supplier_name") or ""
            if str(sup.get("supplier_id")) == str(chosen_sid) or (chosen_name and sup_name.lower() == str(chosen_name).lower()):
                update["selected_supplier"] = sup
                if not chosen_name:
                    chosen_name = sup_name
                updated_rec["supplier_name"] = chosen_name
                update["selected_supplier_name"] = chosen_name
                break

    if chosen_name:
        updated_rec["supplier_name"] = chosen_name

    if chosen_qty is not None:
        updated_rec["qty"] = float(chosen_qty)

    update["recommendation"] = updated_rec

    if decision in ("modified", "approved"):
        modifications = {
            "supplier_id": str(chosen_sid) if chosen_sid else None,
            "selected_supplier_id": str(chosen_sid) if chosen_sid else None,
            "supplier_name": str(chosen_name) if chosen_name else None,
            "qty": float(chosen_qty) if chosen_qty else None,
        }
        update["owner_modifications"] = modifications
    elif decision == "rejected":
        update["owner_modifications"] = {"reason": decision_payload.get("reason")}

    return update


def route_after_approval(state: AgentState) -> str:
    if state.get("status") == "error":
        return "feedback_logger_agent"
    return "purchase_order_agent" if state.get("owner_decision") in ("approved", "modified") else "feedback_logger_agent"


# ---------------------------------------------------------------------------
# [PurchaseOrderAgent] — strictly sends order to chosen supplier
# ---------------------------------------------------------------------------

async def purchase_order_agent(state: AgentState) -> dict[str, Any]:
    recommendation = state.get("recommendation") or {}
    owner_mods = state.get("owner_modifications") or {}
    selected_sup = state.get("selected_supplier") or {}

    target_supplier_name = (
        state.get("selected_supplier_name")
        or owner_mods.get("supplier_name")
        or selected_sup.get("name")
        or selected_sup.get("supplier_name")
        or recommendation.get("supplier_name")
    )

    supplier_id = (
        state.get("selected_supplier_id")
        or owner_mods.get("selected_supplier_id")
        or owner_mods.get("supplier_id")
        or recommendation.get("supplier_id")
    )

    qty = (
        owner_mods.get("qty")
        or state.get("recommended_qty")
        or recommendation.get("qty")
    )

    print(f"\n=======================================================")
    print(f"[PURCHASE ORDER AGENT] Target Supplier: '{target_supplier_name}' (ID: '{supplier_id}', Qty: {qty})")
    print(f"=======================================================\n")

    if not supplier_id or not qty:
        return {"status": "error", "error": "purchase_order_agent: missing target supplier_id/qty"}

    try:
        po = await mcp_client.call_tool(
            "suppliers",
            "send_purchase_order",
            {
                "supplier_id": str(supplier_id),
                "supplier_name": str(target_supplier_name) if target_supplier_name else None,
                "items": [{"item_id": state["item_id"], "qty": float(qty)}],
                "qty": float(qty),
                "owner_id": state.get("owner_id"),
            },
        )
    except MCPToolError as exc:
        return {"status": "error", "error": f"purchase_order_agent: {exc}"}


    return {
        "purchase_order": po,
        "selected_supplier_id": str(supplier_id),
        "selected_supplier_name": str(target_supplier_name) if target_supplier_name else None,
        "recommendation": {
            **recommendation,
            "supplier_id": str(supplier_id),
            "supplier_name": target_supplier_name,
            "qty": float(qty),
        },
    }


# ---------------------------------------------------------------------------
# [NotifyOwnerAgent]
# ---------------------------------------------------------------------------

async def notify_owner_agent(state: AgentState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    po = state.get("purchase_order") or {}
    target_supplier_id = po.get("supplier_id") or state.get("selected_supplier_id")
    message = (
        f"Purchase order sent: {po.get('items')} to supplier "
        f"{target_supplier_id} (PO #{po.get('po_id')})."
    )
    try:
        await mcp_client.call_tool(
            "notifications",
            "send_notification",
            {"owner_id": state.get("owner_id", "unknown_owner"), "message": message, "priority": "normal"},
        )
    except MCPToolError as exc:
        logger.warning("notify_owner_agent: %s", exc)

    recommendation = state.get("recommendation") or {}
    qty = recommendation.get("qty")
    if po.get("po_id") and qty is not None:
        from .reply_watcher import schedule_reply_watch

        schedule_reply_watch(
            owner_id=state.get("owner_id", "unknown_owner"),
            item_id=state["item_id"],
            qty=qty,
            po=po,
            action_id=state.get("action_id"),
            # Carries forward every supplier already excluded by an earlier
            # escalation, so if *this* supplier also doesn't come through,
            # the next escalation still won't loop back to a previous one.
            tried_supplier_ids=state.get("excluded_supplier_ids"),
        )
    else:
        logger.warning("notify_owner_agent: skipping reply watch, missing po_id or qty")

    return {"status": "completed"}


# ---------------------------------------------------------------------------
# [FeedbackLoggerAgent]
# ---------------------------------------------------------------------------

async def feedback_logger_agent(state: AgentState) -> dict[str, Any]:
    await log_agent_action(
        action_type="recommendation_rejected" if state.get("owner_decision") == "rejected" else "recommendation_feedback",
        trigger_reason=state.get("trigger_reason", "stock risk detected"),
        recommendation=state.get("recommendation"),
        owner_decision=state.get("owner_decision", "rejected"),
        metadata={
            "item_id": state.get("item_id"),
            "owner_modifications": state.get("owner_modifications"),
            "original_action_id": state.get("action_id"),
            "selected_supplier_id": state.get("selected_supplier_id"),
        },
    )
    return {"status": state.get("status") or "rejected"}