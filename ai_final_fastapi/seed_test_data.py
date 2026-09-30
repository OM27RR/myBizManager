"""
smoke_test.py — Fully dynamic interactive test.
Lists all inventory items from MongoDB Atlas and lets you choose 
which one to run through the LangGraph AI workflow.
"""

import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from langgraph.types import Command

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


async def main():
    print("1. Connecting to MongoDB Atlas...")
    db = await connect_to_mongo()
    print(f"   Connected to database: {DB_NAME}")

    # Fetch all items from inventory collection
    items = await db["inventory"].find({}, {"_id": 0}).to_list(length=100)
    if not items:
        print("ERROR: No items found in inventory collection.")
        await close_mongo_connection()
        return

    # Display items to choose from
    print("\n--- Available Inventory Items ---")
    for idx, it in enumerate(items, 1):
        print(f"[{idx}] {it.get('item_name')} (ID: {it.get('item_id')}) | Current Stock: {it.get('current_stock')}")
    print("---------------------------------")

    # Dynamic selection
    user_choice = input(f"\nSelect item number [1-{len(items)}] or press Enter for [1]: ").strip()
    try:
        chosen_idx = int(user_choice) - 1 if user_choice else 0
        item = items[chosen_idx]
    except (ValueError, IndexError):
        item = items[0]

    item_id = item.get("item_id")
    owner_id = item.get("owner_id", "OWNER001")
    current_stock = item.get("current_stock", 10)
    avg_daily_usage = item.get("avg_daily_usage", 4)
    days_to_stockout = round(current_stock / avg_daily_usage, 1) if avg_daily_usage else 1

    print(f"\n>> Selected: {item.get('item_name')} ({item_id})")
    print(f">> Stock: {current_stock} units | Daily Usage: {avg_daily_usage} | Days to Stockout: {days_to_stockout}")

    print("\n2. Connecting MCP servers...")
    await mcp_client.connect_all()
    print("   OK — Connected Tools:", await mcp_client.list_tools("suppliers"))

    print("\n3. Running LangGraph AI Workflow...")
    config = {"configurable": {"thread_id": f"human-interactive-{item_id}"}}

    result = await graph.ainvoke(
        {
            "item_id": item_id,
            "owner_id": owner_id,
            "current_stock": current_stock,
            "avg_daily_usage": avg_daily_usage,
            "days_to_stockout": days_to_stockout,
        },
        config,
    )

    interrupts = result.get("__interrupt__", [])
    if interrupts:
        interrupt_val = interrupts[0].value
        rec = interrupt_val.get("recommendation", {})

        print("\n" + "=" * 55)
        print(" [HUMAN-IN-THE-LOOP APPROVAL REQUIRED]")
        print("=" * 55)
        print(f"Item:           {item.get('item_name')} ({item_id})")
        print(f"Recommended To: Supplier {rec.get('supplier_id')}")
        print(f"Order Quantity: {rec.get('qty')} units")
        print(f"Justification:  {rec.get('justification')}")
        if rec.get("risk_notes"):
            print(f"Risk Notes:     {rec.get('risk_notes')}")
        print("-" * 55)

        choice = input("Enter decision (1: Approve, 2: Reject, 3: Modify) [default: 1]: ").strip()

        if choice in ("1", "approve", "a", ""):
            resume_payload = {"decision": "approved"}
            print("\n>> User APPROVED the recommendation.")

        elif choice in ("2", "reject", "r"):
            reason = input("Enter rejection reason (optional): ").strip()
            resume_payload = {
                "decision": "rejected",
                "reason": reason or "Rejected by manager.",
            }
            print("\n>> User REJECTED the recommendation.")

        elif choice in ("3", "modify", "m"):
            new_qty = input(f"Enter new quantity [current: {rec.get('qty')}]: ").strip()
            new_supplier = input(f"Enter supplier ID [current: {rec.get('supplier_id')}]: ").strip()
            resume_payload = {
                "decision": "modified",
                "qty": float(new_qty) if new_qty else rec.get("qty"),
                "supplier_id": new_supplier or rec.get("supplier_id"),
            }
            print(f"\n>> User MODIFIED the recommendation: {resume_payload}")
        else:
            resume_payload = {"decision": "rejected", "reason": "Invalid user input."}

        print("\n4. Resuming graph with user decision...")
        final_state = await graph.ainvoke(
            Command(resume=resume_payload),
            config=config,
        )

        print("\n" + "=" * 55)
        print(" [FINAL WORKFLOW RESULT]")
        print("=" * 55)
        print("Status:        ", final_state.get("status"))
        print("Owner Decision:", final_state.get("owner_decision"))
        if final_state.get("purchase_order"):
            print("Purchase Order:", final_state.get("purchase_order"))
        print("=" * 55)

    await mcp_client.close()
    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())