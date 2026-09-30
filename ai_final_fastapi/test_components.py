"""
test_components.py — Isolated Unit and Status Health Check for Core Modules
"""

import os
import asyncio
import certifi
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
DB_NAME = os.getenv("DB_NAME") or "business_agent"


async def check_mongo():
    print("[1/3] Testing MongoDB Atlas Connection...")
    try:
        client = AsyncIOMotorClient(
            str(MONGO_URI),
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=10000,
            socketTimeoutMS=10000,
        )
        db = client[str(DB_NAME)]
        cols = await db.list_collection_names()
        print(f"      [PASS] MongoDB Atlas Connected! Found collections: {cols}")
        client.close()
        return True
    except Exception as e:
        print(f"      [FAIL] MongoDB Atlas Error: {e}")
        return False


async def check_mcp_and_tools():
    print("[2/3] Testing MCP Supplier Tools...")
    try:
        from mcp_service.client import mcp_client
        await mcp_client.connect_all()
        res = await mcp_client.call_tool("suppliers", "get_suppliers_for_item", {"item_id": "EACC001"})
        count = len(res.get("suppliers", []))
        print(f"      [PASS] MCP Service Connected! Found {count} suppliers stocking 'EACC001'.")
        return True
    except Exception as e:
        print(f"      [FAIL] MCP Tool Error: {e}")
        return False


async def check_langgraph_agent():
    print("[3/3] Testing LangGraph AI Strategy Graph...")
    try:
        from agents.graph import graph
        from mcp_service.client import mcp_client

        # Ensure MCP connection is active for the graph
        await mcp_client.connect_all()

        config = {"configurable": {"thread_id": "health-check-thread"}}
        eval_result = await graph.ainvoke(
            {"item_id": "EACC001", "owner_id": "OWNER001", "current_stock": 2.0},
            config,
        )
        print("      [PASS] LangGraph Agent Executed Successfully!")
        return True
    except Exception as e:
        print(f"      [FAIL] LangGraph Graph Error: {e}")
        return False


async def main():
    print("=" * 60)
    print(" RUNNING INTERNAL MODULE & SUBSYSTEM HEALTH CHECKS")
    print("=" * 60)

    await check_mongo()
    await check_mcp_and_tools()
    await check_langgraph_agent()

    # Close MCP connection after all tests finish
    try:
        from mcp_service.client import mcp_client
        await mcp_client.close()
    except Exception:
        pass

    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())