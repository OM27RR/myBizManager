"""
agents/ — Stateful Multi-Agent Workflow Engine (Step 3 of the architecture)

This package builds the exact graph from the diagram:

    [StockRiskDetected]
          |
          v
    [SupplierLookupAgent]
          |
          v
    [PriceComparisonAgent]
          |
          v
    [RecommendationAgent]
          |
          v
    [HumanApprovalNode] --- (interrupt/checkpoint)
       |approved/modified        |rejected
       v                         v
    [PurchaseOrderAgent]   [FeedbackLoggerAgent]
       |
       v
    [NotifyOwnerAgent]

Only one node (RecommendationAgent) does open-ended LLM reasoning.
Every other node is deterministic tool orchestration through the mcp/
package — this is the "LLM is just the reasoning component inside a
larger deterministic pipeline" claim from the architecture doc, made
literal in code.

Public surface:
    from agents.graph import graph          # compiled, ready to .astream()/.ainvoke()
    from agents.state import AgentState      # the shape every node reads/writes
"""

from .graph import build_graph, graph  # noqa: F401
from .state import AgentState  # noqa: F401
