"""
mcp/ — Tool Execution Boundary
==============================

This package is the sandboxed, permissioned tool layer described in the
architecture doc (Step 4). Nothing in agents/nodes.py (LangGraph) is allowed
to touch MongoDB or an external API (supplier email, WhatsApp, Slack)
directly. Instead:

    LangGraph node  --calls-->  mcp_client.call_tool(server, tool, args)
                                        │
                                        ▼
                        real MCP server process (stdio transport)
                                        │
                                        ▼
                        <server>/tools.py  (the only code that touches
                                             MongoDB / external APIs)

Each subfolder (inventory/, suppliers/, notifications/) is an independent,
launchable MCP server built with the official `mcp` Python SDK
(FastMCP). They can be:

  1. Run standalone for testing:      python -m mcp.inventory.server
  2. Spawned + connected in-process by client.py, which is what
     backend/main.py does at FastAPI startup.

This separation is what lets you say, in the demo, "the LLM never touches
the database — every action goes through an auditable, permissioned tool
call" and actually mean it.
"""

from .client import MCPClientManager, mcp_client  # noqa: F401
