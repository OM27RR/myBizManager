"""
mcp/inventory/tools.py
=======================

Pure implementation functions for the inventory MCP server. Kept separate
from server.py so:
  - They're unit-testable without spinning up an MCP stdio process.
  - server.py stays a thin @mcp.tool() registration layer.

Schema assumed (matches architecture doc's `inventory` collection):
    item_id, name, current_stock, reorder_threshold, avg_daily_usage,
    last_updated

Schema assumed for `orders` (used for real usage-history aggregation,
falling back to avg_daily_usage if there isn't enough order history yet):
    order_id, items: [{item_id, qty}], timestamp, customer_id, status
"""

from __future__ import annotations

import time
from typing import Any

from ..common import COL_INVENTORY, COL_ORDERS, get_db, log_agent_action, tool_error


async def get_stock_level(item_id: str) -> dict[str, Any]:
    """
    Current stock snapshot for one item. This is the deterministic,
    cheap Step-1 monitoring read — no LLM involved when called from the
    scheduler; it's exposed as an MCP tool too so agent nodes (e.g.
    RecommendationAgent double-checking before finalizing) can re-read
    live state instead of relying on stale graph state.
    """
    db = await get_db()
    item = await db[COL_INVENTORY].find_one({"item_id": item_id}, {"_id": 0})
    if not item:
        return tool_error(f"No inventory item found with item_id='{item_id}'")
    return item


async def get_low_stock_items(limit: int = 50) -> dict[str, Any]:
    """
    Items where current_stock <= reorder_threshold. This is what the
    FastAPI scheduler (Step 1) polls, and also what StockRiskDetected
    can call to batch-check risk instead of one item at a time.
    """
    db = await get_db()
    cursor = db[COL_INVENTORY].find(
        {"$expr": {"$lte": ["$current_stock", "$reorder_threshold"]}},
        {"_id": 0},
    ).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"count": len(items), "items": items}


async def get_usage_history(item_id: str, days: int = 30) -> dict[str, Any]:
    """
    Days-to-stockout prediction input (Step 2). Prefers a real
    aggregation over the `orders` collection for the last `days`; if
    there isn't enough order data yet (cold start / new item), falls
    back to the item's stored avg_daily_usage field so the demo still
    works on day one of seeded data.
    """
    db = await get_db()
    item = await db[COL_INVENTORY].find_one({"item_id": item_id}, {"_id": 0})
    if not item:
        return tool_error(f"No inventory item found with item_id='{item_id}'")

    cutoff = time.time() - days * 86400
    pipeline = [
        {"$match": {"timestamp": {"$gte": cutoff}}},
        {"$unwind": "$items"},
        {"$match": {"items.item_id": item_id}},
        {
            "$group": {
                "_id": None,
                "total_qty": {"$sum": "$items.qty"},
                "order_count": {"$sum": 1},
            }
        },
    ]
    result = await db[COL_ORDERS].aggregate(pipeline).to_list(length=1)

    if result and result[0]["total_qty"] > 0:
        total_qty = result[0]["total_qty"]
        avg_daily_usage = round(total_qty / days, 2)
        source = "orders_aggregation"
    else:
        avg_daily_usage = item.get("avg_daily_usage", 0)
        source = "stored_avg_daily_usage_fallback"

    current_stock = item.get("current_stock", 0)
    days_to_stockout = (
        round(current_stock / avg_daily_usage, 1) if avg_daily_usage > 0 else None
    )

    return {
        "item_id": item_id,
        "name": item.get("name"),
        "current_stock": current_stock,
        "reorder_threshold": item.get("reorder_threshold"),
        "avg_daily_usage": avg_daily_usage,
        "days_to_stockout": days_to_stockout,
        "usage_source": source,
        "window_days": days,
    }


async def adjust_stock(item_id: str, delta: float, reason: str) -> dict[str, Any]:
    """
    Applies a stock change (positive = restock received, negative =
    manual correction / spoilage write-off). This is the one *write*
    tool in the inventory server, so every call is logged to
    agent_actions for audit — this is intentionally NOT called by
    PurchaseOrderAgent on order placement (stock doesn't change until
    goods are actually received); it's here for the receiving-dock
    confirmation flow and manual dashboard corrections.
    """
    db = await get_db()
    item = await db[COL_INVENTORY].find_one({"item_id": item_id})
    if not item:
        return tool_error(f"No inventory item found with item_id='{item_id}'")

    new_stock = item.get("current_stock", 0) + delta
    await db[COL_INVENTORY].update_one(
        {"item_id": item_id},
        {"$set": {"current_stock": new_stock, "last_updated": time.time()}},
    )
    await log_agent_action(
        action_type="stock_adjustment",
        trigger_reason=reason,
        recommendation={"item_id": item_id, "delta": delta},
        metadata={"new_stock": new_stock},
    )
    return {"item_id": item_id, "previous_stock": item.get("current_stock", 0),
            "delta": delta, "new_stock": new_stock}


async def forecast_demand(item_id: str, lead_time_days: int = 2, review_days: int = 14) -> dict[str, Any]:
    """Forecast future demand and calculate replenishment quantity using ML demand forecasting engine."""
    from forecasting.engine import predict_demand_for_item
    return await predict_demand_for_item(
        item_id=item_id, lead_time_days=lead_time_days, review_period_days=review_days
    )

