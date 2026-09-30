const mongoose = require('mongoose');

const agentActionSchema = new mongoose.Schema(
  {
    owner_id: { type: String, required: true, index: true },
    item_name: { type: String, required: true },
    // Inventory item_id this alert is about — needed when resuming the
    // LangGraph thread (FastAPI's PurchaseOrderAgent wants item_id, not
    // just the display name).
    item_id: { type: String },
    triggered_at: { type: Date, default: Date.now },

    // written by RecommendationAgent
    chosen_supplier: { type: String },
    recommendation_text: { type: String },
    recommended_supplier_id: { type: String },
    recommended_qty: { type: Number },
    candidate_suppliers: { type: Array, default: [] },

    // ML Demand Forecasting Fields
    predicted_quantity: { type: Number },
    forecast_confidence: { type: Number },
    is_irregular_demand: { type: Boolean, default: false },
    irregularity_reason: { type: String },
    demand_forecast: { type: mongoose.Schema.Types.Mixed },

    // Dynamic supplier chosen by owner via UI buttons
    selected_supplier_id: { type: String },
    selected_supplier_name: { type: String },

    // LangGraph checkpoint thread this recommendation came from (see
    // agents/graph.py). Set only when FastAPI's /agent/detect actually ran
    // the graph — the local heuristic fallback in agent.service.js leaves
    // this null, since there's no graph run to resume later.
    agent_thread_id: { type: String },

    // written by HumanApprovalNode & ReplyWatcher
    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'rejected',
        'modified',
        'po_sent',
        'confirmed',
        'out_of_stock',
        'timeout',
        'ambiguous',
      ],
      default: 'pending',
    },
    decision: { type: String },
    supplier_outcome: { type: String }, // 'awaiting_reply', 'confirmed', 'rejected', 'out_of_stock', 'timeout', 'owner_rejected', 'ambiguous'
    outcome_text: { type: String },
    po_id: { type: String },
    po_tag: { type: String },
    order_quantity: { type: Number },
    quantity: { type: Number },
    current_stock: { type: Number },
    decided_at: { type: Date },

    // written by PurchaseOrderAgent (only if approved)
    po_sent: { type: Boolean, default: false },
    po_details: {
      qty: { type: Number },
      total_cost: { type: Number },
    },

    // written by NotifyOwnerAgent
    notification_sent: { type: Boolean, default: false },

    // written by FeedbackLoggerAgent (only if rejected)
    rejection_reason: { type: String },

    // Owner rating and shipment verification for confirmed orders
    rating: { type: Number, min: 0, max: 5 },
    rated_at: { type: Date },
    shipment_status: { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending' },
  },
  { versionKey: false }
);

// The actual fix for "Simulate Stock Drop" creating duplicate alerts: at
// most one PENDING AgentAction per (owner, item) can exist at the database
// level. Once that item's alert is approved/rejected, its status changes
// away from 'pending' and a fresh alert for the same item becomes possible
// again. Two racing "simulate" clicks that both pass the app-level check in
// agent.service.js will still collide here — the second insert fails with a
// duplicate-key error, which the service layer turns into "return the
// existing alert" instead of a second card on the dashboard.
agentActionSchema.index(
  { owner_id: 1, item_name: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('AgentAction', agentActionSchema);