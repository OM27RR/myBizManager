"""
mcp/client.py
==============

The single object agents/nodes.py talks to. It hides the fact that
"inventory", "suppliers", and "notifications" are three separate MCP
server *processes* behind one async call:

    from mcp_service.client import mcp_client
    result = await mcp_client.call_tool("inventory", "get_stock_level", {"item_id": "paneer"})

Lifecycle
---------
Connected ONCE at FastAPI startup and closed once at shutdown.
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

_MCP_ROOT = Path(__file__).resolve().parent
_BACKEND_ROOT = _MCP_ROOT.parent

# Server name -> Python module path
SERVER_REGISTRY: dict[str, str] = {
    "inventory": "mcp_service.inventory.server",
    "suppliers": "mcp_service.suppliers.server",
    "notifications": "mcp_service.notifications.server",
}


class MCPToolError(RuntimeError):
    """Raised when a connected MCP server reports isError=True, or the
    server/tool name isn't recognized."""


class MCPClientManager:
    """
    Owns one long-lived stdio session per registered server. Not
    thread-safe across event loops by design — lives inside
    a single FastAPI app's asyncio event loop for the process lifetime.
    """

    def __init__(self, registry: Optional[dict[str, str]] = None) -> None:
        self._registry = registry or SERVER_REGISTRY
        self.sessions: dict[str, ClientSession] = {}
        self._stack = AsyncExitStack()
        self._connected = False

    async def connect_all(self) -> None:
        if self._connected:
            return
        for name, module_path in self._registry.items():
            await self._connect_one(name, module_path)
        self._connected = True

    async def _connect_one(self, name: str, module_path: str) -> None:
        # Pass backend directory explicitly to the subprocess PYTHONPATH
        env = os.environ.copy()
        current_pythonpath = env.get("PYTHONPATH", "")
        backend_path = str(_BACKEND_ROOT)
        
        env["PYTHONPATH"] = (
            f"{backend_path}{os.pathsep}{current_pythonpath}"
            if current_pythonpath
            else backend_path
        )

        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", module_path],
            env=env,
        )
        read_stream, write_stream = await self._stack.enter_async_context(
            stdio_client(params)
        )
        session = await self._stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()
        self.sessions[name] = session

    async def list_tools(self, server: str) -> list[str]:
        self._require_connected(server)
        result = await self.sessions[server].list_tools()
        return [t.name for t in result.tools]

    async def call_tool(
        self, server: str, tool: str, arguments: Optional[dict[str, Any]] = None
    ) -> Any:
        """
        Calls `tool` on `server` with `arguments`, and returns the
        already-JSON-parsed result.
        """
        self._require_connected(server)
        session = self.sessions[server]

        result = await session.call_tool(tool, arguments or {})

        if getattr(result, "isError", False):
            raise MCPToolError(
                f"MCP tool '{server}.{tool}' returned an error: {_extract_text(result)}"
            )

        parsed = _parse_result(result)
        if isinstance(parsed, dict) and "error" in parsed and len(parsed) == 1:
            raise MCPToolError(f"'{server}.{tool}' error: {parsed['error']}")
        return parsed

    def _require_connected(self, server: str) -> None:
        if not self._connected:
            raise RuntimeError(
                "MCPClientManager.connect_all() has not been called yet."
            )
        if server not in self.sessions:
            raise MCPToolError(
                f"No MCP server named '{server}' is connected. "
                f"Registered servers: {list(self._registry.keys())}"
            )

    async def close(self) -> None:
        await self._stack.aclose()
        self.sessions.clear()
        self._connected = False


def _extract_text(result: Any) -> str:
    parts = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return " ".join(parts) if parts else str(result)


def _parse_result(result: Any) -> Any:
    """FastMCP tools that return a dict get serialized to a single
    TextContent block containing JSON."""
    raw = _extract_text(result)
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


# Module-level singleton
mcp_client = MCPClientManager()