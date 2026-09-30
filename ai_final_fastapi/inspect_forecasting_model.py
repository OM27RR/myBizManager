"""
inspect_forecasting_model.py
============================
Interactive and visual inspection script for the Demand Forecasting ML Model.
Runs real-time calculations directly against sales records in MongoDB Atlas.

Usage:
    python inspect_forecasting_model.py
    python inspect_forecasting_model.py --item EACC004
"""

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv

# Ensure local imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(".env")
load_dotenv("../.env")

from forecasting.engine import predict_demand_for_item


def render_bar(val: float, max_val: float = 100.0, width: int = 25) -> str:
    filled = int(round((val / max_val) * width))
    filled = max(0, min(width, filled))
    return "█" * filled + "░" * (width - filled)


async def inspect_all_items():
    from motor.motor_asyncio import AsyncIOMotorClient

    uri = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
    db_name = os.getenv("DB_NAME") or "business_agent"
    client = AsyncIOMotorClient(uri)
    db = client[db_name]

    items = await db["inventory"].find({}).sort("item_id", 1).to_list(100)
    total_orders = await db["orders"].count_documents({})

    print("\n" + "=" * 90)
    print("       🤖 myBizManager — ML DEMAND FORECASTING ENGINE INSPECTION")
    print(f"       Connected DB: '{db_name}' | Total Historical Sales Orders: {total_orders}")
    print("=" * 90)

    print(
        f"\n{'ITEM ID':<9} | {'ITEM NAME':<30} | {'CLASSIFICATION':<17} | {'CONF%':<6} | {'CV':<5} | {'ADI':<5} | {'REC QTY':<7}"
    )
    print("-" * 90)

    results = []
    for it in items:
        item_id = it.get("item_id")
        res = await predict_demand_for_item(item_id=item_id)
        results.append(res)
        m = res["metrics"]
        conf = f"{res['confidence_score']}%"
        rec = str(res["recommended_qty"])
        print(
            f"{res['item_id']:<9} | {res['item_name'][:30]:<30} | {res['classification'][:17]:<17} | {conf:<6} | {m['cv']:<5} | {m['adi']:<5} | {rec:<7}"
        )

    print("-" * 90)
    return results


async def inspect_item_detail(item_id: str):
    print(f"\n🔍 DEEP DIVE INSPECTION FOR ITEM: {item_id}")
    print("-" * 75)
    res = await predict_demand_for_item(item_id=item_id)
    m = res["metrics"]

    print(f"Product Name:          {res['item_name']}")
    print(f"Current Stock:         {res['current_stock']} units")
    print(f"Total Sold (60 days):  {m['total_units_sold_window']} units across {m['non_zero_sales_days']} active sales days")
    print(f"Mean Daily Sales (μ):  {m['mean_daily_sales']} units/day")
    print(f"Std Deviation (σ):     {m['std_daily_sales']}")
    print(f"Volatility (CV = σ/μ): {m['cv']}  (Threshold: 0.70)")
    print(f"Demand Spacing (ADI):  {m['adi']} days  (Threshold: 1.32)")
    print()

    print(f"Classification:        {res['classification']}")
    print(f"ML Model Applied:      {res['method']}")
    print(f"Predicted Daily Rate:  {res['predicted_daily_demand']} units/day")
    print(f"Replenishment Horizon: {res['forecast_horizon_days']} days (Lead Time + Review Cycle)")
    print(f"Demand Over Horizon:   {res['predicted_demand']} units")
    print(f"Dynamic Safety Stock:  {res['safety_stock']} units")
    print(f"Recommended Order Qty: {res['recommended_qty']} units (Pre-fills Human-in-the-Loop review)")
    print()

    conf = res["confidence_score"]
    bar = render_bar(conf)
    status_label = "HIGH CONFIDENCE" if not res["is_irregular"] else "REDUCED CONFIDENCE"
    print(f"Confidence Score:      [{bar}] {conf}% ({status_label})")

    if res["is_irregular"]:
        print(f"\n⚠️  VOLATILITY ALERT / IRREGULARITY NOTICE:")
        print(f"   \"{res['irregularity_reason']}\"")
    else:
        print(f"\n✅  STABLE SALES:")
        print("   Consistent historical purchase pattern. High predictive reliability.")
    print("-" * 75)


async def main():
    parser = argparse.ArgumentParser(description="Inspect ML Demand Forecasting")
    parser.add_argument("--item", type=str, default=None, help="Inspect specific item_id (e.g. EACC001 or EACC004)")
    args = parser.parse_args()

    if args.item:
        await inspect_item_detail(args.item)
    else:
        results = await inspect_all_items()
        print("\n" + "=" * 90)
        print("💡 COMPARISON CASE STUDIES: SMOOTH vs. IRREGULAR DEMAND")
        print("=" * 90)
        # Deep dive into one smooth item and one irregular item
        await inspect_item_detail("EACC001")
        await inspect_item_detail("EACC004")


if __name__ == "__main__":
    asyncio.run(main())
