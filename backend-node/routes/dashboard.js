const express = require('express');
const router = express.Router();

const { getPendingAlerts } = require('../services/dashboard.service');
const { catchAsync } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');

// Powers the "Pending Alerts" ticket cards on the dashboard
router.get(
  '/pending-alerts',
  protect,
  catchAsync(async (req, res) => {
    const alerts = await getPendingAlerts(req.ownerId);
    res.status(200).json({ status: 'success', alerts });
  })
);

module.exports = router;