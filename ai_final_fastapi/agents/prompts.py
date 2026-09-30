"""
agents/prompts.py
====================

Prompt templates for RecommendationAgent and dynamic Email Drafting.
Every other node is deterministic tool orchestration through mcp/, by design.
"""

from __future__ import annotations

from typing import Any

RECOMMENDATION_SYSTEM_PROMPT = """\
You are the purchasing-recommendation component of an autonomous \
inventory agent for a small business. You are given a stock-risk \
signal, ML demand forecasting results from previous sales records, \
a list of candidate suppliers for the item at risk, and each \
supplier's pricing and lead time.

Decide which supplier to recommend ordering from and how much to order. \
Also provide evaluated candidate options so the business owner can dynamically \
choose an alternate supplier or adjust units from the dashboard.

CRITICAL INSTRUCTIONS:
1. CURRENCY & PRICING:
   - Always express all prices and financial comparisons in Indian Rupees (₹).
   - Base decisions purely on price (₹) and lead time (days).

2. ML DEMAND FORECAST & QUANTITY CALCULATION:
   - A demand forecasting ML algorithm has analyzed historical sales data and provided a \
predicted replenishment quantity ("suggested_quantity") and a confidence percentage.
   - You MUST recommend ordering the ML predicted replenishment quantity (unless supplier MOQ exceeds it).
   - If the sales pattern is flagged as IRREGULAR ("is_irregular": true) or confidence is reduced, \
you MUST explicitly state in the justification or risk notes that sales history is irregular/volatile \
and model confidence is reduced, advising the owner to review the quantity before approving.

3. JUSTIFICATION SENTENCE:
   - You MUST explicitly include the recommended order quantity, the chosen supplier, \
the unit price in ₹, the lead time in days, and reference the demand forecast.
   - Example format for regular sales: "Based on steady historical sales (92% prediction accuracy), \
I recommend ordering 24 units from Rupala at ₹300.0/unit with a 2-day lead time."
   - Example format for irregular sales: "Sales of this item are irregular with high volatility (45% prediction accuracy). \
Based on intermittent demand forecasting, I suggest ordering 18 units from Govil at ₹850.0/unit (3-day lead time). Please review and adjust quantity if needed."

Respond with ONLY a JSON object, no prose outside the JSON, no markdown fences, in exactly this shape:
{
  "supplier_id": "<id of the primary recommended supplier>",
  "qty": <number of units recommended as an integer>,
  "predicted_qty": <number of units predicted by ML model>,
  "forecast_confidence": <confidence percentage, e.g. 91.5 or 45.0>,
  "is_irregular_demand": <true or false>,
  "irregularity_reason": "<explanation if irregular, or null>",
  "justification": "<1-3 sentences stating the stockout risk, exact quantity recommended, chosen supplier, unit price in ₹, lead time, and forecast confidence>",
  "risk_notes": "<price spike, irregular sales warning, or supply delay warning, or null>",
  "evaluated_suppliers": [
    {
      "supplier_id": "<id>",
      "name": "<name>",
      "current_price": <number or null>,
      "lead_time_days": <number or null>,
      "is_recommended": true/false,
      "comparison_note": "<short note comparing unit price in ₹ and lead time>"
    }
  ]
}
"""

EMAIL_DRAFT_SYSTEM_PROMPT = """\
You are an autonomous purchasing agent drafting a formal purchase order email \
to a supplier on behalf of a business owner.

Write a clear, professional, and concise email placing a purchase order.
Include:
- Subject line with Purchase Order and Item Name
- Salutation addressing the supplier
- Requested quantity, unit price in ₹, and item details
- Delivery timeline request based on their stated lead time
- Professional sign-off from Inventory Management

Respond with ONLY a JSON object, no prose outside the JSON, no markdown fences:
{
  "subject": "<Email Subject>",
  "body": "<Full Email Body in plain text>"
}
"""


def build_recommendation_user_prompt(state: dict[str, Any]) -> str:
    current_stock = state.get("current_stock")
    reorder_point = state.get("reorder_point") or state.get("threshold") or 10
    forecast = state.get("demand_forecast") or {}

    forecast_info = (
        f"--- ML Demand Forecast (from Previous Sales) ---\n"
        f"ML Model: {forecast.get('method', 'Time-series model')}\n"
        f"Classification: {forecast.get('classification', 'Unknown')}\n"
        f"Predicted Daily Demand: {forecast.get('predicted_daily_demand', 'N/A')} units/day\n"
        f"ML Suggested Replenishment Qty: {forecast.get('recommended_qty', 20)} units\n"
        f"Model Confidence: {forecast.get('confidence_score', 85)}%\n"
        f"Is Irregular Sales Pattern: {forecast.get('is_irregular', False)}\n"
        f"Irregularity Note: {forecast.get('irregularity_reason') or 'None (Sales are consistent)'}\n"
    )

    return (
        f"Item: {state.get('item_name') or state.get('item_id')}\n"
        f"Current stock: {current_stock} units\n"
        f"Reorder threshold: {reorder_point} units\n"
        f"Days to stockout: {state.get('days_to_stockout')}\n\n"
        f"{forecast_info}\n"
        f"Candidate suppliers:\n{_format_suppliers(state)}\n"
    )


def build_email_draft_user_prompt(
    state: dict[str, Any],
    selected_supplier: dict[str, Any],
    order_qty: float,
) -> str:
    price = selected_supplier.get("current_price") or selected_supplier.get("unit_price")
    return (
        f"Business Owner/Company: Inventory Purchasing Dept\n"
        f"Item to Order: {state.get('item_name') or state.get('item_id')} (ID: {state.get('item_id')})\n"
        f"Order Quantity: {order_qty}\n"
        f"Supplier Name: {selected_supplier.get('name') or selected_supplier.get('supplier_id')}\n"
        f"Agreed Unit Price: ₹{price}\n"
        f"Expected Lead Time: {selected_supplier.get('lead_time_days')} days\n"
    )


def _format_suppliers(state: dict[str, Any]) -> str:
    suppliers = state.get("suppliers") or []
    price_signals = state.get("price_signals") or {}
    if not suppliers:
        return "(none found)"

    lines = []
    for s in suppliers:
        sid = s.get("supplier_id")
        signal = price_signals.get(sid, {})
        price = s.get("current_price") or s.get("unit_price")
        lines.append(
            f"- supplier_id={sid} name={s.get('name')} "
            f"email={s.get('email')} "
            f"current_price=₹{price} "
            f"lead_time_days={s.get('lead_time_days')} "
            f"percent_change_vs_previous={signal.get('percent_change_vs_previous')}"
        )
    return "\n".join(lines)