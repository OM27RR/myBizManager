"""
mcp/common.py
=============

Shared helpers used by every MCP server's tools.py:

  1. A single point of access to the Mongo database, so all three servers
     (inventory, suppliers, notifications) agree on how to get a handle.
  2. The `agent_actions` audit-log writer — every tool call that reads
     or changes state gets a row here.

COLLECTION NAMES
-----------------
Matches the schema table in the architecture doc exactly:
    inventory, orders, suppliers, staff, customers, invoices, agent_actions
Plus two additive collections this MCP layer needs and writes to:
    purchase_orders   (created by suppliers/tools.py::send_purchase_order)
    notifications     (created by notifications/tools.py::send_notification)
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any, Optional

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

load_dotenv()

# --- Database handle -------------------------------------------------------

_mongo_client: Optional[AsyncIOMotorClient] = None


async def get_db() -> AsyncIOMotorDatabase:
    """
    Returns the shared AsyncIOMotorDatabase instance directly,
    bypassing database/mongodb.py.
    """
    global _mongo_client
    if _mongo_client is None:
        mongo_uri = (
            os.getenv("MONGODB_URI")
            or os.getenv("MONGO_URI")
            or "mongodb://localhost:27017"
        )
        _mongo_client = AsyncIOMotorClient(str(mongo_uri))

    db_name = os.getenv("DB_NAME") or "myBizManager"
    return _mongo_client[str(db_name)]


# --- Collection name constants ---------------------------------------------

COL_INVENTORY = "inventory"
COL_ORDERS = "orders"
COL_SUPPLIERS = "suppliers"
COL_INVOICES = "invoices"
COL_AGENT_ACTIONS = "agent_actions"
COL_PURCHASE_ORDERS = "purchase_orders"
COL_NOTIFICATIONS = "notifications"
COL_OWNERS = "owners"


# NOT the same collection as COL_AGENT_ACTIONS above. This is backend-node's
# `AgentAction` Mongoose model (backend-node/models/AgentAction.js) — the
# *actionable* "pending alert" a human resolves from the dashboard, as
# opposed to COL_AGENT_ACTIONS which is our own append-only audit log.
# That model has no explicit `collection:` override, so Mongoose's default
# pluralization of "AgentAction" applies: lowercase + "s" -> "agentactions".
# (Same trap documented next to `collection: 'inventory'` in Inventory.js —
# if that model ever gets an explicit `collection:` pin, update this too.)
# We write to it directly here (agents/reply_watcher.py) so a fresh
# next-best-supplier approval shows up on the owner's dashboard the same
# way the original recommendation did, without needing a Node<->FastAPI
# round trip — both sides already share one MongoDB database.
COL_PENDING_ACTIONS = "agentactions"


# --- Audit trail -------------------------------------------------------------

async def log_agent_action(
    action_type: str,
    trigger_reason: str,
    recommendation: Optional[dict[str, Any]] = None,
    owner_decision: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    """
    Writes one row to `agent_actions`.
    """
    db = await get_db()
    action_id = str(uuid.uuid4())
    doc = {
        "action_id": action_id,
        "type": action_type,
        "trigger_reason": trigger_reason,
        "recommendation": recommendation,
        "owner_decision": owner_decision,  # filled in later by /approve or /reject
        "metadata": metadata or {},
        "timestamp": time.time(),
    }
    await db[COL_AGENT_ACTIONS].insert_one(doc)
    return action_id


async def log_email_notification(
    owner_id: str,
    direction: str,
    status: str,
    subject: str,
    body: str,
    email_from: Optional[str] = None,
    email_to: Optional[str] = None,
    supplier_name: Optional[str] = None,
    item_id: Optional[str] = None,
    item_name: Optional[str] = None,
    po_id: Optional[str] = None,
    po_tag: Optional[str] = None,
) -> str:
    """
    Writes one row to `notifications` representing a single procurement
    email (outbound PO request or inbound supplier reply), for the
    frontend's color-coded Notifications page:
      - direction="outbound"                       -> yellow (owner -> supplier)
      - direction="inbound", status="confirmed"     -> green  (order placed)
      - direction="inbound", status in ("rejected",
        "timeout")                                  -> red    (not placed)

    Kept as a separate collection write (not reusing send_notification's
    generic dashboard ping) so the two feeds can evolve independently —
    this one is specifically an email audit trail, not a general alert.
    """
    db = await get_db()
    notification_id = str(uuid.uuid4())
    await db[COL_NOTIFICATIONS].insert_one(
        {
            "notification_id": notification_id,
            "owner_id": owner_id,
            "kind": "email",
            "direction": direction,  # "outbound" | "inbound"
            "status": status,  # "sent" | "failed" | "confirmed" | "rejected" | "timeout"
            "subject": subject,
            "body": body,
            "email_from": email_from,
            "email_to": email_to,
            "supplier_name": supplier_name,
            "item_id": item_id,
            "item_name": item_name,
            "po_id": po_id,
            "po_tag": po_tag,
            "read": False,
            "timestamp": time.time(),
        }
    )
    return notification_id


def tool_error(message: str) -> dict[str, Any]:
    """
    Uniform error shape returned BY tools (not raised as exceptions) so
    that the LLM-facing side of MCP gets a structured result.
    """
    return {"error": message}