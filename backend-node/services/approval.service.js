const AgentAction = require('../models/AgentAction');
const { AppError } = require('../core/errors');
const { submitAgentDecision } = require('./agent.service');

async function decideAction(ownerId, actionId, decision, rejectionReason, supplierDetails = {}) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new AppError('Decision must be either "approved" or "rejected"', 400);
  }

  const action = await AgentAction.findOne({ _id: actionId, owner_id: ownerId });
  if (!action) {
    throw new AppError('Alert not found', 404);
  }
  if (action.status !== 'pending') {
    throw new AppError('This alert has already been decided', 409);
  }

  action.decided_at = new Date();

  if (decision === 'rejected') {
    action.status = 'rejected';
    action.supplier_outcome = 'owner_rejected';
    action.rejection_reason = rejectionReason || 'No reason provided';
    action.outcome_text = 'Rejected by owner';
  } else {
    action.status = 'po_sent';
    action.supplier_outcome = 'awaiting_reply';
    action.po_sent = true;
    action.outcome_text = `PO sent to ${supplierDetails.supplier_name || 'supplier'} — awaiting reply`;
    if (supplierDetails.selected_supplier_id) {
      action.selected_supplier_id = supplierDetails.selected_supplier_id;
    }
    if (supplierDetails.supplier_name) {
      action.selected_supplier_name = supplierDetails.supplier_name;
    }
  }

  await action.save();

  // Hands off to the FastAPI/LangGraph side to resume this action's thread —
  // Passes the dynamically selected supplier to FastAPI so the PO is generated for that supplier.
  await submitAgentDecision(action, decision, action.rejection_reason, supplierDetails).catch((err) => {
    console.warn('Agent decision hand-off failed (non-fatal):', err.message);
  });

  return action;
}

module.exports = { decideAction };