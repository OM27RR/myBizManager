"""
agents/state.py
=================

The single shape every node in the graph reads from and writes partial
updates to. LangGraph merges each node's returned dict into this state
by key (last-write-wins per key, which is what we want here — e.g.
recommendation_agent sets `recommendation` once, human_approval_node may
later overwrite it if the owner modified the qty/supplier).

Grouped by which node in the diagram populates each field, so you can
match this directly against the architecture doc's node-by-node table.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict


class SupplierOption(TypedDict, total=False):
    supplier_id: str
    name: Optional[str]
    email: Optional[str]
    current_price: Optional[float]
    unit_price: Optional[float]
    lead_time_days: Optional[int]
    reliability_score: Optional[float]
    moq: Optional[float]
    is_recommended: Optional[bool]


class PriceSignal(TypedDict, total=False):
    supplier_id: str
    item_id: str
    history: list[dict[str, Any]]
    percent_change_vs_previous: Optional[float]


class Recommendation(TypedDict, total=False):
    supplier_id: str
    supplier_name: Optional[str]
    qty: float
    justification: str
    risk_notes: Optional[str]
    candidate_suppliers: list[SupplierOption]  # Full list for dynamic frontend selection
    # ML Demand Forecasting fields
    predicted_qty: Optional[float]
    forecast_confidence: Optional[float]
    is_irregular_demand: Optional[bool]
    irregularity_reason: Optional[str]
    demand_forecast: Optional[dict[str, Any]]


class AgentState(TypedDict, total=False):
    # --- set by whoever triggers the graph (scheduler / dashboard / API) ---
    item_id: str
    item_name: Optional[str]
    owner_id: str
    current_stock: Optional[float]
    avg_daily_usage: Optional[float]
    days_to_stockout: Optional[float]
    trigger_reason: str

    # Supplier ids SupplierLookupAgent must drop from consideration. Set by
    # the reply-watcher when it re-runs the graph after a supplier rejects
    # or reports out-of-stock, so RecommendationAgent can't just recommend
    # the same supplier that already said no. Grows with each escalation
    # (see agents/reply_watcher.py::_escalate_to_next_supplier).
    excluded_supplier_ids: list[str]

    # --- StockRiskDetected ---
    # (no new fields — just validates the above and sets status)

    # --- SupplierLookupAgent ---
    suppliers: list[SupplierOption]

    # --- PriceComparisonAgent ---
    price_signals: dict[str, PriceSignal]  # keyed by supplier_id

    # --- RecommendationAgent ---
    demand_forecast: Optional[dict[str, Any]]  # ML demand forecast & confidence metrics
    recommendation: Recommendation
    candidate_suppliers: list[SupplierOption]  # Available suppliers user can toggle between
    action_id: str  # agent_actions row created when the recommendation is drafted

    # --- Dynamic Supplier Selection / HumanApprovalNode ---
    selected_supplier_id: Optional[str]  # ID chosen by user via dynamic buttons
    selected_supplier: Optional[SupplierOption]
    owner_decision: Literal["approved", "rejected", "modified"]
    owner_modifications: Optional[dict[str, Any]]

    # --- PurchaseOrderAgent & Email Dispatch ---
    purchase_order: Optional[dict[str, Any]]
    email_draft: Optional[dict[str, Any]]
    order_id: Optional[str]

    # --- terminal status, read by routes/dashboard.py to render graph progress ---
    status: Literal["pending_approval", "completed", "rejected", "error"]
    error: Optional[str]