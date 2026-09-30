const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const AgentAction = require('../models/AgentAction');
const { rateSupplier } = require('../services/supplier.service');
const { catchAsync, AppError } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// 1. GET /api/actions - Fetch actions list and computed stats
router.get(
  '/',
  catchAsync(async (req, res) => {
    const actions = await AgentAction.find({ owner_id: req.ownerId }).sort({ triggered_at: -1 });

    const stats = {
      total: actions.length,
      approved: actions.filter((a) => a.status === 'confirmed' || a.supplier_outcome === 'confirmed').length,
      rejected: actions.filter((a) => ['rejected', 'out_of_stock', 'timeout'].includes(a.status) || ['rejected', 'out_of_stock', 'timeout', 'owner_rejected'].includes(a.supplier_outcome)).length,
      po_sent: actions.filter((a) => ['po_sent', 'approved'].includes(a.status) || a.supplier_outcome === 'awaiting_reply').length,
    };

    res.status(200).json({ status: 'success', stats, actions });
  })
);

// 2. DELETE /api/actions/:id - Delete a single action log entry
router.delete(
  '/:id',
  catchAsync(async (req, res) => {
    const { id } = req.params;

    const query = {
      owner_id: req.ownerId,
      $or: [
        { action_id: id },
        { id: id },
        ...(mongoose.Types.ObjectId.isValid(id)
          ? [{ _id: new mongoose.Types.ObjectId(id) }]
          : []),
      ],
    };

    const result = await AgentAction.deleteOne(query);

    if (!result.deletedCount) {
      throw new AppError('Action entry not found or already deleted', 404);
    }

    res.status(200).json({ status: 'success', message: 'Action entry deleted' });
  })
);

// 3. DELETE /api/actions - Clear all actions for this owner
router.delete(
  '/',
  catchAsync(async (req, res) => {
    const result = await AgentAction.deleteMany({ owner_id: req.ownerId });

    res.status(200).json({
      status: 'success',
      message: 'All action logs cleared',
      deleted_count: result.deletedCount,
    });
  })
);

// 4. POST /api/actions/:id/rate - Rate a confirmed order's supplier (1 to 5 stars)
router.post(
  '/:id/rate',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const { rating, shipment_status } = req.body;

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 0 || numRating > 5) {
      throw new AppError('Rating must be a number between 0 and 5', 400);
    }

    const query = {
      owner_id: req.ownerId,
      $or: [
        { action_id: id },
        { id: id },
        ...(mongoose.Types.ObjectId.isValid(id)
          ? [{ _id: new mongoose.Types.ObjectId(id) }]
          : []),
      ],
    };

    const action = await AgentAction.findOne(query);
    if (!action) {
      throw new AppError('Action not found', 404);
    }

    const isConfirmed = action.status === 'confirmed' || action.supplier_outcome === 'confirmed';
    if (!isConfirmed) {
      throw new AppError('Only confirmed orders can be rated', 400);
    }

    // Determine target supplier identifier
    const supplierIdentifier =
      action.selected_supplier_id ||
      action.recommended_supplier_id ||
      action.selected_supplier_name ||
      action.chosen_supplier;

    if (!supplierIdentifier) {
      throw new AppError('No supplier associated with this action to rate', 400);
    }

    // Rate supplier and update their reliability_score
    const updatedSupplier = await rateSupplier(req.ownerId, supplierIdentifier, numRating, action._id);

    action.rating = numRating;
    action.rated_at = new Date();
    if (shipment_status) {
      action.shipment_status = shipment_status;
    } else if (numRating === 0) {
      action.shipment_status = 'failed';
    } else {
      action.shipment_status = 'delivered';
    }
    await action.save();

    res.status(200).json({
      status: 'success',
      message: `Rating submitted! Reliability score updated to ${updatedSupplier.reliability_score}%`,
      action,
      supplier: updatedSupplier,
    });
  })
);

// 5. POST /api/actions/:id/confirm - Mark an action as confirmed and create in-transit notification
router.post(
  '/:id/confirm',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const query = {
      owner_id: req.ownerId,
      $or: [
        { action_id: id },
        { id: id },
        ...(mongoose.Types.ObjectId.isValid(id)
          ? [{ _id: new mongoose.Types.ObjectId(id) }]
          : []),
      ],
    };

    const action = await AgentAction.findOne(query);
    if (!action) {
      throw new AppError('Action not found', 404);
    }

    action.status = 'confirmed';
    action.supplier_outcome = 'confirmed';
    action.shipment_status = 'pending';
    const supplierName = action.selected_supplier_name || action.chosen_supplier || 'Supplier';
    const quantity = action.quantity || action.order_quantity || 10;
    action.outcome_text = `Order Placed: Confirmed by ${supplierName} (+${quantity} units restocked in inventory)`;
    action.decided_at = action.decided_at || new Date();
    await action.save();

    // Create In-Transit procurement notification in MongoDB
    try {
      const db = mongoose.connection.db;
      const poTag = action.po_tag || `PO-${action.action_id?.slice(-8) || 'ORDER'}`;
      const itemName = action.item_name || 'Inventory Item';

      await db.collection('notifications').insertOne({
        owner_id: req.ownerId,
        kind: 'email',
        direction: 'system',
        status: 'in_transit',
        subject: `Shipment In Transit: [${poTag}] ${itemName}`,
        body: `Supplier ${supplierName} has confirmed order ${poTag}. ${quantity} units of ${itemName} are currently in transit.`,
        supplier_name: supplierName,
        item_name: itemName,
        po_tag: poTag,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } catch (e) {
      console.error('Failed to log in-transit notification:', e);
    }

    res.status(200).json({
      status: 'success',
      message: 'Order confirmed successfully. Shipment is in transit.',
      action,
    });
  })
);

// 6. POST /api/actions/:id/shipment - Update shipment status (e.g. tick ✓ or cross ✕)
router.post(
  '/:id/shipment',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status: shipmentStatus, rating } = req.body;

    if (!['delivered', 'failed', 'pending'].includes(shipmentStatus)) {
      throw new AppError('Invalid shipment status. Must be delivered, failed, or pending.', 400);
    }

    const query = {
      owner_id: req.ownerId,
      $or: [
        { action_id: id },
        { id: id },
        ...(mongoose.Types.ObjectId.isValid(id)
          ? [{ _id: new mongoose.Types.ObjectId(id) }]
          : []),
      ],
    };

    const action = await AgentAction.findOne(query);
    if (!action) {
      throw new AppError('Action not found', 404);
    }

    action.shipment_status = shipmentStatus;

    let updatedSupplier = null;
    const supplierIdentifier =
      action.selected_supplier_id ||
      action.recommended_supplier_id ||
      action.selected_supplier_name ||
      action.chosen_supplier;

    if (shipmentStatus === 'failed') {
      // Cross (✕): Automatically record 0-star rating
      if (supplierIdentifier) {
        updatedSupplier = await rateSupplier(req.ownerId, supplierIdentifier, 0, action._id);
        action.rating = 0;
        action.rated_at = new Date();
      }
    } else if (shipmentStatus === 'delivered' && rating !== undefined && rating !== null) {
      const numRating = Number(rating);
      if (!isNaN(numRating) && numRating >= 0 && numRating <= 5 && supplierIdentifier) {
        updatedSupplier = await rateSupplier(req.ownerId, supplierIdentifier, numRating, action._id);
        action.rating = numRating;
        action.rated_at = new Date();
      }
    }

    await action.save();

    res.status(200).json({
      status: 'success',
      message: `Shipment marked as ${shipmentStatus}`,
      action,
      supplier: updatedSupplier,
    });
  })
);

module.exports = router;