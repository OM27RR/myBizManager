"""
forecasting package
===================
Exports the demand forecasting engine.
"""

from .engine import predict_demand_for_item

__all__ = ["predict_demand_for_item"]
