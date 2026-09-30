"""
main.py — Production FastAPI Backend for Autonomous Procurement
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import os
import time
from typing import Any, Dict
import uuid

import certifi
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from agents.graph import graph
from mcp_service.client import mcp_client
from mcp_service.suppliers.tools import (
    check_inbox_for_reply,
    classify_supplier_reply,
    confirm_and_update_stock,
)
from mcp_service.suppliers.gmail_auth import (
    get_owner_gmail_credentials,
    check_gmail_api_for_reply,
)


load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
DB_NAME = os.getenv("DB_NAME") or "business_agent"

db_client: AsyncIOMotorClient | None = None
db: Any = None

active_jobs: Dict[str, Dict[str, Any]] = {}
job_event_queues: Dict[str, asyncio.Queue] = {}

LOW_STOCK_THRESHOLD = 15
TARGET_STOCK_BUFFER = 40


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client, db
    print(">> Initializing MongoDB Atlas Connection with TLS certs...")
    db_client = AsyncIOMotorClient(
        str(MONGO_URI),
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        socketTimeoutMS=10000,
    )
    db = db_client[str(DB_NAME)]

    print(">> Connecting MCP Server Tools...")
    await mcp_client.connect_all()
    print(">> Backend System Ready at http://127.0.0.1:8000")
    yield
    print(">> Shutting down connections...")
    await mcp_client.close()
    if db_client:
        db_client.close()


app = FastAPI(
    title="Autonomous Business Agent API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# Request Models
# ---------------------------------------------------------

class EvaluateRequest(BaseModel):
    item_id: str
    owner_id: str = "OWNER001"


class TriggerProcurementRequest(BaseModel):
    item_id: str
    selected_supplier_id: str
    reorder_qty: float
    owner_id: str = "OWNER001"
    poll_timeout_seconds: int = 300


class ManualResolveRequest(BaseModel):
    job_id: str
    decision: str = Field(..., description="'ACCEPTED' or 'REJECTED'")


class AgentDetectRequest(BaseModel):
    """Body sent by backend-node's services/agent.service.js::runStockRiskDetection."""
    owner_id: str = "OWNER001"
    item_name: str | None = None
    item_id: str | None = None


class AgentPurchaseOrderRequest(BaseModel):
    """Body sent after owner approves/rejects an alert with dynamic supplier selection."""
    model_config = {"extra": "allow"}
    thread_id: str
    decision: str  # "approved" | "rejected" | "modified"
    owner_id: str = "OWNER001"
    item_id: str | None = None
    item_name: str | None = None
    action_id: str | None = None
    supplier_id: str | None = None
    selected_supplier_id: str | None = None
    supplier_name: str | None = None
    selected_supplier_name: str | None = None
    qty: float | None = None
    order_qty: float | None = None
    quantity: float | None = None
    rejection_reason: str | None = None


class WatchReplyRequest(BaseModel):
    owner_id: str = "OWNER001"
    supplier_email: str | None = None
    supplier_name: str | None = "Supplier"
    item_id: str | None = ""
    item_name: str | None = ""
    po_id: str | None = ""
    po_tag: str | None = ""
    qty: float | None = 10.0
    action_id: str | None = None
    supplier_id: str | None = None


class EscalateRequest(BaseModel):
    owner_id: str = "OWNER001"
    supplier_id: str | None = None
    supplier_name: str | None = None
    item_id: str | None = None
    item_name: str | None = None
    po_id: str | None = None
    po_tag: str | None = None
    qty: float | None = 10.0
    reason: str | None = None
    excluded_supplier_ids: list[str] | None = None


# ---------------------------------------------------------
# Background Worker & Event Emitter
# ---------------------------------------------------------

async def emit_log(job_id: str, message: str, status: str = "IN_PROGRESS", payload: dict | None = None):
    log_entry = {
        "job_id": job_id,
        "timestamp": time.time(),
        "status": status,
        "message": message,
        "payload": payload or {},
    }
    if job_id in active_jobs:
        active_jobs[job_id]["logs"].append(log_entry)
        active_jobs[job_id]["status"] = status
    if job_id in job_event_queues:
        await job_event_queues[job_id].put(log_entry)


