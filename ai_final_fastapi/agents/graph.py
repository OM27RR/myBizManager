"""
agents/graph.py
==================

Wires the nodes in nodes.py into the exact graph from the architecture
diagram, including the approved/modified vs rejected branch after
HumanApprovalNode.

CHECKPOINTER CHOICE
--------------------
Human approval can happen hours after the recommendation is drafted, so
the graph MUST be compiled with a checkpointer (interrupt() does not
work without one — LangGraph has nothing to resume from otherwise).

This file defaults to `MemorySaver`: zero extra dependencies, works
correctly for the lifetime of one running backend process. Its one real
limitation: state is lost if the backend process restarts while a
recommendation is sitting in "pending_approval". For a hackathon demo
where the process stays up, this is fine and simplest.

If you need approvals to survive a restart, the durable option is a
MongoDB-backed checkpointer (`pip install langgraph-checkpoint-mongodb`,
`from langgraph.checkpoint.mongodb import MongoDBSaver`). Two things to
know before you reach for it:
  1. It's a SYNC checkpointer (uses pymongo, not motor) — you'd wrap
     calls with `asyncio.to_thread` or use it via its sync context
     manager outside the request path.
  2. Its async sibling (`AsyncMongoDBSaver`) has churned significantly
     across recent langgraph releases (deprecated, then removed in
     langgraph 1.0) — if you go this route, pin your `langgraph` and
     `langgraph-checkpoint-mongodb` versions together and test the
     import before relying on it.

Swap it in by passing a different checkpointer into build_graph():

    from langgraph.checkpoint.mongodb import MongoDBSaver
    with MongoDBSaver.from_conn_string(MONGODB_URI, "checkpoints") as cp:
        graph = build_graph(checkpointer=cp)
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from . import nodes
from .state import AgentState


def build_graph(checkpointer=None):
    builder = StateGraph(AgentState)

    builder.add_node("stock_risk_detected", nodes.stock_risk_detected)
    builder.add_node("supplier_lookup_agent", nodes.supplier_lookup_agent)
    builder.add_node("price_comparison_agent", nodes.price_comparison_agent)
    builder.add_node("recommendation_agent", nodes.recommendation_agent)
    builder.add_node("human_approval_node", nodes.human_approval_node)
    builder.add_node("purchase_order_agent", nodes.purchase_order_agent)
    builder.add_node("notify_owner_agent", nodes.notify_owner_agent)
    builder.add_node("feedback_logger_agent", nodes.feedback_logger_agent)

    builder.add_edge(START, "stock_risk_detected")
    builder.add_edge("stock_risk_detected", "supplier_lookup_agent")
    builder.add_edge("supplier_lookup_agent", "price_comparison_agent")
    builder.add_edge("price_comparison_agent", "recommendation_agent")
    builder.add_edge("recommendation_agent", "human_approval_node")

    builder.add_conditional_edges(
        "human_approval_node",
        nodes.route_after_approval,
        {
            "purchase_order_agent": "purchase_order_agent",
            "feedback_logger_agent": "feedback_logger_agent",
        },
    )

    builder.add_edge("purchase_order_agent", "notify_owner_agent")
    builder.add_edge("notify_owner_agent", END)
    builder.add_edge("feedback_logger_agent", END)

    return builder.compile(checkpointer=checkpointer or MemorySaver())


# Module-level default instance — import this from services/approval_service.py
# and routes/*.py so every part of the app shares the same compiled graph
# and, importantly, the same checkpointer (a fresh MemorySaver() per import
# would mean each part of the app has its own amnesia).
graph = build_graph()
