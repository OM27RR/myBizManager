# agents/ — LangGraph Workflow Engine

This implements Step 3 of the architecture doc exactly:

```
[StockRiskDetected] -> [SupplierLookupAgent] -> [PriceComparisonAgent]
      -> [RecommendationAgent] -> [HumanApprovalNode]
            |-- approved/modified --> [PurchaseOrderAgent] -> [NotifyOwnerAgent]
            |-- rejected           --> [FeedbackLoggerAgent]
```

```
agents/
├── state.py     <- AgentState: the one shape every node reads/writes
├── prompts.py   <- LLM prompt for RecommendationAgent (the only reasoning node)
├── nodes.py     <- one function per box in the diagram
└── graph.py     <- wires nodes.py into the graph above, exports `graph`
```

## 1. Install

Add to `backend/requirements.txt`:

```
langgraph>=0.2.0
openai>=1.50.0
python-dotenv>=1.0.0
```

**I have not been able to run this against a live `langgraph`/`openai` install** — my
environment has no network access, so everything here is verified by
reading current docs (`interrupt()`, `Command(resume=...)`, `StateGraph`,
`MemorySaver`, current OpenAI model names) and `py_compile` syntax-checking
every file, not by executing the graph. Please run it against your seeded
data before trusting it in a demo — see the smoke test at the bottom of
this file.

## 1a. Environment variables

`agents/nodes.py` calls `load_dotenv()` itself at import time, so your
`.env` file just needs these two lines (adjust the path if `.env` isn't
directly inside `backend/`, since `load_dotenv()` looks in the current
working directory by default):

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-terra   # optional — see note in nodes.py; check
                              # https://platform.openai.com/docs/models
                              # if this stops being valid later
```

## 2. How triggering + approval actually flows

**Starting a run** (from your scheduler in Step 1, or a manual "reorder
now" button in `routes/inventory.py`):

```python
from agents.graph import graph
import uuid

thread_id = f"stock-risk-{item_id}-{uuid.uuid4().hex[:8]}"
config = {"configurable": {"thread_id": thread_id}}

result = await graph.ainvoke(
    {
        "item_id": item_id,
        "owner_id": owner_id,
        "current_stock": current_stock,
        "avg_daily_usage": avg_daily_usage,
        "days_to_stockout": days_to_stockout,
    },
    config,
)
# result will contain {"__interrupt__": (Interrupt(value={...recommendation...}),)}
# — that `value` dict is exactly what to show on the Approvals dashboard page.
# Persist `thread_id` (e.g. alongside the action_id in agent_actions) so
# /approve and /reject can resume the SAME thread later.
```

**Resuming after the owner decides** (this is what `routes/approvals.py`'s
`/approve/{action_id}` and `/reject/{action_id}` endpoints should do —
look up the stored `thread_id` for that `action_id` first):

```python
from langgraph.types import Command
from agents.graph import graph

config = {"configurable": {"thread_id": thread_id}}

# Approve as-is:
await graph.ainvoke(Command(resume={"decision": "approved"}), config)

# Reject:
await graph.ainvoke(Command(resume={"decision": "rejected", "reason": "too expensive"}), config)

# Approve with owner edits (e.g. they changed the qty in the UI):
await graph.ainvoke(
    Command(resume={"decision": "modified", "qty": 20, "supplier_id": "supplier_b"}),
    config,
)
```

`services/approval_service.py` is the natural home for these two
functions (`start_stock_risk_review(...)` / `resolve_approval(thread_id, decision)`)
— `routes/approvals.py` and `routes/inventory.py` should call into it
rather than importing `agents.graph` directly, so the thread_id-lookup
logic lives in one place.

## 3. LLM fallback (why this won't crash your demo without a working key)

`recommendation_agent` tries the OpenAI API first (via `AsyncOpenAI`,
model configurable through `OPENAI_MODEL`). If the `openai` package isn't
installed, `OPENAI_API_KEY` isn't set/loaded, the network call fails, or
the model doesn't return valid JSON — it silently falls back to a
deterministic heuristic (cheapest supplier whose lead time fits before
stockout) instead of raising. You'll see a `logger.warning` either way, so
you can tell which path ran, but the graph always produces a
recommendation to show HumanApprovalNode.

## 4. Checkpointer: MemorySaver by default

`interrupt()` requires a checkpointer or LangGraph has nothing to resume
from. This uses `MemorySaver` — in-process, zero extra deps, correct for
as long as the backend process stays running (fine for a demo).

If you need approvals to survive a backend restart, see the longer note
at the top of `graph.py` about `MongoDBSaver` — its async variant has
churned across recent `langgraph` releases, so pin versions and test
before relying on it for anything time-sensitive.

## 5. Smoke test (no LLM, no real suppliers needed)

Run this from `backend/` once `mcp/` is connected, to confirm the graph
compiles and pauses correctly, before wiring in real data:

```python
import asyncio
from agents.graph import graph

async def main():
    config = {"configurable": {"thread_id": "smoke-test-1"}}
    result = await graph.ainvoke(
        {"item_id": "test-item", "owner_id": "test-owner",
         "current_stock": 8, "avg_daily_usage": 2, "days_to_stockout": 4},
        config,
    )
    print(result)  # expect an __interrupt__ entry if a matching supplier exists

asyncio.run(main())
```

If `suppliers` comes back empty, `supplier_lookup_agent` will set
`status: "error"` instead of reaching the interrupt — that's expected
until you've seeded a supplier whose `item_catalog` includes `test-item`.