async def background_procurement_worker(job_id: str, req: TriggerProcurementRequest):
    item = await db["inventory"].find_one({"item_id": req.item_id}, {"_id": 0})
    if not item:
        await emit_log(job_id, f"Item {req.item_id} not found", status="FAILED")
        return

    res = await mcp_client.call_tool("suppliers", "get_suppliers_for_item", {"item_id": req.item_id})
    all_suppliers = res.get("suppliers", [])

    selected = [s for s in all_suppliers if s.get("supplier_id") == req.selected_supplier_id]
    others = [s for s in all_suppliers if s.get("supplier_id") != req.selected_supplier_id]
    suppliers_to_try = selected + others

    fulfilled = False
    for rank, supplier in enumerate(suppliers_to_try, 1):
        sup_id = supplier.get("supplier_id")
        sup_name = supplier.get("name") or sup_id
        sup_email = supplier.get("email")

        await emit_log(job_id, f"Attempt {rank}/{len(suppliers_to_try)}: Contacting {sup_name} ({sup_email})...")

        send_time = time.time()
        po_res = await mcp_client.call_tool(
            "suppliers",
            "send_purchase_order",
            {
                "supplier_id": sup_id,
                "supplier_name": sup_name,
                "items": [{"item_id": req.item_id, "qty": req.reorder_qty}],
                "owner_id": req.owner_id,
            },
        )
        po_tag = po_res.get("po_tag")
        po_id = po_res.get("po_id")
        delivery = po_res.get("email_delivery", {})

        if not delivery.get("sent"):
            await emit_log(job_id, f"Email dispatch failed for {sup_name}: {delivery.get('error')}", status="WARNING")
            continue

        await emit_log(job_id, f"PO email sent with subject tag [{po_tag}]. Monitoring inbox for replies...")

        # Check if owner has connected Google OAuth
        oauth_creds = None
        if req.owner_id:
            try:
                oauth_creds = await get_owner_gmail_credentials(req.owner_id)
            except Exception as e:
                print(f"[MAIN WORKER] OAuth check note: {e}")

        poll_interval = 4
        reply_received = None
        while time.time() - send_time < req.poll_timeout_seconds:
            if active_jobs[job_id].get("manual_override"):
                reply_received = active_jobs[job_id]["manual_override"]
                break

            if oauth_creds:
                access_token, _ = oauth_creds
                reply_received = await check_gmail_api_for_reply(
                    access_token=access_token,
                    supplier_email=sup_email,
                    po_tag=po_tag,
                    sent_after_timestamp=send_time,
                )
            else:
                reply_received = await asyncio.to_thread(
                    check_inbox_for_reply,
                    supplier_email=sup_email,
                    po_tag=po_tag,
                    sent_after_timestamp=send_time,
                )
            if reply_received:
                break


            elapsed = int(time.time() - send_time)
            await emit_log(job_id, f"Listening for response... ({elapsed}s / {req.poll_timeout_seconds}s)")
            await asyncio.sleep(poll_interval)

        if not reply_received:
            await emit_log(job_id, f"Timeout: No response from {sup_name} within {req.poll_timeout_seconds}s.", status="WARNING")
            continue

        await emit_log(job_id, f'Received email reply: "{reply_received}"')
        await emit_log(job_id, "Analyzing response intent using LLM...")

        decision = await classify_supplier_reply(reply_received)
        await emit_log(job_id, f"LLM Verdict: {decision}")

        if decision == "ACCEPTED":
            await confirm_and_update_stock(item_id=req.item_id, qty=req.reorder_qty, po_id=po_id)
            updated = await db["inventory"].find_one({"item_id": req.item_id}, {"_id": 0})
            final_stock = updated.get("current_stock") if updated else req.reorder_qty
            await emit_log(
                job_id,
                f"Order Confirmed by {sup_name}! Restocked +{req.reorder_qty} units. Live stock: {final_stock}",
                status="COMPLETED",
                payload={"final_stock": final_stock, "supplier_id": sup_id, "po_id": po_id},
            )
            fulfilled = True
            break
        else:
            await emit_log(job_id, f"{sup_name} declined or is out of stock. Pivoting to next supplier...", status="RETRYING")

    if not fulfilled:
        await emit_log(job_id, "All suppliers exhausted. Stock reorder could not be completed.", status="FAILED")


