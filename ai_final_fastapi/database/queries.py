"""
Database query functions.

These functions are used by the backend,
MCP tools, and LangGraph agents.

Every business-data query requires owner_id
so that one business cannot access another
business's data.
"""

from datetime import datetime, timezone
from typing import Optional, Any

from database.mongodb import (
    owners_collection,
    inventory_collection,
    suppliers_collection,
    agent_actions_collection
)


def get_utc_now():
    """Returns timezone-aware UTC datetime and ISO string."""
    now = datetime.now(timezone.utc)
    return now, now.isoformat()


# ============================================================
# OWNERS
# ============================================================

async def create_owner(owner: Any):
    """Create a new business owner."""
    data = owner.model_dump() if hasattr(owner, "model_dump") else dict(owner)
    result = await owners_collection.insert_one(data)
    return str(result.inserted_id)


async def get_owner(owner_id: str):
    """Get an owner using owner_id."""
    return await owners_collection.find_one({"owner_id": owner_id})


async def get_owner_by_email(owner_email: str):
    """Get an owner using email."""
    return await owners_collection.find_one({"owner_email": owner_email})


async def get_all_owners():
    """Return all owners."""
    cursor = owners_collection.find({})
    return await cursor.to_list(length=None)


# ============================================================
# INVENTORY
# ============================================================

async def get_inventory(owner_id: str):
    """Get all inventory belonging to one owner."""
    cursor = inventory_collection.find({"owner_id": owner_id})
    return await cursor.to_list(length=None)


async def get_item(owner_id: str, item_id: str):
    """Get one inventory item belonging to an owner."""
    return await inventory_collection.find_one(
        {
            "owner_id": owner_id,
            "item_id": item_id
        }
    )


async def get_low_stock_items(owner_id: str):
    """Return inventory items whose stock is low."""
    cursor = inventory_collection.find(
        {
            "owner_id": owner_id,
            "$or": [
                {"status": "low_stock"},
                {"status": "Low Stock"},
                {"current_stock": {"$lte": 15}}
            ]
        }
    )
    return await cursor.to_list(length=None)


async def create_inventory_item(item: Any):
    """Create an inventory item."""
    data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
    now_dt, now_iso = get_utc_now()
    data.setdefault("last_updated", now_iso)
    data.setdefault("last_updated_dt", now_dt)

    result = await inventory_collection.insert_one(data)
    return str(result.inserted_id)


async def update_stock(
    owner_id: str,
    item_id: str,
    new_stock: float
):
    """
    Update current stock for an owner's item.
    Fixes last_updated by ensuring valid ISO timestamp and BSON Date.
    """
    if new_stock < 0:
        raise ValueError("Stock cannot be negative")

    now_dt, now_iso = get_utc_now()

    result = await inventory_collection.update_one(
        {
            "owner_id": owner_id,
            "item_id": item_id
        },
        {
            "$set": {
                "current_stock": float(new_stock),
                "last_updated": now_iso,
                "updated_at": now_iso
            },
            "$currentDate": {
                "last_updated_dt": True
            }
        }
    )

    return result.modified_count > 0


async def increment_stock_after_order(
    owner_id: str,
    item_id: str,
    qty: float,
    status: str = "In Stock"
):
    """
    Directly increments inventory when a purchase order is fulfilled,
    and updates the last_updated timestamp properly.
    """
    now_dt, now_iso = get_utc_now()

    result = await inventory_collection.update_one(
        {
            "owner_id": owner_id,
            "$or": [{"item_id": item_id}, {"item_name": item_id}]
        },
        {
            "$inc": {"current_stock": float(qty)},
            "$set": {
                "status": status,
                "last_updated": now_iso,
                "updated_at": now_iso
            },
            "$currentDate": {
                "last_updated_dt": True
            }
        }
    )
    return result.modified_count > 0


async def update_inventory_status(
    owner_id: str,
    item_id: str,
    status: str
):
    """Update the status and last_updated of an inventory item."""
    now_dt, now_iso = get_utc_now()

    result = await inventory_collection.update_one(
        {
            "owner_id": owner_id,
            "item_id": item_id
        },
        {
            "$set": {
                "status": status,
                "last_updated": now_iso,
                "updated_at": now_iso
            },
            "$currentDate": {
                "last_updated_dt": True
            }
        }
    )

    return result.modified_count > 0


async def delete_inventory_item(
    owner_id: str,
    item_id: str
):
    """Delete an inventory item belonging to an owner."""
    result = await inventory_collection.delete_one(
        {
            "owner_id": owner_id,
            "item_id": item_id
        }
    )

    return result.deleted_count > 0


# ============================================================
# SUPPLIERS
# ============================================================

