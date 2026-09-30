"""
forecasting/engine.py
=====================
Machine Learning Demand Forecasting & Irregularity Detection Engine.

Analyzes historical sales transactions from MongoDB `orders` collection,
computes demand volatility metrics (Coefficient of Variation, Average Demand Interval),
categorizes sales patterns (Smooth vs Erratic / Intermittent / Lumpy),
computes model confidence percentages, and outputs intelligent replenishment recommendations.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple

COL_INVENTORY = "inventory"
COL_ORDERS = "orders"


def _calculate_daily_series(
    orders: List[Dict[str, Any]], item_id: str, item_name: str = "", window_days: int = 60
) -> Tuple[List[float], Dict[str, float]]:
    """
    Transforms raw order documents into a contiguous daily sales time-series of length window_days.
    Returns (daily_quantities_list, sales_by_date_map).
    """
    now = time.time()
    day_seconds = 86400

    # Bucket orders by integer day index relative to today (0 = today, window_days - 1 = oldest)
    daily_buckets = [0.0] * window_days
    date_map: Dict[str, float] = {}

    target_id = str(item_id or "").strip().lower()
    target_name = str(item_name or "").strip().lower()

    for order in orders:
        ts = order.get("timestamp")
        # Handle datetime object, epoch float, or ISO string
        if isinstance(ts, datetime):
            epoch = ts.replace(tzinfo=timezone.utc).timestamp()
        elif isinstance(ts, (int, float)):
            epoch = float(ts)
        elif isinstance(ts, str):
            try:
                epoch = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
        else:
            continue

        days_ago = int((now - epoch) / day_seconds)
        if 0 <= days_ago < window_days:
            # Aggregate item quantity in this order
            order_items = order.get("items") or []
            item_qty = 0.0
            for it in order_items:
                it_id = str(it.get("item_id", "")).strip().lower()
                it_name = str(it.get("item_name", "")).strip().lower()
                if (target_id and it_id == target_id) or (target_name and it_name == target_name) or (target_id and it_name == target_id):
                    item_qty += float(it.get("quantity") or it.get("qty") or 0.0)

            if item_qty > 0:
                bucket_idx = window_days - 1 - days_ago  # oldest at index 0, newest at -1
                daily_buckets[bucket_idx] += item_qty

                # Format human readable date key
                date_str = datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
                date_map[date_str] = date_map.get(date_str, 0.0) + item_qty

    return daily_buckets, date_map


def _croston_forecast(series: List[float], alpha: float = 0.15) -> float:
    """
    Croston's Method for intermittent / irregular demand forecasting.
    Separates demand magnitude from demand inter-arrival times to avoid
    the lag and underestimation typical of standard exponential smoothing.
    """
    non_zero_demands: List[float] = []
    intervals: List[int] = []
    current_interval = 0

    for val in series:
        current_interval += 1
        if val > 0:
            non_zero_demands.append(val)
            intervals.append(current_interval)
            current_interval = 0

    if not non_zero_demands:
        return 0.0

    # Initialize estimates with the first observation
    z = float(non_zero_demands[0])
    p = float(intervals[0])

    for demand, interval in zip(non_zero_demands[1:], intervals[1:]):
        z = alpha * demand + (1.0 - alpha) * z
        p = alpha * interval + (1.0 - alpha) * p

    if p <= 0:
        return z

    # Syntetos-Boylan-Croston approximation to remove small-sample interval bias
    daily_rate = (1.0 - alpha / 2.0) * (z / p)
    return max(0.05, daily_rate)


def _holt_linear_forecast(series: List[float], alpha: float = 0.25, beta: float = 0.15) -> float:
    """
    Holt's Linear Exponential Smoothing (Level + Trend) for regular demand.
    Captures recent baseline demand plus any upward/downward velocity.
    """
    if not series:
        return 0.0
    if len(series) < 3:
        return sum(series) / len(series)

    # Initial level is average of first 3 points, initial trend is slope
    level = sum(series[:3]) / 3.0
    trend = (series[2] - series[0]) / 2.0

    for val in series:
        prev_level = level
        level = alpha * val + (1.0 - alpha) * (prev_level + trend)
        trend = beta * (level - prev_level) + (1.0 - beta) * trend

    # 1-step ahead daily forecast rate
    daily_rate = max(0.1, level + trend)
    return daily_rate


def _categorize_and_score_demand(
    series: List[float], window_days: int
) -> Tuple[str, bool, float, Optional[str], Dict[str, float]]:
    """
    Computes statistical indicators and determines demand category, irregularity flag,
    and model confidence percentage score.

    Categorization (Syntetos-Boylan Matrix):
    - Smooth: CV < 0.70 and ADI < 1.32 (Consistent demand, frequent orders)
    - Erratic: CV >= 0.70 and ADI < 1.32 (Frequent orders, but wildly varying quantities)
    - Intermittent: CV < 0.70 and ADI >= 1.32 (Sporadic orders, consistent quantities)
    - Lumpy: CV >= 0.70 and ADI >= 1.32 (Sporadic orders with volatile quantities)
    """
    total_sales = sum(series)
    non_zero = [v for v in series if v > 0]
    n_nz = len(non_zero)
    n_total = len(series)

    if n_total == 0 or total_sales == 0:
        return (
            "No Sales History",
            True,
            30.0,
            "No recorded sales history in database. Model confidence is low.",
            {"mean": 0.0, "std": 0.0, "cv": 0.0, "adi": float(window_days)},
        )

    # 1. Mean and Standard Deviation of daily sales
    mean_daily = total_sales / n_total
    variance = sum((x - mean_daily) ** 2 for x in series) / max(1, n_total - 1)
    std_daily = math.sqrt(variance)

    # 2. Coefficient of Variation (CV = sigma / mu)
    cv = (std_daily / mean_daily) if mean_daily > 0 else 0.0

    # 3. Average Demand Interval (ADI = total_days / non_zero_days)
    adi = (n_total / n_nz) if n_nz > 0 else float(n_total)

    # 4. Syntetos-Boylan classification cutoffs: CV_cutoff = 0.70, ADI_cutoff = 1.32
    is_irregular = False
    classification = "Smooth"

    if adi < 1.32:
        if cv < 0.70:
            classification = "Smooth (Regular)"
            is_irregular = False
        else:
            classification = "Erratic"
            is_irregular = True
    else:
        if cv < 0.70:
            classification = "Intermittent"
            is_irregular = True
        else:
            classification = "Lumpy (Highly Irregular)"
            is_irregular = True

    # 5. Model Confidence Calculation
    if not is_irregular:
        # Smooth demand: High confidence (85% to 96%)
        # Minor penalty for CV up to 0.70
        confidence = max(82.0, min(96.0, 96.0 - (cv * 16.0)))
        reason = None
    else:
        # Irregular demand: Reduced confidence (35% to 58%)
        # Penalized proportionally by volatility and interval gaps
        penalty = (cv * 20.0) + (min(5.0, adi - 1.0) * 10.0)
        confidence = max(35.0, min(58.0, 80.0 - penalty))
        reason = (
            f"Sales pattern is irregular ({classification}). "
            f"High volatility (CV={cv:.2f}) and intermittent demand spacing (ADI={adi:.2f}). "
            f"Model confidence is reduced to {round(confidence)}%."
        )

    metrics = {
        "mean_daily_sales": round(mean_daily, 2),
        "std_daily_sales": round(std_daily, 2),
        "cv": round(cv, 2),
        "adi": round(adi, 2),
        "total_units_sold_window": round(total_sales, 1),
        "window_days": window_days,
        "non_zero_sales_days": n_nz,
    }

    return classification, is_irregular, round(confidence, 1), reason, metrics


async def predict_demand_for_item(
    item_id: str,
    owner_id: str = "OWNER001",
    lead_time_days: int = 2,
    review_period_days: int = 14,
    window_days: int = 60,
) -> Dict[str, Any]:
    """
    Main entry point for demand forecasting.
    Fetches past sales transactions for item_id, runs volatility classification,
    applies the appropriate forecasting model (Croston or Holt), and calculates
    recommended reorder quantity with safety stock.
    """
    try:
        from mcp_service.common import get_db
        db = await get_db()
    except Exception:
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_uri = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
        db_name = os.getenv("DB_NAME") or "business_agent"
        client = AsyncIOMotorClient(str(mongo_uri))
        db = client[str(db_name)]

    # 1. Fetch item details
    item = await db[COL_INVENTORY].find_one(
        {"$or": [{"item_id": item_id}, {"item_name": item_id}]}, {"_id": 0}
    )
    if not item:
        # Check by id string
        item = await db[COL_INVENTORY].find_one({"id": item_id}, {"_id": 0})

    item_name = (item or {}).get("item_name") or (item or {}).get("name") or item_id
    current_stock = float((item or {}).get("current_stock") or 0.0)
    stored_avg_usage = float((item or {}).get("avg_daily_usage") or 1.5)

    # 2. Fetch sales orders from database
    cutoff_epoch = time.time() - (window_days * 86400)
    cutoff_dt = datetime.fromtimestamp(cutoff_epoch, tz=timezone.utc)

    query = {
        "$and": [
            {
                "$or": [
                    {"timestamp": {"$gte": cutoff_epoch}},
                    {"timestamp": {"$gte": cutoff_dt}},
                    {"timestamp": {"$gte": cutoff_dt.isoformat()}},
                ]
            },
            {
                "$or": [
                    {"items.item_id": item_id},
                    {"items.item_name": item_name},
                ]
            },
        ]
    }

    cursor = db[COL_ORDERS].find(query).sort("timestamp", 1)
    orders = await cursor.to_list(length=1000)

    # 3. Transform to daily sales time-series
    daily_series, _ = _calculate_daily_series(orders, item_id=item_id, item_name=item_name, window_days=window_days)

    # Fallback to stored usage if database has zero sales records yet
    if sum(daily_series) == 0:
        if stored_avg_usage > 0:
            # Generate baseline representation from stored average daily usage
            daily_series = [stored_avg_usage] * window_days

    # 4. Statistical analysis & Irregularity classification
    classification, is_irregular, confidence_score, irregularity_reason, metrics = (
        _categorize_and_score_demand(daily_series, window_days)
    )

    # 5. Run ML Model
    if is_irregular:
        predicted_daily_rate = _croston_forecast(daily_series)
        model_name = "Croston Intermittent Demand Model"
    else:
        predicted_daily_rate = _holt_linear_forecast(daily_series)
        model_name = "Holt Linear Exponential Smoothing"

    # Enforce realistic minimum
    predicted_daily_rate = max(0.5, predicted_daily_rate)

    # 6. Sizing Reorder Quantity
    # Replenishment horizon = Supplier Lead Time + Review/Reorder Cycle
    lead_time = max(1, lead_time_days)
    review_cycle = max(7, review_period_days)
    horizon = lead_time + review_cycle

    # Forecasted demand over replenishment cycle
    predicted_demand_horizon = predicted_daily_rate * horizon

    # Safety stock based on daily demand variance and lead time
    daily_std = metrics.get("std_daily_sales") or 1.0
    z_factor = 1.65  # 95% service level
    safety_stock = z_factor * daily_std * math.sqrt(lead_time)

    # If demand is irregular, add a 25% volatility buffer
    if is_irregular:
        safety_stock *= 1.25

    safety_stock = max(4.0, safety_stock)
    target_stock = predicted_demand_horizon + safety_stock

    # Recommended replenishment = Target Stock - Current Stock
    net_needed = target_stock - current_stock
    # Ensure reasonable order size and round to integer
    recommended_qty = int(max(10, math.ceil(net_needed)))

    return {
        "item_id": item_id,
        "item_name": item_name,
        "current_stock": current_stock,
        "predicted_daily_demand": round(predicted_daily_rate, 2),
        "forecast_horizon_days": horizon,
        "predicted_demand": round(predicted_demand_horizon, 1),
        "safety_stock": round(safety_stock, 1),
        "recommended_qty": recommended_qty,
        "suggested_quantity": recommended_qty,
        "confidence_score": confidence_score,
        "is_irregular": is_irregular,
        "is_irregular_demand": is_irregular,
        "irregularity_reason": irregularity_reason,
        "classification": classification,
        "method": model_name,
        "metrics": metrics,
    }