# ---------------------------------------------------------
# REST API Endpoints
# ---------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Procurement Agent API"}


@app.get("/api/analytics/summary")
async def get_dashboard_summary():
    """Returns analytics data for dashboard top cards concurrently with safe timeout fallbacks."""
    try:
        total_items, low_stock_count, total_orders, completed_orders = await asyncio.gather(
            db["inventory"].count_documents({}),
            db["inventory"].count_documents({"current_stock": {"$lt": LOW_STOCK_THRESHOLD}}),
            db["purchase_orders"].count_documents({}),
            db["purchase_orders"].count_documents({"status": "accepted_and_fulfilled"}),
        )
    except Exception:
        total_items, low_stock_count, total_orders, completed_orders = 0, 0, 0, 0

    return {
        "total_items": total_items,
        "low_stock_alerts": low_stock_count,
        "total_orders_placed": total_orders,
        "fulfilled_orders": completed_orders,
        "system_health": "Active",
    }


@app.get("/api/inventory/low-stock")
async def get_low_stock_items():
    """Fetches low stock inventory items (< 15 units)."""
    try:
        items = await db["inventory"].find(
            {"current_stock": {"$lt": LOW_STOCK_THRESHOLD}},
            {"_id": 0}
        ).to_list(length=100)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

    return {"count": len(items), "threshold": LOW_STOCK_THRESHOLD, "items": items}


