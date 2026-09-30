"""
smoke_test.py — Human-in-the-Loop Supplier Selection & Autonomous Email Dispatch
"""

import os
import time
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
DB_NAME = os.getenv("DB_NAME") or "business_agent"

mongo_client = None

async def connect_to_mongo():
    global mongo_client
    mongo_client = AsyncIOMotorClient(str(MONGO_URI))
    return mongo_client[str(DB_NAME)]

async def close_mongo_connection():
    global mongo_client
    if mongo_client:
        mongo_client.close()

from mcp_service.client import mcp_client
from agents.graph import graph
from mcp_service.suppliers.tools import (
    check_inbox_for_reply,
    classify_supplier_reply,
    confirm_and_update_stock,
)


async def main():
    print("1. Connecting to MongoDB Atlas...")
    db = await connect_to_mongo()
    print(f"   Connected to database: {DB_NAME}")

    LOW_STOCK_THRESHOLD = 15
    TARGET_STOCK_BUFFER = 40

    items = await db["inventory"].find(
        {"current_stock": {"$lte": LOW_STOCK_THRESHOLD}},
        {"_id": 0}
    ).to_list(length=100)

    if not items:
        print(f"\n[ALL GOOD] No items currently under stock threshold ({LOW_STOCK_THRESHOLD}).")
        await close_mongo_connection()
        return

    print(f"\n--- Low Stock Items Needing Reorder (Stock <= {LOW_STOCK_THRESHOLD}) ---")
    for idx, it in enumerate(items, 1):
        print(f"[{idx}] {it.get('item_name')} ({it.get('item_id')}) | Current Stock: {it.get('current_stock')} [CRITICAL]")
    print("----------------------------------------------------------------------")

    user_choice = input(f"Select item number to reorder [1-{len(items)}] (default 1): ").strip()
    try:
        chosen_idx = int(user_choice) - 1 if user_choice else 0
        item = items[chosen_idx]
    except (ValueError, IndexError):
        item = items[0]

    item_id = item.get("item_id")
    item_name = item.get("item_name")
    current_stock = float(item.get("current_stock", 0))
    owner_id = item.get("owner_id", "OWNER001")

    print(f"\n>> Target Product: {item_name} ({item_id}) | Current Stock: {current_stock} units")

    print("\n2. Connecting MCP Tools & Running AI Strategy Agent...")
    await mcp_client.connect_all()

    # Step 1: Query qualified suppliers
    res = await mcp_client.call_tool("suppliers", "get_suppliers_for_item", {"item_id": item_id})
    suppliers = res.get("suppliers", [])

    if not suppliers:
        print(f"No suppliers found stocking {item_id}.")
        await mcp_client.close()
        await close_mongo_connection()
        return

    # Run LangGraph workflow to evaluate inventory and pick the best recommendation
    unique_thread_id = f"ai-reason-{item_id}-{int(time.time())}"
    config = {"configurable": {"thread_id": unique_thread_id}}

    agent_eval = await graph.ainvoke(
        {
            "item_id": item_id,
            "owner_id": owner_id,
            "current_stock": current_stock,
        },
        config,
    )

    interrupts = agent_eval.get("__interrupt__", [])
    if interrupts:
        rec = interrupts[0].value.get("recommendation", {})
        reorder_qty = float(rec.get("qty", 25.0))
        recommended_supplier_id = rec.get("supplier_id")
        justification = rec.get("justification", "Restocking critical inventory levels.")
    else:
        rec = agent_eval.get("recommendation", {})
        reorder_qty = float(rec.get("qty", 25.0))
        recommended_supplier_id = rec.get("supplier_id")
        justification = rec.get("justification", "Restocking critical inventory levels.")

    if (current_stock + reorder_qty) <= LOW_STOCK_THRESHOLD:
        reorder_qty = max(reorder_qty, float(TARGET_STOCK_BUFFER - current_stock))

    # Match recommended supplier details
    recommended_supplier = next((s for s in suppliers if s.get("supplier_id") == recommended_supplier_id), suppliers[0])

    print("\n" + "=" * 65)
    print(" [AGENT RECOMMENDATION & JUSTIFICATION]")
    print("=" * 65)
    print(f"Recommended Supplier: {recommended_supplier.get('name')} ({recommended_supplier.get('supplier_id')})")
    print(f"Offered Price:        Rs.{recommended_supplier.get('current_price')}/unit")
    print(f"Reliability Score:    {recommended_supplier.get('reliability_score', 0.95) * 100}%")
    print(f"Order Quantity:       {reorder_qty} units")
    print(f"Projected Stock:      {current_stock + reorder_qty} units")
    print(f"\nAI Reason: {justification}")
    print("-" * 65)

    print("\nAvailable Supplier Options:")
    for idx, s in enumerate(suppliers, 1):
        star = " ★ (Recommended)" if s.get("supplier_id") == recommended_supplier.get("supplier_id") else ""
        print(f"  [{idx}] {s.get('name')} | Rs.{s.get('current_price')} | Score: {s.get('reliability_score')}{star}")

    # Human-in-the-Loop decision prompt
    prompt_choice = input(f"\nApprove recommendation [1] or select another supplier number [1-{len(suppliers)}]: ").strip()
    try:
        chosen_sup_idx = int(prompt_choice) - 1 if prompt_choice else 0
        selected_supplier = suppliers[chosen_sup_idx]
    except (ValueError, IndexError):
        selected_supplier = recommended_supplier

    print(f"\n>> Selected Supplier: {selected_supplier.get('name')} ({selected_supplier.get('email')})")

    # Step 3: Outbound SMTP Dispatch to Chosen Supplier
    send_time = time.time()
    sup_id = selected_supplier.get("supplier_id")
    sup_name = selected_supplier.get("name")
    sup_email = selected_supplier.get("email")

    po_res = await mcp_client.call_tool(
        "suppliers",
        "send_purchase_order",
        {"supplier_id": sup_id, "items": [{"item_id": item_id, "qty": reorder_qty}]},
    )
    po_tag = po_res.get("po_tag")
    po_id = po_res.get("po_id")
    delivery = po_res.get("email_delivery", {})

    if not delivery.get("sent"):
        print(f"\n[ERROR] Email dispatch to {sup_email} failed: {delivery.get('error')}")
        await mcp_client.close()
        await close_mongo_connection()
        return

    print(f">> [REAL EMAIL SENT] PO Email delivered to {sup_email} with subject tag [{po_tag}].")
    print(f">> Agent is actively monitoring inbox for reply matching '{po_tag}'...")

    # Step 4: 300-Second IMAP Inbox Listener
    poll_timeout = 300
    poll_interval = 5
    reply_received = None

    while time.time() - send_time < poll_timeout:
        reply_received = check_inbox_for_reply(
            supplier_email=sup_email,
            po_tag=po_tag,
            sent_after_timestamp=send_time,
        )
        if reply_received:
            break
        elapsed = int(time.time() - send_time)
        print(f"   Listening for incoming reply on phone... ({elapsed}s / {poll_timeout}s)")
        await asyncio.sleep(poll_interval)

    if not reply_received:
        print(f"\n[TIMEOUT] No reply received from {sup_name} within {poll_timeout}s.")
        await mcp_client.close()
        await close_mongo_connection()
        return

    print(f"\n>> Received Live Email Reply:\n\"\"\"{reply_received}\"\"\"")

    # Step 5: LLM Intent Evaluation & MongoDB Update
    print("\n>> Analyzing response intent with LLM...")
    decision = await classify_supplier_reply(reply_received)
    print(f">> LLM Verdict: {decision}")

    if decision == "ACCEPTED":
        print(f"\n>> SUCCESS: {sup_name} accepted the purchase order!")
        print(f">> Updating MongoDB Atlas stock: +{reorder_qty} units...")
        await confirm_and_update_stock(item_id=item_id, qty=reorder_qty, po_id=po_id)

        updated = await db["inventory"].find_one({"item_id": item_id}, {"_id": 0})
        print(f">> New Live Inventory Stock for {item_name}: {updated.get('current_stock')} units [RESTOCKED > {LOW_STOCK_THRESHOLD}]")
    else:
        print(f"\n>> DECLINED: {sup_name} cannot fulfill (out of stock / rejected).")

    await mcp_client.close()
    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())