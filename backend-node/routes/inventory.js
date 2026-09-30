const express = require('express');
const router = express.Router();

const {
  listInventory,
  createInventoryItem,
  adjustStock,
  updateInventoryItem,
  deleteInventoryItem,
} = require('../services/inventory.service');
const { catchAsync, AppError } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');

// Powers the Inventory page's table + header stat tiles.
router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const { items, stats } = await listInventory(req.ownerId);
    res.status(200).json({ status: 'success', items, stats });
  })
);

// Powers AddItemModal.jsx's "+ Add Item" submit
router.post(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const item = await createInventoryItem(req.ownerId, req.body);
    res.status(201).json({ status: 'success', item });
  })
);

// Powers Inventory.jsx's +/- stock buttons — body: { delta: 1 } or { delta: -1 }
router.patch(
  '/:itemId/stock',
  protect,
  catchAsync(async (req, res) => {
    const { delta } = req.body;
    if (delta === undefined) {
      throw new AppError('delta is required', 400);
    }
    const item = await adjustStock(req.ownerId, req.params.itemId, delta);
    res.status(200).json({ status: 'success', item });
  })
);

// Powers EditItemModal / inventory row editing
router.put(
  '/:itemId',
  protect,
  catchAsync(async (req, res) => {
    const item = await updateInventoryItem(req.ownerId, req.params.itemId, req.body);
    res.status(200).json({ status: 'success', item });
  })
);

// Powers Inventory.jsx's row "Delete" button
router.delete(
  '/:itemId',
  protect,
  catchAsync(async (req, res) => {
    const item = await deleteInventoryItem(req.ownerId, req.params.itemId);
    res.status(200).json({ status: 'success', item });
  })
);

module.exports = router;
