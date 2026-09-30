"""
mcp/notifications/tools.py
=============================

Two jobs, kept in one server because they're both "get a message in
front of a human":

  1. Write to the `notifications` collection — this is what your MERN
     dashboard polls / subscribes to (WebSocket or SSE, per Step 5) for
     the live "Agent is checking suppliers..." / pending-approval feed.
     This ALWAYS happens, regardless of channel, so the in-app feed
     never depends on external creds being configured.

  2. Best-effort external dispatch (email / WhatsApp Cloud API / Slack)
     if the relevant env vars are set. Each channel degrades gracefully
     to a no-op + explanatory note if unconfigured, same pattern as
     suppliers/tools.py::_dispatch_po_externally, so a hackathon demo
     never crashes because SMTP creds weren't set.

Env vars checked (all optional):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
    WHATSAPP_CLOUD_API_TOKEN, WHATSAPP_CLOUD_API_PHONE_ID
    SLACK_WEBHOOK_URL
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any, Literal

from ..common import COL_NOTIFICATIONS, get_db

Channel = Literal["dashboard", "email", "whatsapp", "slack"]


async def _persist_for_dashboard(owner_id: str, message: str, priority: str, source: str) -> str:
    db = await get_db()
    notification_id = str(uuid.uuid4())
    await db[COL_NOTIFICATIONS].insert_one(
        {
            "notification_id": notification_id,
            "owner_id": owner_id,
            "message": message,
            "priority": priority,
            "source": source,
            "read": False,
            "timestamp": time.time(),
        }
    )
    return notification_id


def _send_email(to_address: str, subject: str, body: str) -> dict[str, Any]:
    host = os.environ.get("SMTP_HOST")
    if not host:
        return {"dispatched": False, "note": "SMTP_HOST not configured; email skipped."}
    try:
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = os.environ.get("SMTP_FROM", "agent@business.local")
        msg["To"] = to_address

        port = int(os.environ.get("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=5) as server:
            server.starttls()
            user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return {"dispatched": True}
    except Exception as exc:  # noqa: BLE001
        return {"dispatched": False, "error": str(exc)}


def _send_whatsapp(to_phone: str, message: str) -> dict[str, Any]:
    token = os.environ.get("WHATSAPP_CLOUD_API_TOKEN")
    phone_id = os.environ.get("WHATSAPP_CLOUD_API_PHONE_ID")
    if not (token and phone_id):
        return {"dispatched": False, "note": "WhatsApp Cloud API not configured; message skipped."}
    try:
        import httpx

        url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
        headers = {"Authorization": f"Bearer {token}"}
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone,
            "type": "text",
            "text": {"body": message},
        }
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
        return {"dispatched": True, "status_code": resp.status_code}
    except Exception as exc:  # noqa: BLE001
        return {"dispatched": False, "error": str(exc)}


def _send_slack(message: str) -> dict[str, Any]:
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        return {"dispatched": False, "note": "SLACK_WEBHOOK_URL not configured; message skipped."}
    try:
        import httpx

        with httpx.Client(timeout=5.0) as client:
            resp = client.post(webhook_url, json={"text": message})
            resp.raise_for_status()
        return {"dispatched": True, "status_code": resp.status_code}
    except Exception as exc:  # noqa: BLE001
        return {"dispatched": False, "error": str(exc)}


async def send_notification(
    owner_id: str,
    message: str,
    channel: Channel = "dashboard",
    priority: str = "normal",
    destination: str | None = None,
    subject: str = "Business Agent Alert",
) -> dict[str, Any]:
    """
    Always writes to the `notifications` collection (dashboard feed).
    If `channel` is anything other than "dashboard", additionally
    attempts external dispatch to `destination` (email address / phone
    number, ignored for slack). This is NotifyOwnerAgent's tool call,
    used both for the final PO confirmation and for standalone alerts
    (e.g. RecommendationAgent's initial "action needed" ping before
    HumanApprovalNode).
    """
    notification_id = await _persist_for_dashboard(owner_id, message, priority, source="agent")

    dispatch_result: dict[str, Any] = {"dispatched": False, "note": "dashboard-only"}
    if channel == "email" and destination:
        dispatch_result = _send_email(destination, subject, message)
    elif channel == "whatsapp" and destination:
        dispatch_result = _send_whatsapp(destination, message)
    elif channel == "slack":
        dispatch_result = _send_slack(message)

    return {
        "notification_id": notification_id,
        "owner_id": owner_id,
        "channel": channel,
        "dispatch": dispatch_result,
    }
