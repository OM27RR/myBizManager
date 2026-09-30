"""
agents/reply_watcher.py
========================

Monitors supplier email replies in the background, parses supplier responses,
updates stock and timestamps upon confirmation, and logs the outcome.

If the supplier does NOT accept (they report the item is out of stock, or
they reject the order outright), this does not just log the outcome and
stop. It re-runs the agent graph excluding every supplier already tried,
which drafts a fresh recommendation for the next-best remaining supplier
and pauses for human approval — exactly like the very first recommendation
did. That pending approval is written straight to the same MongoDB
collection backend-node's dashboard already polls
(`agentactions` — see COL_PENDING_ACTIONS), so it shows up as a normal
alert card the owner can approve (send to the next supplier), reject
(stop trying), or override with a different supplier — using the existing
approve/reject UI. Approving it resumes the graph, which sends that
supplier's PO email and schedules another watch_supplier_reply() for it,
so the chain continues supplier-by-supplier until one accepts or the
suppliers run out.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import os
import time
from typing import Any
import uuid

from bson import ObjectId

from mcp_service.common import (
    COL_INVENTORY,
    COL_PENDING_ACTIONS,
    COL_PURCHASE_ORDERS,
    COL_SUPPLIERS,
    get_db,
    log_email_notification,
)
from mcp_service.suppliers.tools import (
    check_inbox_for_reply,
    classify_supplier_reply,
    confirm_and_update_stock,
)
from mcp_service.suppliers.gmail_auth import (
    get_owner_gmail_credentials,
    check_gmail_api_for_reply,
)

from .graph import graph

logger = logging.getLogger("agents.reply_watcher")


_background_tasks: set[asyncio.Task] = set()

DEFAULT_POLL_TIMEOUT_SECONDS = int(os.getenv("REPLY_POLL_TIMEOUT", "120"))  # 2 mins default, configurable via env
DEFAULT_POLL_INTERVAL_SECONDS = int(os.getenv("REPLY_POLL_INTERVAL", "5"))


def schedule_reply_watch(**kwargs: Any) -> None:
    """Fire-and-forget entry point called from notify_owner_agent."""
    task = asyncio.create_task(watch_supplier_reply(**kwargs))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _update_action_outcome(
    *,
    db: Any,
    owner_id: str,
    item_id: str,
    action_id: str | None = None,
    po_tag: str | None = None,
    po_id: str | None = None,
    status: str,
    supplier_outcome: str,
    outcome_text: str,
    qty: float | None = None,
) -> None:
    """
    Updates the matching AgentAction document in both `agentactions` and `agent_actions` collections
    so the owner's Action Log reflects genuine procurement outcome in real time.
    """
    query_conditions: list[dict[str, Any]] = []
    if action_id:
        if ObjectId.is_valid(action_id):
            query_conditions.append({"_id": ObjectId(action_id)})
        query_conditions.append({"_id": str(action_id)})
        query_conditions.append({"action_id": str(action_id)})

    if po_tag:
        query_conditions.append({"po_tag": po_tag})
    if po_id:
        query_conditions.append({"po_id": po_id})

    fallback_filter: dict[str, Any] = {
        "owner_id": owner_id,
        "item_id": item_id,
        "status": {"$in": ["po_sent", "approved", "pending", "ambiguous"]},
    }

    update_fields: dict[str, Any] = {
        "status": status,
        "decision": status,
        "supplier_outcome": supplier_outcome,
        "outcome_text": outcome_text,
        "decided_at": datetime.now(timezone.utc),
    }
    if status == "confirmed":
        update_fields["shipment_status"] = "pending"
    elif status == "ambiguous":
        update_fields["shipment_status"] = "negotiating"
    if po_tag:
        update_fields["po_tag"] = po_tag
    if po_id:
        update_fields["po_id"] = po_id
    if qty is not None and qty > 0:
        update_fields["quantity"] = qty
        update_fields["order_quantity"] = qty

    # Update both agentactions and agent_actions collections to keep full-stack data in sync
    target_collections = [COL_PENDING_ACTIONS, "agent_actions"]

    for col in target_collections:
        try:
            if query_conditions:
                res = await db[col].update_many(
                    {"$or": query_conditions},
                    {"$set": update_fields},
                )
                if res.matched_count > 0:
                    logger.info(
                        "Updated %s (matched by ID/tag) -> status=%s, outcome=%s",
                        col,
                        status,
                        supplier_outcome,
                    )
            else:
                doc = await db[col].find_one(fallback_filter, sort=[("triggered_at", -1)])
                if doc:
                    await db[col].update_one({"_id": doc["_id"]}, {"$set": update_fields})
                    logger.info("Updated %s via fallback -> status=%s", col, status)
        except Exception as exc:
            logger.warning("_update_action_outcome failed for %s: %s", col, exc)


async def watch_supplier_reply(
    owner_id: str,
    item_id: str,
    qty: float,
    po: dict[str, Any] | None = None,
    action_id: str | None = None,
    poll_timeout_seconds: int = DEFAULT_POLL_TIMEOUT_SECONDS,
    poll_interval_seconds: int = DEFAULT_POLL_INTERVAL_SECONDS,
    tried_supplier_ids: list[str] | None = None,
    is_custom_reply: bool = False,
    **kwargs: Any,
) -> None:
    db = await get_db()
    po = po or {}

    po_id = po.get("po_id") or kwargs.get("po_id")
    po_tag = po.get("po_tag") or kwargs.get("po_tag")
    supplier_id = po.get("supplier_id") or kwargs.get("supplier_id")
    supplier_email = po.get("supplier_email") or kwargs.get("supplier_email")
    supplier_name = po.get("supplier_name") or kwargs.get("supplier_name")
    email_delivery = po.get("email_delivery") or kwargs.get("email_delivery") or {"sent": True}

    # Resolve details from purchase_orders if missing
    if po_tag or po_id:
        po_query = []
        if po_tag:
            po_query.append({"po_tag": po_tag})
        if po_id:
            po_query.append({"po_id": po_id})
        po_doc = await db[COL_PURCHASE_ORDERS].find_one({"$or": po_query})
        if po_doc:
            po_id = po_id or po_doc.get("po_id")
            po_tag = po_tag or po_doc.get("po_tag")
            supplier_id = supplier_id or po_doc.get("supplier_id")
            supplier_email = supplier_email or po_doc.get("supplier_email")
            supplier_name = supplier_name or po_doc.get("supplier_name")
            if not qty or qty <= 1.0:
                for it in (po_doc.get("items") or []):
                    if it.get("qty"):
                        qty = float(it["qty"])
                        break

    inv_item = await db[COL_INVENTORY].find_one(
        {"$or": [{"item_id": item_id}, {"item_name": item_id}]}, {"_id": 0}
    )
    item_name = (inv_item or {}).get("item_name") or (inv_item or {}).get("name") or item_id

    if not supplier_name and supplier_id:
        supplier_doc = await db[COL_SUPPLIERS].find_one(
            {"$or": [{"supplier_id": str(supplier_id)}, {"name": str(supplier_id)}]}, {"_id": 0}
        )
        supplier_name = (supplier_doc or {}).get("supplier_name") or (supplier_doc or {}).get("name") or str(supplier_id)

    supplier_name = supplier_name or "Supplier"

    if not is_custom_reply:
        outbound_subject = f"[{po_tag}] Urgent Purchase Order Request"
        outbound_body = f"Requested {qty} units of {item_name} ({item_id}) from {supplier_name}."

        # 1. Log outbound PO email
        await log_email_notification(
            owner_id=owner_id,
            direction="outbound",
            status="sent" if email_delivery.get("sent") else "failed",
            subject=outbound_subject,
            body=outbound_body,
            email_to=supplier_email,
            supplier_name=supplier_name,
            item_id=item_id,
            item_name=item_name,
            po_id=po_id,
            po_tag=po_tag,
        )

        # Sync AgentAction to po_sent / awaiting_reply
        await _update_action_outcome(
            db=db,
            owner_id=owner_id,
            item_id=item_id,
            action_id=action_id,
            po_tag=po_tag,
            po_id=po_id,
            status="po_sent",
            supplier_outcome="awaiting_reply",
            outcome_text=f"PO [{po_tag}] sent to {supplier_name} — awaiting reply",
        )

    if not supplier_email or not po_tag:
        logger.info("watch_supplier_reply: nothing to poll for po_id=%s (missing email or po_tag)", po_id)
        return

    # 2. Poll the inbox for supplier reply
    if is_custom_reply:
        last_outbound = await db["notifications"].find_one(
            {"po_tag": po_tag, "direction": "outbound"},
            sort=[("timestamp", -1)],
        )
        if last_outbound and last_outbound.get("timestamp"):
            send_time = float(last_outbound["timestamp"]) - 10
        else:
            send_time = time.time() - 3600
    else:
        send_time = time.time()

    reply_body: str | None = None

    oauth_creds = None
    if owner_id:
        try:
            oauth_creds = await get_owner_gmail_credentials(owner_id)
        except Exception as oauth_err:
            logger.warning("Error fetching OAuth credentials for reply watcher: %s", oauth_err)

    if oauth_creds:
        logger.info("Polling Gmail API for supplier reply to %s (user: %s)...", po_tag, oauth_creds[1])
    else:
        logger.info("Polling standard IMAP inbox for supplier reply to %s...", po_tag)

    poll_start = time.time()
    while time.time() - poll_start < poll_timeout_seconds:
        if oauth_creds:
            access_token, _ = oauth_creds
            reply_body = await check_gmail_api_for_reply(
                access_token=access_token,
                supplier_email=supplier_email,
                po_tag=po_tag,
                sent_after_timestamp=send_time,
            )
        else:
            reply_body = await asyncio.to_thread(
                check_inbox_for_reply,
                supplier_email=supplier_email,
                po_tag=po_tag,
                sent_after_timestamp=send_time,
            )
        if reply_body:
            decision_peek = await classify_supplier_reply(reply_body, order_qty=qty, item_name=item_name)
            if decision_peek != "NO_REPLY":
                break
            # Outbound email echo, continue polling
            reply_body = None
        await asyncio.sleep(poll_interval_seconds)

    tried = {str(sid) for sid in (tried_supplier_ids or [])}
    if supplier_id:
        tried.add(str(supplier_id))

    if not reply_body:
        if is_custom_reply:
            logger.info("Custom reply watcher poll timed out for %s; keeping state as awaiting reply.", po_tag)
            return

        # Supplier timed out with no response
        outcome_text = f"Order Disapproved: No reply received from {supplier_name} within {poll_timeout_seconds}s (Timed out) — Recommending next best supplier"
        await _update_action_outcome(
            db=db,
            owner_id=owner_id,
            item_id=item_id,
            action_id=action_id,
            po_tag=po_tag,
            po_id=po_id,
            status="timeout",
            supplier_outcome="timeout",
            outcome_text=outcome_text,
        )
        await log_email_notification(
            owner_id=owner_id,
            direction="inbound",
            status="timeout",
            subject=f"Re: [{po_tag}] Urgent Purchase Order Request",
            body=f"No reply received from {supplier_name} within {poll_timeout_seconds}s.",
            email_from=supplier_email,
            supplier_name=supplier_name,
            item_id=item_id,
            item_name=item_name,
            po_id=po_id,
            po_tag=po_tag,
        )
        await _escalate_to_next_supplier(
            owner_id=owner_id,
            item_id=item_id,
            item_name=item_name,
            qty=qty,
            outcome_message=f"{supplier_name} did not respond to the purchase order in time",
            excluded_supplier_ids=tried,
        )
        return

    # 3. Classify reply & update stock
    decision = await classify_supplier_reply(reply_body, order_qty=qty, item_name=item_name)

    if decision == "ACCEPTED":
        await confirm_and_update_stock(item_id=item_id, qty=qty, po_id=po_id)
        status = "confirmed"
        outcome_text = f"Order Placed: Confirmed by {supplier_name} (+{qty} units restocked in inventory)"
    elif decision == "OUT_OF_STOCK":
        status = "out_of_stock"
        outcome_text = f"Order Disapproved: {supplier_name} reported out of stock — Recommending next best supplier"
    elif decision == "AMBIGUOUS":
        status = "ambiguous"
        outcome_text = f"Clarification Needed: {supplier_name} replied: \"{reply_body[:80]}...\". Awaiting owner custom reply."
    else:
        status = "rejected"
        outcome_text = f"Order Disapproved: Rejected by {supplier_name} — Recommending next best supplier"

    # Update AgentAction status and outcome
    await _update_action_outcome(
        db=db,
        owner_id=owner_id,
        item_id=item_id,
        action_id=action_id,
        po_tag=po_tag,
        po_id=po_id,
        status=status,
        supplier_outcome=status,
        outcome_text=outcome_text,
        qty=qty,
    )

    await log_email_notification(
        owner_id=owner_id,
        direction="inbound",
        status=status,
        subject=f"Clarification Needed: [{po_tag}] {supplier_name}" if status == "ambiguous" else f"Re: [{po_tag}] Urgent Purchase Order Request",
        body=reply_body,
        email_from=supplier_email,
        supplier_name=supplier_name,
        item_id=item_id,
        item_name=item_name,
        po_id=po_id,
        po_tag=po_tag,
    )

    # If supplier accepted order, also log in-transit shipment notification
    if decision == "ACCEPTED":
        await log_email_notification(
            owner_id=owner_id,
            direction="system",
            status="in_transit",
            subject=f"Shipment In Transit: [{po_tag}] {item_name}",
            body=f"Supplier {supplier_name} confirmed order {po_tag}. {qty} units of {item_name} are currently in transit.",
            supplier_name=supplier_name,
            item_id=item_id,
            item_name=item_name,
            po_id=po_id,
            po_tag=po_tag,
        )

    # 4. Supplier didn't accept:
    # If AMBIGUOUS, do not escalate — owner will send custom reply
    if decision not in ("ACCEPTED", "AMBIGUOUS"):
        outcome_message = (
            f"{supplier_name} reported {item_name} as out of stock"
            if decision == "OUT_OF_STOCK"
            else f"{supplier_name} rejected the purchase order for {item_name}"
        )
        await _escalate_to_next_supplier(
            owner_id=owner_id,
            item_id=item_id,
            item_name=item_name,
            qty=qty,
            outcome_message=outcome_message,
            excluded_supplier_ids=tried,
        )


async def _escalate_to_next_supplier(
    *,
    owner_id: str,
    item_id: str,
    item_name: str,
    qty: float,
    outcome_message: str,
    excluded_supplier_ids: set[str],
) -> None:
    """
    Called after a supplier fails to accept the order (rejected, out of
    stock, or no reply). Re-runs the agent graph with every supplier
    already tried excluded, so RecommendationAgent is forced to pick a
    fresh one. The graph pauses at human_approval_node exactly like the
    first recommendation did — we surface that as a new pending alert on
    the dashboard (so the owner explicitly approves before any new email
    goes out) instead of auto-sending a PO to whoever is next in line.

    If no suppliers remain, there's nothing to ask approval for, so we
    just tell the owner via the Notifications feed.
    """
    db = await get_db()

    inv_item = await db[COL_INVENTORY].find_one(
        {"$or": [{"item_id": item_id}, {"item_name": item_id}, {"item_name": item_name}]},
        {"_id": 0},
    )
    if inv_item:
        item_id = inv_item.get("item_id") or item_id
        item_name = inv_item.get("item_name") or inv_item.get("name") or item_name

    current_stock = float((inv_item or {}).get("current_stock", 0) or 0)
    avg_daily_usage = (inv_item or {}).get("avg_daily_usage")
    days_to_stockout = round(current_stock / avg_daily_usage, 1) if avg_daily_usage else None

    thread_id = f"agent-escalation-{uuid.uuid4().hex[:12]}"
    config = {"configurable": {"thread_id": thread_id}}

    try:
        result = await graph.ainvoke(
            {
                "item_id": item_id,
                "item_name": item_name,
                "owner_id": owner_id,
                "current_stock": current_stock,
                "avg_daily_usage": avg_daily_usage,
                "days_to_stockout": days_to_stockout,
                "excluded_supplier_ids": list(excluded_supplier_ids),
                "trigger_reason": (
                    f"{outcome_message}. Re-evaluating remaining suppliers for a next-best option."
                ),
            },
            config,
        )
    except Exception as exc:  # noqa: BLE001 - this is a background task, never let it die silently
        logger.warning("_escalate_to_next_supplier: graph run failed for item_id=%s: %s", item_id, exc)
        result = {"status": "error", "error": str(exc)}

    if result.get("status") == "error" or not result.get("__interrupt__"):
        # No suppliers left to try (or the escalation run itself failed) —
        # nothing actionable to put on the dashboard, just tell the owner.
        await log_email_notification(
            owner_id=owner_id,
            direction="system",
            status="exhausted",
            subject=f"No remaining suppliers for {item_name}",
            body=(
                f"{outcome_message}, and no other suppliers are on file for this item. "
                "Manual reorder needed."
            ),
            supplier_name=None,
            item_id=item_id,
            item_name=item_name,
        )
        return

    payload = result["__interrupt__"][0].value
    recommendation = payload.get("recommendation") or {}
    candidates = payload.get("candidate_suppliers") or recommendation.get("candidate_suppliers", [])
    suppliers = result.get("suppliers") or []

    next_supplier = next(
        (s for s in suppliers if s.get("supplier_id") == recommendation.get("supplier_id")), None
    )
    next_name = (
        (next_supplier or {}).get("name")
        or recommendation.get("supplier_name")
        or "the next supplier"
    )

    recommendation_text = (
        f"{outcome_message}. Approve to send a purchase order to {next_name} instead, "
        "or pick a different supplier below."
    )

    await log_email_notification(
        owner_id=owner_id,
        direction="system",
        status="pending_approval",
        subject=f"Approval needed: next supplier for {item_name}",
        body=recommendation_text,
        supplier_name=next_name,
        item_id=item_id,
        item_name=item_name,
    )

    try:
        await db[COL_PENDING_ACTIONS].insert_one(
            {
                "owner_id": owner_id,
                "item_name": item_name,
                "item_id": item_id,
                "triggered_at": datetime.now(timezone.utc),
                "chosen_supplier": next_name,
                "recommendation_text": recommendation_text,
                "recommended_supplier_id": recommendation.get("supplier_id"),
                "recommended_qty": recommendation.get("qty", qty),
                "candidate_suppliers": candidates,
                "agent_thread_id": thread_id,
                "status": "pending",
            }
        )
    except Exception as exc:  # noqa: BLE001 - e.g. a pending alert for this item already exists
        logger.warning(
            "_escalate_to_next_supplier: could not create pending alert for item_id=%s: %s", item_id, exc
        )