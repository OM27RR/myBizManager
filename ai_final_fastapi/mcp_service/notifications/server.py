"""
mcp/notifications/server.py
==============================

Run standalone: python -m mcp.notifications.server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from mcp_service.notifications import tools

mcp = FastMCP("notifications")


@mcp.tool()
async def send_notification(
    owner_id: str,
    message: str,
    channel: str = "dashboard",
    priority: str = "normal",
    destination: str | None = None,
    subject: str = "Business Agent Alert",
) -> dict:
    """Send a notification to the owner. Always appears in the dashboard
    feed; channel can additionally be 'email', 'whatsapp', or 'slack'
    for external delivery (requires the matching env vars to be set,
    otherwise it degrades to dashboard-only)."""
    return await tools.send_notification(
        owner_id=owner_id,
        message=message,
        channel=channel,  # type: ignore[arg-type]
        priority=priority,
        destination=destination,
        subject=subject,
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
