# mcp/ — Tool Execution Boundary

This is Step 4 of the architecture: the sandboxed, permissioned layer that
sits between LangGraph's reasoning nodes and everything with real side
effects (MongoDB writes, supplier emails, WhatsApp/Slack/email to the
owner). LangGraph nodes never import `motor` or `smtplib` directly — they
only ever call `mcp_client.call_tool(server, tool, args)`.

```
mcp/
├── client.py                 <- import this everywhere: `from mcp.client import mcp_client`
├── common.py                 <- shared DB handle + agent_actions audit logger
├── inventory/
│   ├── tools.py               <- get_stock_level, get_low_stock_items, get_usage_history, adjust_stock
│   └── server.py               <- registers the above as MCP tools
├── suppliers/
│   ├── tools.py               <- get_suppliers_for_item, get_price_history, send_purchase_order
│   └── server.py
└── notifications/
    ├── tools.py               <- send_notification (dashboard + email/whatsapp/slack)
    └── server.py
```

## 1. Install

Add to `backend/requirements.txt`:

```
mcp>=1.2.0
motor>=3.5
httpx>=0.27
```

(`httpx` is only imported lazily inside the webhook/WhatsApp/Slack dispatch
paths, so it's fine even if those channels are unused in your demo.)

## 2. One assumption you should check

`mcp/common.py` imports:

```python
from database.mongodb import get_database
```

expecting `async def get_database() -> AsyncIOMotorDatabase`. If your real
`backend/database/mongodb.py` names or shapes this differently, that's the
only line in the whole `mcp/` folder you need to touch — everything else
(inventory, suppliers, notifications) goes through `common.get_db()`.

## 3. Wire it into `backend/main.py`

The three servers are separate OS processes talking over stdio, so they
need to be spawned once and kept alive — not per-request.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from mcp.client import mcp_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    await mcp_client.connect_all()
    yield
    await mcp_client.close()

app = FastAPI(lifespan=lifespan)
```

## 4. Call it from `agents/nodes.py`

Every LangGraph node function gets the same shape:

```python
from mcp.client import mcp_client, MCPToolError

async def supplier_lookup_node(state: dict) -> dict:
    try:
        result = await mcp_client.call_tool(
            "suppliers", "get_suppliers_for_item", {"item_id": state["item_id"]}
        )
    except MCPToolError as e:
        # route to a "needs more info" / retry branch instead of crashing the graph
        return {**state, "error": str(e)}
    return {**state, "suppliers": result["suppliers"]}
```

The `PurchaseOrderAgent` node (only reachable after `HumanApprovalNode`
resumes with an approved decision) looks like:

```python
async def purchase_order_node(state: dict) -> dict:
    po = await mcp_client.call_tool(
        "suppliers", "send_purchase_order",
        {"supplier_id": state["chosen_supplier_id"], "items": state["items"]},
    )
    return {**state, "po": po}
```

## 5. Test a server standalone (no LangGraph, no FastAPI)

```bash
cd backend
python -m mcp.inventory.server
```

or, better, use the MCP CLI inspector if you have it installed:

```bash
mcp dev mcp/inventory/server.py
```

This lets you call `get_stock_level`, `get_low_stock_items`, etc. by hand
against your real (or seeded) MongoDB before wiring the graph on top.

## 6. Extending to a 4th domain (e.g. invoices, per Step 6 of the doc)

1. `mkdir mcp/invoices && touch mcp/invoices/__init__.py`
2. Write `mcp/invoices/tools.py` (pure functions, using `common.get_db()`
   and `common.log_agent_action()` the same way inventory/suppliers do).
3. Write `mcp/invoices/server.py` (copy inventory/server.py's shape,
   rename the FastMCP app to `"invoices"`).
4. Add one line to `SERVER_REGISTRY` in `mcp/client.py`:
   ```python
   "invoices": _MCP_ROOT / "invoices" / "server.py",
   ```

Nothing else changes — `mcp_client.call_tool("invoices", ...)` works
immediately.

## Design notes / things worth knowing

- **Every write-tool logs to `agent_actions`.** `adjust_stock` and
  `send_purchase_order` both call `common.log_agent_action(...)`. Read
  tools don't, to keep the audit log meaningful rather than noisy.
- **External dispatch degrades gracefully.** Supplier PO emails and
  owner notifications (email/WhatsApp/Slack) all check for the relevant
  env vars and return `{"dispatched": False, "note": "..."}` instead of
  raising if unconfigured — the dashboard notification and the
  purchase_order record still get created either way. This matters for
  a live demo: missing SMTP creds should never crash the graph.
- **Tool-level errors don't raise inside `tools.py`.** They return
  `{"error": "..."}` (see `common.tool_error`), and it's `client.py`
  that turns that into an `MCPToolError` exception on the *caller*
  side. This means the MCP layer itself is well-behaved from any MCP
  client's point of view (structured result, not a crash), while your
  LangGraph nodes still get a normal Python exception they can catch.
