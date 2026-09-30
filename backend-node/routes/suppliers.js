const express = require('express');
const router = express.Router();

const {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} = require('../services/supplier.service');
const { catchAsync } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');

// Powers the Suppliers page's table + header stat tiles
router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const suppliers = await listSuppliers(req.ownerId);
    res.status(200).json({ status: 'success', suppliers });
  })
);

// Powers AddSupplierModal.jsx's "+ Add Supplier" submit
router.post(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const supplier = await createSupplier(req.ownerId, req.body);
    res.status(201).json({ status: 'success', supplier });
  })
);

// Powers AddSupplierModal.jsx's "Save Changes" submit when editing
router.put(
  '/:supplierId',
  protect,
  catchAsync(async (req, res) => {
    const supplier = await updateSupplier(req.ownerId, req.params.supplierId, req.body);
    res.status(200).json({ status: 'success', supplier });
  })
);

// Powers Suppliers.jsx's row "Delete" button
router.delete(
  '/:supplierId',
  protect,
  catchAsync(async (req, res) => {
    const supplier = await deleteSupplier(req.ownerId, req.params.supplierId);
    res.status(200).json({ status: 'success', supplier });
  })
);

module.exports = router;