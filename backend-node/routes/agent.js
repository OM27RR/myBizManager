const express = require('express');
const router = express.Router();

const axios = require('axios');
const config = require('../core/config');

const { runStockRiskDetection } = require('../services/agent.service');
const { catchAsync } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');

const fastapi = axios.create({ baseURL: config.fastApiUrl });

// Powers the "+ Simulate Stock Drop" button.
// If all items are healthy and no risk is found, it returns a 200 response
// stating "No Stock Risk Currently" instead of returning a fake alert.
router.post(
  '/simulate',
  protect,
  catchAsync(async (req, res) => {
    const { item_name } = req.body || {};
    const result = await runStockRiskDetection(req.ownerId, item_name);

    if (!result) {
      return res.status(200).json({
        status: 'success',
        message: 'No Stock Risk Currently',
        action: null,
        actions: [],
        count: 0,
      });
    }

    const action = result.action || result;
    const actions = result.actions || (action ? [action] : []);
    res.status(201).json({
      status: 'success',
      action,
      actions,
      count: actions.length,
    });
  })
);

router.get(
  '/actions',
  protect,
  catchAsync(async (req, res) => {
    const { data } = await fastapi.get('/agent-actions/');
    res.status(200).json({ status: 'success', actions: data });
  })
);

module.exports = router;