async def get_suppliers(owner_id: str):
    """Get all suppliers belonging to an owner."""
    cursor = suppliers_collection.find({"owner_id": owner_id})
    return await cursor.to_list(length=None)


async def get_supplier(
    owner_id: str,
    supplier_id: str
):
    """Get one supplier belonging to an owner."""
    return await suppliers_collection.find_one(
        {
            "owner_id": owner_id,
            "supplier_id": supplier_id
        }
    )


async def get_suppliers_for_item(
    owner_id: str,
    item_name: str
):
    """Return suppliers that sell the requested item."""
    cursor = suppliers_collection.find(
        {
            "owner_id": owner_id,
            "$or": [
                {"items sold": item_name},
                {"items_sold": item_name},
                {"catalog.item_name": item_name},
                {"catalog.item_id": item_name}
            ]
        }
    )

    return await cursor.to_list(length=None)


async def create_supplier(supplier: Any):
    """Create a supplier."""
    data = supplier.model_dump() if hasattr(supplier, "model_dump") else dict(supplier)
    result = await suppliers_collection.insert_one(data)
    return str(result.inserted_id)


async def delete_supplier(
    owner_id: str,
    supplier_id: str
):
    """Delete a supplier belonging to an owner."""
    result = await suppliers_collection.delete_one(
        {
            "owner_id": owner_id,
            "supplier_id": supplier_id
        }
    )

    return result.deleted_count > 0


# ============================================================
# AGENT ACTIONS
# ============================================================

async def create_agent_action(action: Any):
    """Create an agent action/audit record."""
    action_data = action.model_dump() if hasattr(action, "model_dump") else dict(action)

    if action_data.get("po_details") is not None:
        action_data["po_details"] = dict(action_data["po_details"])

    now_dt, now_iso = get_utc_now()
    action_data.setdefault("timestamp", now_dt)
    action_data.setdefault("created_at", now_iso)

    result = await agent_actions_collection.insert_one(action_data)
    return str(result.inserted_id)


async def get_agent_action(
    owner_id: str,
    action_id: str
):
    """Get one agent action belonging to an owner."""
    return await agent_actions_collection.find_one(
        {
            "owner_id": owner_id,
            "action_id": action_id
        }
    )


async def get_all_agent_actions(owner_id: str):
    """Get all agent actions for an owner."""
    cursor = agent_actions_collection.find(
        {"owner_id": owner_id}
    ).sort("timestamp", -1)

    return await cursor.to_list(length=None)


async def update_agent_action_status(
    owner_id: str,
    action_id: str,
    status: str,
    selected_supplier_id: Optional[str] = None,
    rejection_reason: Optional[str] = None
):
    """Update the approval status and selected supplier of an agent action."""
    valid_statuses = {
        "pending",
        "approved",
        "rejected",
        "modified"
    }

    if status not in valid_statuses:
        raise ValueError(
            f"Invalid status '{status}'. Must be one of {valid_statuses}"
        )

    now_dt, now_iso = get_utc_now()
    update_data: dict[str, Any] = {
        "status": status,
        "decided_at": now_dt,
        "decided_at_iso": now_iso
    }

    if selected_supplier_id:
        update_data["selected_supplier_id"] = selected_supplier_id

    if rejection_reason is not None:
        update_data["rejection_reason"] = rejection_reason

    result = await agent_actions_collection.update_one(
        {
            "owner_id": owner_id,
            "action_id": action_id
        },
        {
            "$set": update_data
        }
    )

    return result.modified_count > 0


async def update_purchase_order_details(
    owner_id: str,
    action_id: str,
    qty: float,
    total_cost: float,
    supplier_id: Optional[str] = None
):
    """Store purchase-order information after approval."""
    now_dt, now_iso = get_utc_now()

    update_payload: dict[str, Any] = {
        "po_sent": True,
        "po_details": {
            "qty": qty,
            "total_cost": total_cost,
            "supplier_id": supplier_id,
            "updated_at": now_iso
        }
    }
    if supplier_id:
        update_payload["selected_supplier_id"] = supplier_id

    result = await agent_actions_collection.update_one(
        {
            "owner_id": owner_id,
            "action_id": action_id
        },
        {
            "$set": update_payload
        }
    )

    return result.modified_count > 0


async def mark_notification_sent(
    owner_id: str,
    action_id: str
):
    """Mark owner notification as sent."""
    now_dt, now_iso = get_utc_now()
    result = await agent_actions_collection.update_one(
        {
            "owner_id": owner_id,
            "action_id": action_id
        },
        {
            "$set": {
                "notification_sent": True,
                "notified_at": now_iso
            }
        }
    )

    return result.modified_count > 0