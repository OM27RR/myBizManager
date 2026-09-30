"""
mcp/suppliers/server.py
=========================

Run standalone: python -m mcp.suppliers.server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from mcp_service.suppliers import tools

mcp = FastMCP("suppliers")


@mcp.tool()
async def get_suppliers_for_item(item_id: str, owner_id: str | None = None) -> dict:
    """Find all suppliers that stock the given item for an owner, with lead time,
    reliability score, and current listed price. Used by
    SupplierLookupAgent."""
    return await tools.get_suppliers_for_item(item_id, owner_id=owner_id)


@mcp.tool()
async def get_price_history(supplier_id: str, item_id: str, limit: int = 12) -> dict:
    """Get recent price history for a supplier/item pair and the percent
    change vs the previous recorded price. Used by
    PriceComparisonAgent to detect price spikes."""
    return await tools.get_price_history(supplier_id, item_id, limit=limit)


@mcp.tool()
async def send_purchase_order(
    supplier_id: str,
    items: list[dict],
    qty: float | None = None,
    supplier_name: str | None = None,
    owner_id: str | None = None,
) -> dict:
    """Create and dispatch a purchase order to a supplier. items is a
    list of {item_id, qty}. Dispatches via user's connected Gmail OAuth
    if available, or falls back to system SMTP."""
    return await tools.send_purchase_order(
        supplier_id,
        items,
        qty=qty,
        supplier_name=supplier_name,
        owner_id=owner_id,
    )



if __name__ == "__main__":
    mcp.run(transport="stdio")
