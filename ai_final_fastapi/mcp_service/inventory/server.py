"""
mcp/inventory/server.py
=========================

The actual MCP server process for inventory. Thin by design: every tool
here just validates/shapes input and delegates to tools.py.

Run standalone (for testing with any MCP client, e.g. `mcp dev`):
    python -m mcp.inventory.server

Run for real: client.py spawns this as a subprocess over stdio and holds
the session open for the lifetime of the FastAPI app.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from mcp_service.inventory import tools

mcp = FastMCP("inventory")


@mcp.tool()
async def get_stock_level(item_id: str) -> dict:
    """Get the current stock snapshot (current_stock, reorder_threshold,
    avg_daily_usage, last_updated) for a single inventory item."""
    return await tools.get_stock_level(item_id)


@mcp.tool()
async def get_low_stock_items(limit: int = 50) -> dict:
    """List all inventory items whose current_stock is at or below their
    reorder_threshold. Used by the risk-detection scheduler and by
    StockRiskDetected to batch-check items in one call."""
    return await tools.get_low_stock_items(limit=limit)


@mcp.tool()
async def get_usage_history(item_id: str, days: int = 30) -> dict:
    """Compute avg_daily_usage and days_to_stockout for an item using
    real order history over the last `days` days (falls back to the
    item's stored avg_daily_usage if order history is too sparse)."""
    return await tools.get_usage_history(item_id, days=days)


@mcp.tool()
async def adjust_stock(item_id: str, delta: float, reason: str) -> dict:
    """Apply a stock change (e.g. +15 when a PO is received, -0.5kg for
    spoilage). Every call is written to the agent_actions audit log."""
    return await tools.adjust_stock(item_id, delta, reason)


@mcp.tool()
async def forecast_demand(item_id: str, lead_time_days: int = 2, review_days: int = 14) -> dict:
    """Forecast future demand and calculate replenishment quantity using ML demand forecasting engine."""
    return await tools.forecast_demand(item_id, lead_time_days=lead_time_days, review_days=review_days)


if __name__ == "__main__":
    mcp.run(transport="stdio")
