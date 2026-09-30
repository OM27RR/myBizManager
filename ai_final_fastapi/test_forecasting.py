"""
test_forecasting.py
===================
Standalone unit test for demand forecasting mathematical algorithms,
volatility classification, Croston & Holt forecasting, and confidence scoring.
"""

import sys
import os

# Add ai_final_fastapi directory to sys.path
sys.path.insert(0, "/Users/swastik/.gemini/antigravity/scratch/myBizManager/myBizManager/myBizManager/myBizManager/ai_final_fastapi")

from forecasting.engine import (
    _categorize_and_score_demand,
    _croston_forecast,
    _holt_linear_forecast,
)

def test_smooth_regular_demand():
    print("\n--- Testing Regular / Smooth Demand ---")
    # Steady sales: 4-6 units almost every day
    series = [4.0, 5.0, 6.0, 5.0, 4.0, 6.0, 5.0, 5.0, 4.0, 5.0] * 6 # 60 days
    classification, is_irregular, confidence, reason, metrics = _categorize_and_score_demand(series, window_days=60)
    forecast_rate = _holt_linear_forecast(series)

    print(f"Classification:  {classification}")
    print(f"Is Irregular:    {is_irregular}")
    print(f"Confidence:      {confidence}%")
    print(f"Irregular Reason: {reason}")
    print(f"Metrics:         Mean={metrics['mean_daily_sales']}, Std={metrics['std_daily_sales']}, CV={metrics['cv']}, ADI={metrics['adi']}")
    print(f"Daily Forecast:  {round(forecast_rate, 2)} units/day")

    assert not is_irregular, "Expected smooth demand to NOT be flagged as irregular"
    assert confidence >= 85.0, f"Expected confidence >= 85%, got {confidence}%"
    assert "Smooth" in classification
    print(">> TEST PASSED: Regular demand has high confidence!")


def test_irregular_volatile_demand():
    print("\n--- Testing Irregular / Volatile Demand ---")
    # Sporadic sales: 0 units for 7-10 days, then sudden bursts of 12-16 units
    series = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 14.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 12.0] * 4 # 60 days
    classification, is_irregular, confidence, reason, metrics = _categorize_and_score_demand(series, window_days=60)
    forecast_rate = _croston_forecast(series)

    print(f"Classification:  {classification}")
    print(f"Is Irregular:    {is_irregular}")
    print(f"Confidence:      {confidence}%")
    print(f"Irregular Reason: {reason}")
    print(f"Metrics:         Mean={metrics['mean_daily_sales']}, Std={metrics['std_daily_sales']}, CV={metrics['cv']}, ADI={metrics['adi']}")
    print(f"Croston Forecast:{round(forecast_rate, 2)} units/day")

    assert is_irregular, "Expected erratic/intermittent demand to be flagged as irregular"
    assert confidence < 60.0, f"Expected reduced confidence (< 60%), got {confidence}%"
    assert reason is not None, "Expected irregularity reason to be provided"
    print(">> TEST PASSED: Irregular demand triggers reduced confidence and warning!")


def test_lumpy_demand():
    print("\n--- Testing Highly Volatile / Lumpy Demand ---")
    # High variance and sporadic
    series = [0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 25.0, 0.0, 0.0, 1.0, 0.0, 0.0, 18.0] * 4
    classification, is_irregular, confidence, reason, metrics = _categorize_and_score_demand(series, window_days=len(series))
    print(f"Classification:  {classification}")
    print(f"Is Irregular:    {is_irregular}")
    print(f"Confidence:      {confidence}%")
    print(f"Irregular Reason: {reason}")

    assert is_irregular
    assert confidence <= 55.0
    print(">> TEST PASSED: Lumpy demand correctly detected with low confidence score!")


if __name__ == "__main__":
    test_smooth_regular_demand()
    test_irregular_volatile_demand()
    test_lumpy_demand()
    print("\nALL FORECASTING UNIT TESTS PASSED SUCCESSFULLY!")
