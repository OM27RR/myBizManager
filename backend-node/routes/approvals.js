const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const AgentAction = require('../models/AgentAction');
const { submitAgentDecision } = require('../services/agent.service');
const { protect } = require('../middleware/auth.middleware');
const { AppError, catchAsync } = require('../core/errors');

router.post(
  '/:actionId',
  protect,
  catchAsync(async (req, res) => {
    const {
      decision,
      rejection_reason,
      supplier_id,
      selected_supplier_id,
      supplier_name,
      selected_supplier,
      qty,
      order_qty,
      quantity,
    } = req.body;

    if (!['approved', 'rejected', 'modified'].includes(decision)) {
      throw new AppError('Decision must be "approved", "rejected", or "modified"', 400);
    }

    const action = await AgentAction.findOne({ _id: req.params.actionId, owner_id: req.ownerId });
    if (!action) {
      throw new AppError('Alert not found', 404);
    }
    if (action.status !== 'pending') {
      throw new AppError('This alert has already been decided', 409);
    }

    // Resolve order quantity: check root body -> selected_supplier object -> existing action -> fallback
    const resolvedQty = Number(
      order_qty ||
      quantity ||
      qty ||
      selected_supplier?.order_qty ||
      selected_supplier?.quantity ||
      action.suggested_quantity ||
      action.qty ||
      10
    );

    const rawTargetName = (
      supplier_name ||
      selected_supplier?.name ||
      selected_supplier?.supplier_name ||
      ''
    ).trim();

    let rawTargetId = selected_supplier_id || supplier_id || selected_supplier?.supplier_id || selected_supplier?._id;
    let resolvedSupplierId = rawTargetId;
    let resolvedSupplierName = rawTargetName || action.chosen_supplier;

    // Fully generic dynamic DB lookup for ANY supplier
    try {
      const db = mongoose.connection.db;
      if (db) {
        let matchedSupplier = null;

        // 1. Try matching by supplier_name / name
        if (rawTargetName) {
          const escaped = rawTargetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          matchedSupplier = await db.collection('suppliers').findOne({
            $or: [
              { supplier_name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
              { name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
              { supplier_name: { $regex: new RegExp(escaped, 'i') } },
              { name: { $regex: new RegExp(escaped, 'i') } },
            ],
          });
        }

        // 2. If not matched by name, match by supplier_id or ObjectId
        if (!matchedSupplier && rawTargetId) {
          const isObjId = mongoose.Types.ObjectId.isValid(rawTargetId);
          matchedSupplier = await db.collection('suppliers').findOne({
            $or: [
              { supplier_id: String(rawTargetId) },
              ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(rawTargetId) }] : []),
            ],
          });
        }

        // Update with true document values
        if (matchedSupplier) {
          resolvedSupplierId = matchedSupplier.supplier_id || String(matchedSupplier._id);
          resolvedSupplierName = matchedSupplier.supplier_name || matchedSupplier.name || resolvedSupplierName;
          console.log(`[APPROVAL ROUTE] Dynamic DB Match: '${resolvedSupplierName}' -> ID: '${resolvedSupplierId}'`);
        }
      }
    } catch (dbErr) {
      console.warn('[APPROVAL ROUTE] Dynamic lookup error:', dbErr.message);
    }

    if (!resolvedSupplierId) {
      resolvedSupplierId = action.recommended_supplier_id;
    }

    action.decided_at = new Date();

    if (decision === 'rejected') {
      action.status = 'rejected';
      action.supplier_outcome = 'owner_rejected';
      action.rejection_reason = rejection_reason || 'No reason provided';
      action.outcome_text = 'Rejected by owner';
      await action.save();

      console.log(
        `[APPROVAL ROUTE] Action ${req.params.actionId} rejected by owner. Notifying FastAPI...`
      );

      await submitAgentDecision(action, decision, action.rejection_reason, {
        supplier_id: resolvedSupplierId ? String(resolvedSupplierId) : undefined,
        selected_supplier_id: resolvedSupplierId ? String(resolvedSupplierId) : undefined,
        supplier_name: resolvedSupplierName,
        selected_supplier: selected_supplier,
        order_qty: resolvedQty,
        quantity: resolvedQty,
        qty: resolvedQty,
        action_id: String(action._id),
      }).catch((err) => {
        console.warn('Agent decision rejection hand-off note:', err.message);
      });

      return res.status(200).json({ status: 'success', action });
    }

    console.log(
      `[APPROVAL ROUTE] Dispatching Alert ${req.params.actionId}: decision=${decision}, qty=${resolvedQty}, supplier='${resolvedSupplierName}' (ID:${resolvedSupplierId})`
    );

    let agentRes = null;
    try {
      agentRes = await submitAgentDecision(action, decision, action.rejection_reason, {
        supplier_id: resolvedSupplierId ? String(resolvedSupplierId) : undefined,
        selected_supplier_id: resolvedSupplierId ? String(resolvedSupplierId) : undefined,
        supplier_name: resolvedSupplierName,
        selected_supplier: selected_supplier,
        order_qty: resolvedQty,
        quantity: resolvedQty,
        qty: resolvedQty,
        action_id: String(action._id),
      });
    } catch (err) {
      console.error('[APPROVAL ROUTE ERROR] submitAgentDecision failed:', err.message);
      throw new AppError(`Failed to dispatch purchase order: ${err.message}`, 500);
    }

    action.status = 'po_sent';
    action.supplier_outcome = 'awaiting_reply';
    action.po_sent = true;
    if (resolvedSupplierId) action.selected_supplier_id = String(resolvedSupplierId);
    if (resolvedSupplierName) action.selected_supplier_name = String(resolvedSupplierName);
    action.order_quantity = resolvedQty;
    action.quantity = resolvedQty;
    if (agentRes?.purchase_order?.po_tag) {
      action.po_tag = agentRes.purchase_order.po_tag;
      action.po_id = agentRes.purchase_order.po_id;
      action.outcome_text = `PO [${action.po_tag}] sent to ${resolvedSupplierName || 'supplier'} — awaiting reply`;
    } else {
      action.outcome_text = `PO sent to ${resolvedSupplierName || 'supplier'} — awaiting reply`;
    }

    await action.save();

    res.status(200).json({ status: 'success', action, purchase_order: agentRes?.purchase_order });
  })
);

module.exports = router;