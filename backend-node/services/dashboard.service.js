const AgentAction = require('../models/AgentAction');
const Inventory = require('../models/Inventory');
const { findSuppliersForItem } = require('./supplier.service');

async function getPendingAlerts(ownerId) {
  const actions = await AgentAction.find({ owner_id: ownerId, status: 'pending' }).sort({
    triggered_at: -1,
  });

  const alerts = await Promise.all(
    actions.map(async (action) => {
      const inventory = await Inventory.findOne({
        owner_id: ownerId,
        item_name: action.item_name,
      });

      const suppliers = await findSuppliersForItem(ownerId, action.item_name);

      return {
        action_id: action._id,
        item_name: action.item_name,
        item_id: action.item_id || inventory?.item_id,
        current_stock: inventory?.current_stock ?? null,
        status: inventory?.status ?? null,
        unit: inventory?.unit ?? 'unit',
        recommendation_text: action.recommendation_text,
        chosen_supplier: action.chosen_supplier,
        recommended_supplier_id: action.recommended_supplier_id,
        predicted_quantity: action.predicted_quantity ?? action.recommended_qty,
        recommended_qty: action.recommended_qty,
        forecast_confidence: action.forecast_confidence,
        is_irregular_demand: action.is_irregular_demand,
        irregularity_reason: action.irregularity_reason,
        demand_forecast: action.demand_forecast,
        has_suppliers: suppliers.length > 0,
        suppliers: suppliers.map((s) => ({
          supplier_id: s.supplier_id || s._id?.toString(),
          supplier_name: s.supplier_name || s.name,
          price: s.price ?? s.unit_price ?? s.current_price,
          lead_time_days: s.lead_time_days,
          is_chosen:
            (action.recommended_supplier_id && (s.supplier_id === action.recommended_supplier_id || s._id?.toString() === action.recommended_supplier_id)) ||
            s.supplier_name === action.chosen_supplier,
        })),
        triggered_at: action.triggered_at,
      };
    })
  );

  return alerts;
}

module.exports = { getPendingAlerts };