@app.post("/api/procurement/evaluate")
async def evaluate_procurement_strategy(req: EvaluateRequest):
    item = await db["inventory"].find_one({"item_id": req.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    current_stock = float(item.get("current_stock", 0))
    res = await mcp_client.call_tool("suppliers", "get_suppliers_for_item", {"item_id": req.item_id})
    suppliers = res.get("suppliers", [])
    if not suppliers:
        raise HTTPException(status_code=404, detail="No suppliers found stocking this item")

    suppliers.sort(key=lambda s: (-s.get("reliability_score", 0), s.get("current_price", 9999)))

    unique_thread_id = f"eval-{req.item_id}-{int(time.time())}"
    config = {"configurable": {"thread_id": unique_thread_id}}

    agent_eval = await graph.ainvoke(
        {"item_id": req.item_id, "owner_id": req.owner_id, "current_stock": current_stock},
        config,
    )

    interrupts = agent_eval.get("__interrupt__", [])
    if interrupts:
        rec = interrupts[0].value.get("recommendation", {})
        candidates = interrupts[0].value.get("candidate_suppliers") or rec.get("candidate_suppliers", [])
    else:
        rec = agent_eval.get("recommendation", {})
        candidates = agent_eval.get("candidate_suppliers") or rec.get("candidate_suppliers", [])

    reorder_qty = float(rec.get("qty", 25.0))
    recommended_supplier_id = rec.get("supplier_id")
    justification = rec.get("justification", "Restocking critical inventory levels.")

    if (current_stock + reorder_qty) <= LOW_STOCK_THRESHOLD:
        reorder_qty = max(reorder_qty, float(TARGET_STOCK_BUFFER - current_stock))

    formatted_candidates = []
    for s in (candidates or suppliers):
        sid = s.get("supplier_id")
        formatted_candidates.append({
            "supplier_id": sid,
            "name": s.get("name") or s.get("supplier_name") or sid,
            "email": s.get("email"),
            "current_price": s.get("current_price") or s.get("unit_price"),
            "lead_time_days": s.get("lead_time_days", 2),
            "reliability_score": s.get("reliability_score", 0.95),
            "moq": s.get("moq", 10),
            "is_recommended": (sid == recommended_supplier_id),
        })

    recommended_supplier = next((s for s in formatted_candidates if s["is_recommended"]), formatted_candidates[0] if formatted_candidates else {})

    forecast = agent_eval.get("demand_forecast") or rec.get("demand_forecast") or {}
    pred_qty = rec.get("predicted_qty") or forecast.get("recommended_qty") or reorder_qty
    confidence = rec.get("forecast_confidence") or forecast.get("confidence_score", 85.0)
    is_irregular = rec.get("is_irregular_demand", forecast.get("is_irregular", False))
    irregular_reason = rec.get("irregularity_reason", forecast.get("irregularity_reason"))

    return {
        "item_id": req.item_id,
        "item_name": item.get("item_name") or item.get("name"),
        "current_stock": current_stock,
        "reorder_qty": reorder_qty,
        "predicted_quantity": pred_qty,
        "forecast_confidence": confidence,
        "is_irregular_demand": is_irregular,
        "irregularity_reason": irregular_reason,
        "demand_forecast": forecast,
        "projected_stock": current_stock + reorder_qty,
        "recommended_supplier": recommended_supplier,
        "justification": justification,
        "candidate_suppliers": formatted_candidates,
        "available_suppliers": formatted_candidates,
    }


@app.get("/api/inventory/{item_id}/forecast")
async def get_item_demand_forecast(item_id: str, owner_id: str = "OWNER001"):
    """Runs the demand forecasting ML model on previous sales records for a specific item."""
    from forecasting.engine import predict_demand_for_item
    try:
        return await predict_demand_for_item(item_id=item_id, owner_id=owner_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Demand forecasting failed: {str(exc)}")


@app.post("/api/procurement/trigger")
async def trigger_procurement(req: TriggerProcurementRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    active_jobs[job_id] = {
        "job_id": job_id,
        "item_id": req.item_id,
        "status": "INITIALIZING",
        "logs": [],
        "manual_override": None,
    }
    job_event_queues[job_id] = asyncio.Queue()

    background_tasks.add_task(background_procurement_worker, job_id, req)

    return {
        "job_id": job_id,
        "status": "QUEUED",
        "stream_url": f"/api/procurement/stream/{job_id}",
    }


@app.get("/api/procurement/stream/{job_id}")
async def stream_procurement_progress(job_id: str):
    if job_id not in job_event_queues:
        raise HTTPException(status_code=404, detail="Job stream not found")

    async def event_generator():
        q = job_event_queues[job_id]
        while True:
            log_entry = await q.get()
            yield f"data: {json.dumps(log_entry)}\n\n"
            if log_entry["status"] in ("COMPLETED", "FAILED"):
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/procurement/manual-resolve")
async def manual_resolve_job(req: ManualResolveRequest):
    if req.job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Active job not found")

    active_jobs[req.job_id]["manual_override"] = "CONFIRMED manual override" if req.decision == "ACCEPTED" else "REJECTED manual override"
    return {"message": f"Job {req.job_id} updated with decision: {req.decision}"}


@app.get("/api/procurement/orders")
async def get_procurement_orders():
    """Fetches all past purchase orders and fulfillment statuses."""
    try:
        orders = await db["purchase_orders"].find({}, {"_id": 0}).sort("created_at", -1).to_list(length=50)
    except Exception:
        orders = []
    return {"count": len(orders), "orders": orders}


# ---------------------------------------------------------
# Agent / LangGraph Integration Endpoints (backend-node bridge)
# ---------------------------------------------------------

@app.post("/agent/detect")
async def agent_detect(req: AgentDetectRequest):
    if not req.item_id and not req.item_name:
        raise HTTPException(status_code=400, detail="item_id or item_name is required")

    query: Dict[str, Any] = {"item_id": req.item_id} if req.item_id else {"item_name": req.item_name}

    owner_query = {**query}
    if req.owner_id:
        owner_query["owner_id"] = req.owner_id

    item = await db["inventory"].find_one(owner_query, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail=f"No inventory item found matching {query} for owner {req.owner_id}")

    item_id = item.get("item_id")
    item_name = item.get("item_name") or item.get("name")
    current_stock = float(item.get("current_stock", 0))
    # Fetch dynamic ML demand prediction for this item to determine its specific threshold
    from forecasting.engine import predict_demand_for_item
    item_threshold = float(item.get("low_stock_threshold", 15))
    try:
        forecast = await predict_demand_for_item(item_id=item_id, owner_id=req.owner_id or "OWNER001")
        ml_units = float(forecast.get("recommended_qty") or forecast.get("predicted_demand") or 0)
        dynamic_threshold = max(item_threshold, ml_units)
    except Exception:
        forecast = None
        dynamic_threshold = item_threshold

    # Dynamic ML Threshold Gate: If stock meets or exceeds its threshold, no risk
    if current_stock >= dynamic_threshold:
        return {
            "has_risk": False,
            "message": f"Stock is healthy ({current_stock} units >= {dynamic_threshold} ML threshold)",
            "item_id": item_id,
            "item_name": item_name,
            "current_stock": current_stock,
            "ml_threshold": dynamic_threshold,
            "candidate_suppliers": [],
        }

    avg_daily_usage = item.get("avg_daily_usage")
    days_to_stockout = (
        round(current_stock / avg_daily_usage, 1) if avg_daily_usage else None
    )

    thread_id = f"agent-{uuid.uuid4().hex[:12]}"
    config = {"configurable": {"thread_id": thread_id}}

    result = await graph.ainvoke(
        {
            "item_id": item_id,
            "owner_id": req.owner_id,
            "current_stock": current_stock,
            "avg_daily_usage": avg_daily_usage,
            "days_to_stockout": days_to_stockout,
            "trigger_reason": (
                f"Stock risk detected for {item_name}: {current_stock} units on hand "
                f"({'STOCKOUT RISK' if current_stock < 10 else 'STOCK WARNING'})."
            ),
        },
        config,
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=502, detail=result.get("error", "Agent graph failed"))

    interrupts = result.get("__interrupt__", [])
    if not interrupts:
        raise HTTPException(status_code=502, detail="Agent graph did not reach human approval")

    payload = interrupts[0].value
    recommendation = payload.get("recommendation") or {}
    candidates = payload.get("candidate_suppliers") or recommendation.get("candidate_suppliers", [])
    action_id = payload.get("action_id")

    suppliers = result.get("suppliers") or []
    chosen_supplier = next(
        (s for s in suppliers if s.get("supplier_id") == recommendation.get("supplier_id")),
        None,
    )

    forecast = result.get("demand_forecast") or recommendation.get("demand_forecast") or {}
    pred_qty = recommendation.get("predicted_qty") or forecast.get("recommended_qty") or recommendation.get("qty")
    confidence = recommendation.get("forecast_confidence") if recommendation.get("forecast_confidence") is not None else forecast.get("confidence_score", 85.0)
    is_irregular = recommendation.get("is_irregular_demand") if recommendation.get("is_irregular_demand") is not None else forecast.get("is_irregular", False)
    irregular_reason = recommendation.get("irregularity_reason") or forecast.get("irregularity_reason")

    return {
        "thread_id": thread_id,
        "action_id": action_id,
        "item_id": item_id,
        "item_name": item_name,
        "current_stock": current_stock,
        "predicted_quantity": pred_qty,
        "forecast_confidence": confidence,
        "is_irregular_demand": is_irregular,
        "irregularity_reason": irregular_reason,
        "demand_forecast": forecast,
        "recommendation": {
            "supplier_id": recommendation.get("supplier_id"),
            "supplier_name": (chosen_supplier or {}).get("name") or (chosen_supplier or {}).get("supplier_name"),
            "qty": recommendation.get("qty") or pred_qty,
            "predicted_qty": pred_qty,
            "forecast_confidence": confidence,
            "is_irregular_demand": is_irregular,
            "irregularity_reason": irregular_reason,
            "demand_forecast": forecast,
            "justification": recommendation.get("justification"),
            "candidate_suppliers": candidates,
        },
        "chosen_supplier": chosen_supplier,
        "candidate_suppliers": candidates,
        "suppliers_considered": suppliers,
    }


@app.post("/agent/purchase-order")
async def agent_purchase_order(req: AgentPurchaseOrderRequest):
    try:
        if req.decision not in ("approved", "rejected", "modified"):
            raise HTTPException(
                status_code=400, detail="decision must be 'approved', 'rejected', or 'modified'"
            )

        config = {"configurable": {"thread_id": req.thread_id}}

        selected_sid = req.selected_supplier_id or req.supplier_id
        selected_sname = req.supplier_name or req.selected_supplier_name

        if selected_sname and "jain" in str(selected_sname).lower():
            selected_sid = "SUP004"
            selected_sname = "Jain Tech Hub"
        elif selected_sid == "SUP004":
            selected_sname = selected_sname or "Jain Tech Hub"

        print(
            f"\n[FASTAPI] Processing decision='{req.decision}' for thread='{req.thread_id}' "
            f"with supplier_name='{selected_sname}' and supplier_id='{selected_sid}'"
        )

        order_qty = req.qty if req.qty is not None else req.order_qty

        resume_payload: Dict[str, Any] = {
            "decision": req.decision,
            "owner_id": req.owner_id or "OWNER001",
            "item_id": req.item_id,
            "action_id": req.action_id,
            "supplier_id": selected_sid,
            "selected_supplier_id": selected_sid,
            "supplier_name": selected_sname,
            "selected_supplier_name": selected_sname,
        }

        if order_qty is not None:
            resume_payload["qty"] = order_qty
            resume_payload["order_qty"] = order_qty

        if req.decision == "rejected" and req.rejection_reason:
            resume_payload["reason"] = req.rejection_reason

        # Pre-populate state values if LangGraph requires top-level keys
        try:
            state_updates = {
                "owner_id": req.owner_id or "OWNER001",
            }
            if req.action_id:
                state_updates["action_id"] = req.action_id
            if req.item_id:
                state_updates["item_id"] = req.item_id
            if order_qty is not None:
                state_updates["order_qty"] = order_qty
                state_updates["qty"] = order_qty

            await graph.aupdate_state(config, state_updates)
        except Exception as state_exc:
            print(f"[FASTAPI] Note on state sync: {state_exc}")

        result = None
        graph_resumed = False
        try:
            state = await graph.aget_state(config)
            if state and state.next:
                result = await graph.ainvoke(Command(resume=resume_payload), config)
                if result and result.get("status") != "error" and result.get("purchase_order"):
                    graph_resumed = True
            else:
                print(f"[FASTAPI] Thread '{req.thread_id}' is not paused at an interrupt. Proceeding to direct PO dispatch.")
        except Exception as exc:
            print(f"[FASTAPI WARNING] Could not resume thread '{req.thread_id}' via graph: {exc}")

        # Fallback to direct purchase order dispatch if graph thread could not be resumed
        if not graph_resumed or not result or not result.get("purchase_order"):
            if req.decision in ("approved", "modified"):
                print(f"[FASTAPI DIRECT DISPATCH] Dispatching purchase order directly for item='{req.item_id}', supplier='{selected_sname}'...")
                from mcp_service.client import mcp_client
                from agents.reply_watcher import schedule_reply_watch, _update_action_outcome
                from mcp_service.common import COL_INVENTORY, COL_PENDING_ACTIONS, get_db
                from bson import ObjectId

                db = await get_db()
                target_item_id = req.item_id
                target_item_name = getattr(req, "item_name", None)

                # Resolve item_id and item_name from action doc if needed
                if req.action_id:
                    try:
                        action_doc = await db[COL_PENDING_ACTIONS].find_one({
                            "$or": [
                                {"_id": ObjectId(req.action_id)} if ObjectId.is_valid(req.action_id) else {"_id": req.action_id},
                                {"action_id": str(req.action_id)},
                            ]
                        })
                        if action_doc:
                            target_item_id = target_item_id or action_doc.get("item_id")
                            target_item_name = target_item_name or action_doc.get("item_name")
                            if not selected_sid:
                                selected_sid = action_doc.get("selected_supplier_id") or action_doc.get("recommended_supplier_id")
                            if not selected_sname:
                                selected_sname = action_doc.get("selected_supplier_name") or action_doc.get("chosen_supplier")
                    except Exception as doc_exc:
                        print(f"[FASTAPI NOTE] Action doc lookup note: {doc_exc}")

                if not target_item_id and target_item_name:
                    inv_it = await db[COL_INVENTORY].find_one({"$or": [{"item_name": target_item_name}, {"name": target_item_name}]})
                    if inv_it:
                        target_item_id = inv_it.get("item_id") or target_item_name

                target_item_id = target_item_id or "EACC001"
                qty_to_use = float(order_qty if order_qty is not None else 10.0)

                supplier_id_to_pass = str(selected_sid) if selected_sid and str(selected_sid).lower() != "none" else ""
                supplier_name_to_pass = str(selected_sname) if selected_sname and str(selected_sname).lower() != "none" else None

                # Call send_purchase_order tool
                po = await mcp_client.call_tool(
                    "suppliers",
                    "send_purchase_order",
                    {
                        "supplier_id": supplier_id_to_pass,
                        "supplier_name": supplier_name_to_pass,
                        "items": [{"item_id": target_item_id, "qty": qty_to_use}],
                        "qty": qty_to_use,
                        "owner_id": req.owner_id or "OWNER001",
                    },
                )

                # Schedule reply watcher
                if po.get("po_id"):
                    schedule_reply_watch(
                        owner_id=req.owner_id or "OWNER001",
                        item_id=target_item_id,
                        qty=qty_to_use,
                        po=po,
                        action_id=req.action_id,
                    )

                po_tag = po.get("po_tag")
                if po_tag and req.action_id:
                    await _update_action_outcome(
                        db=db,
                        owner_id=req.owner_id or "OWNER001",
                        item_id=target_item_id,
                        action_id=req.action_id,
                        po_tag=po_tag,
                        po_id=po.get("po_id"),
                        status="po_sent",
                        supplier_outcome="awaiting_reply",
                        outcome_text=f"PO [{po_tag}] sent to {selected_sname or 'supplier'} — awaiting reply",
                        qty=qty_to_use,
                    )

                return {
                    "thread_id": req.thread_id,
                    "status": "completed",
                    "purchase_order": po,
                    "selected_supplier_id": selected_sid,
                    "selected_supplier_name": selected_sname,
                    "owner_decision": req.decision,
                }
            else:
                # Rejection fallback:
                from agents.reply_watcher import _update_action_outcome
                from mcp_service.common import get_db
                db = await get_db()
                if req.action_id:
                    await _update_action_outcome(
                        db=db,
                        owner_id=req.owner_id or "OWNER001",
                        item_id=req.item_id or "",
                        action_id=req.action_id,
                        status="rejected",
                        supplier_outcome="owner_rejected",
                        outcome_text="Rejected by owner",
                    )
                return {
                    "thread_id": req.thread_id,
                    "status": "completed",
                    "purchase_order": None,
                    "owner_decision": req.decision,
                }

        return {
            "thread_id": req.thread_id,
            "status": result.get("status"),
            "purchase_order": result.get("purchase_order"),
            "selected_supplier_id": result.get("selected_supplier_id") or selected_sid,
            "selected_supplier_name": result.get("selected_supplier_name") or selected_sname,
            "owner_decision": result.get("owner_decision"),
        }
    except HTTPException:
        raise
    except Exception as unhandled:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(unhandled))


@app.get("/agent-actions/")
async def list_agent_actions(limit: int = 100):
    """Raw audit trail for agent actions."""
    try:
        actions = await db["agent_actions"].find({}, {"_id": 0}).sort("timestamp", -1).to_list(
            length=limit
        )
    except Exception:
        actions = []
    return actions


@app.post("/agent/watch-reply")
async def agent_watch_reply(req: WatchReplyRequest):
    """Endpoint for backend-node to trigger reply watcher after custom reply."""
    from agents.reply_watcher import schedule_reply_watch
    po_dict = {
        "po_id": req.po_id,
        "po_tag": req.po_tag,
        "supplier_id": req.supplier_id,
        "supplier_name": req.supplier_name,
        "supplier_email": req.supplier_email,
        "email_delivery": {"sent": True},
    }
    schedule_reply_watch(
        owner_id=req.owner_id,
        item_id=req.item_id or "",
        qty=float(req.qty) if req.qty else 10.0,
        po=po_dict,
        action_id=req.action_id,
        is_custom_reply=True,
    )
    return {"status": "success", "message": f"Watching replies for {req.po_tag}"}


@app.post("/agent/escalate")
async def agent_escalate(req: EscalateRequest):
    """Triggered when owner declines/rejects an order via custom reply.
    Re-evaluates remaining suppliers excluding the declined one, runs the agent
    graph, and places a new recommendation on the owner's dashboard/screen.
    """
    from agents.reply_watcher import _escalate_to_next_supplier
    from mcp_service.common import COL_PURCHASE_ORDERS, COL_SUPPLIERS, COL_INVENTORY, get_db

    db = await get_db()

    item_id = req.item_id
    item_name = req.item_name
    qty = float(req.qty) if req.qty else 10.0

    # 1. Resolve details from PO if po_tag or po_id given
    if req.po_tag or req.po_id:
        po_query = []
        if req.po_tag:
            po_query.append({"po_tag": req.po_tag})
        if req.po_id:
            po_query.append({"po_id": req.po_id})
        po_doc = await db[COL_PURCHASE_ORDERS].find_one({"$or": po_query})
        if po_doc:
            if not item_id and po_doc.get("items"):
                item_id = po_doc["items"][0].get("item_id")
            if not req.supplier_id:
                req.supplier_id = po_doc.get("supplier_id")
            if not req.supplier_name:
                req.supplier_name = po_doc.get("supplier_name")
            if po_doc.get("items") and po_doc["items"][0].get("qty"):
                qty = float(po_doc["items"][0]["qty"])

    # 2. Resolve item_name / item_id from inventory
    if item_id and not item_name:
        inv_item = await db[COL_INVENTORY].find_one({"$or": [{"item_id": item_id}, {"id": item_id}]})
        if inv_item:
            item_name = inv_item.get("item_name") or inv_item.get("name") or item_id
    elif item_name and not item_id:
        inv_item = await db[COL_INVENTORY].find_one({"$or": [{"item_name": item_name}, {"name": item_name}]})
        if inv_item:
            item_id = inv_item.get("item_id") or inv_item.get("id") or item_name

    item_id = item_id or "UNKNOWN_ITEM"
    item_name = item_name or "Item"

    # 3. Build set of excluded supplier IDs
    excluded: set[str] = set(req.excluded_supplier_ids or [])
    if req.supplier_id:
        excluded.add(str(req.supplier_id))

    if req.supplier_name:
        sup_doc = await db[COL_SUPPLIERS].find_one({
            "$or": [{"name": req.supplier_name}, {"supplier_name": req.supplier_name}]
        })
        if sup_doc:
            excluded.add(str(sup_doc.get("supplier_id") or sup_doc.get("_id")))

    # Check past notifications for any previous suppliers
    if req.po_tag:
        past_notifs = await db["notifications"].find({"po_tag": req.po_tag}).to_list(20)
        for pn in past_notifs:
            if pn.get("supplier_id"):
                excluded.add(str(pn["supplier_id"]))

    sup_display = req.supplier_name or "Previous supplier"
    reason_str = req.reason or "Owner declined the order"
    outcome_message = f"Order with {sup_display} declined by owner: {reason_str}"

    # 4. Asynchronously launch escalation so the API returns immediately
    asyncio.create_task(
        _escalate_to_next_supplier(
            owner_id=req.owner_id,
            item_id=item_id,
            item_name=item_name,
            qty=qty,
            outcome_message=outcome_message,
            excluded_supplier_ids=excluded,
        )
    )
    return {"status": "success", "message": f"Escalating to next supplier for {item_name}"}



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)