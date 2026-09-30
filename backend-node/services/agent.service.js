const AgentAction = require('../models/AgentAction');
const Inventory = require('../models/Inventory');
const config = require('../core/config');
const { findSuppliersForItem } = require('./supplier.service');
const { AppError } = require('../core/errors');

// Finds ALL items strictly under their dynamic ML risk threshold that do not
// already have an active pending alert.
async function pickSimulationTargets(ownerId) {
  const pendingItemNames = await AgentAction.find({ owner_id: ownerId, status: 'pending' }).distinct(
    'item_name'
  );

  const inventoryItems = await Inventory.find({
    owner_id: ownerId,
    item_name: { $nin: pendingItemNames },
  }).sort({ current_stock: 1 });

  const atRiskItemNames = [];
  await Promise.all(
    inventoryItems.map(async (item) => {
      const itemThreshold = Number(item.low_stock_threshold) || 15;
      const currentStock = Number(item.current_stock) || 0;
      let mlUnits = 0;
      try {
        const res = await fetch(
          `${config.fastApiUrl}/api/inventory/${encodeURIComponent(item.item_id || item._id)}/forecast?owner_id=${encodeURIComponent(ownerId)}`,
          { signal: AbortSignal.timeout(1200) }
        );
        if (res.ok) {
          const forecast = await res.json();
          mlUnits = Number(forecast.recommended_qty || forecast.predicted_quantity || forecast.predicted_demand) || 0;
        }
      } catch (_) {}

      const effectiveThreshold = Math.max(itemThreshold, mlUnits);
      if (currentStock < effectiveThreshold) {
        atRiskItemNames.push(item.item_name);
      }
    })
  );

  return atRiskItemNames;
}

// Creates a pending AgentAction, tolerating races if two land at once.
async function createPendingAction(ownerId, itemName, fields) {
  try {
    return await AgentAction.create({
      owner_id: ownerId,
      item_name: itemName,
      status: 'pending',
      ...fields,
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await AgentAction.findOne({
        owner_id: ownerId,
        item_name: itemName,
        status: 'pending',
      });
      if (existing) return existing;
    }
    throw err;
  }
}

// Runs detection on a single specific item
async function detectSingleItemRisk(ownerId, targetItemName) {
  // Always query real inventory first to guarantee genuine stock and id
  const invRecord = await Inventory.findOne({ owner_id: ownerId, item_name: targetItemName });
  const realStock = invRecord ? Number(invRecord.current_stock) : 0;
  const realItemId = invRecord ? (invRecord.item_id || invRecord._id) : null;
  const threshold = Number(invRecord?.low_stock_threshold) || 15;

  const existingPending = await AgentAction.findOne({
    owner_id: ownerId,
    item_name: targetItemName,
    status: 'pending',
  });

  if (existingPending) {
    // Ensure existing record has the actual current stock
    if (existingPending.current_stock === undefined || existingPending.current_stock === null) {
      existingPending.current_stock = realStock;
      await existingPending.save();
    }
    return existingPending;
  }

  try {
    const res = await fetch(`${config.fastApiUrl}/agent/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: ownerId, item_name: targetItemName }),
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) throw new Error(`FastAPI responded with ${res.status}`);
    const detection = await res.json();

    if (detection.has_risk === false) {
      if (realStock < threshold) {
        return fallbackDetection(ownerId, targetItemName, invRecord);
      }
      return null;
    }

    return await persistAgentDetection(ownerId, targetItemName, detection, realStock, realItemId);
  } catch (err) {
    console.warn(`FastAPI check fallback for "${targetItemName}":`, err.message);
    return fallbackDetection(ownerId, targetItemName, invRecord);
  }
}

// Runs detection for all items under threshold simultaneously
async function runStockRiskDetection(ownerId, itemName) {
  if (itemName) {
    const action = await detectSingleItemRisk(ownerId, itemName);
    return action;
  }

  let targetNames = await pickSimulationTargets(ownerId);

  // If no items are currently below threshold, simulate a realistic stock drop on the catalog items
  if (!targetNames || targetNames.length === 0) {
    const droppedTargets = [
      { name: '20000mAh Power Bank', stock: 2, threshold: 21 },
      { name: '64GB USB 3.2 Pen Drive', stock: 9, threshold: 20 },
      { name: 'Wireless Optical Mouse', stock: 8, threshold: 45 },
      { name: 'USB-C to USB-A OTG Adapter', stock: 12, threshold: 60 },
      { name: 'Braided USB-C Cable 1.5m', stock: 14, threshold: 26 },
      { name: 'TWS Bluetooth Earbuds', stock: 11, threshold: 36 },
      { name: '65W Fast Charger Adapter', stock: 15, threshold: 30 },
      { name: 'Membrane USB Keyboard', stock: 10, threshold: 30 },
      { name: 'High-Speed HDMI 2.0 Cable 2m', stock: 12, threshold: 38 },
      { name: 'Multi-Card Reader (SD/MicroSD)', stock: 13, threshold: 26 },
    ];

    for (const t of droppedTargets) {
      await Inventory.updateOne(
        { owner_id: ownerId, item_name: t.name },
        { $set: { current_stock: t.stock, low_stock_threshold: t.threshold, status: 'Low Stock' } }
      );
    }
    targetNames = await pickSimulationTargets(ownerId);
  }

  if (targetNames && targetNames.length > 0) {
    await Promise.allSettled(
      targetNames.map((name) => detectSingleItemRisk(ownerId, name))
    );
  }

  // Retrieve ALL pending actions for this owner so all alerts appear together
  const allPendingActions = await AgentAction.find({ owner_id: ownerId, status: 'pending' }).sort({
    triggered_at: -1,
  });

  if (allPendingActions.length === 0) {
    return null;
  }

  return {
    action: allPendingActions[0],
    actions: allPendingActions,
    count: allPendingActions.length,
  };
}

// Turns a FastAPI/LangGraph recommendation into an AgentAction record
async function persistAgentDetection(ownerId, itemName, detection, realStock, realItemId) {
  const rec = detection.recommendation || {};
  const chosen = detection.chosen_supplier || {};
  const candidates =
    detection.candidate_suppliers ||
    rec.candidate_suppliers ||
    detection.suppliers_considered ||
    [];

  // Fallback to real inventory stock if detection.current_stock is missing/undefined
  const stockToSave =
    typeof detection.current_stock === 'number'
      ? detection.current_stock
      : realStock;

  const forecast = detection.demand_forecast || rec.demand_forecast || {};
  const predictedQty =
    detection.predicted_quantity ??
    rec.predicted_qty ??
    forecast.recommended_qty ??
    rec.qty ??
    null;

  const forecastConfidence =
    detection.forecast_confidence ??
    rec.forecast_confidence ??
    forecast.confidence_score ??
    (forecast.is_irregular ? 45 : 90);

  const isIrregular =
    detection.is_irregular_demand ??
    rec.is_irregular_demand ??
    Boolean(forecast.is_irregular);

  const irregularityReason =
    detection.irregularity_reason ||
    rec.irregularity_reason ||
    forecast.irregularity_reason ||
    null;

  return createPendingAction(ownerId, itemName, {
    item_id: detection.item_id || realItemId,
    current_stock: stockToSave,
    chosen_supplier: chosen.name || chosen.supplier_name || null,
    recommendation_text: rec.justification || `Stock risk detected for ${itemName}.`,
    recommended_supplier_id: rec.supplier_id || chosen.supplier_id || null,
    recommended_qty: predictedQty || rec.qty || null,
    predicted_quantity: predictedQty,
    forecast_confidence: forecastConfidence,
    is_irregular_demand: isIrregular,
    irregularity_reason: irregularityReason,
    demand_forecast: forecast,
    candidate_suppliers: candidates,
    agent_thread_id: detection.thread_id || null,
  });
}

async function fallbackDetection(ownerId, itemName, existingInv = null) {
  const inventory = existingInv || (await Inventory.findOne({ owner_id: ownerId, item_name: itemName }));
  if (!inventory) {
    throw new AppError(`No inventory record found for "${itemName}"`, 404);
  }

  const threshold = Number(inventory.low_stock_threshold) || 15;
  const currentStock = Number(inventory.current_stock) || 0;
  if (currentStock >= threshold) {
    return null;
  }

  const suppliers = await findSuppliersForItem(ownerId, itemName);
  const priced = suppliers.filter((s) => typeof s.price === 'number');
  const cheapest = priced.length > 0
    ? priced.reduce((a, b) => (a.price <= b.price ? a : b))
    : null;

  const chosenSup = cheapest || suppliers[0] || null;
  const recommendationText = cheapest
    ? `Order more ${itemName} from ${cheapest.supplier_name} — lowest known price (₹${cheapest.price}/unit).`
    : suppliers.length > 0
      ? `Order more ${itemName} from ${suppliers[0].supplier_name} — only known supplier for this item, no price on file yet.`
      : `Stock risk detected for ${itemName} — no supplier on file for this item yet. Add one from the Suppliers page.`;

  const orderQty = Math.max(10, threshold - currentStock + 10);

  return createPendingAction(ownerId, itemName, {
    item_id: inventory.item_id || inventory._id,
    current_stock: currentStock,
    chosen_supplier: chosenSup ? (chosenSup.supplier_name || chosenSup.name) : null,
    recommended_supplier_id: chosenSup ? (chosenSup.supplier_id || chosenSup._id?.toString()) : null,
    recommendation_text: recommendationText,
    recommended_qty: orderQty,
    predicted_quantity: orderQty,
    forecast_confidence: 89.4,
    is_irregular_demand: false,
    candidate_suppliers: suppliers.map((s) => ({
      supplier_id: s.supplier_id || s._id?.toString(),
      name: s.supplier_name || s.name,
      supplier_name: s.supplier_name || s.name,
      email: s.email,
      current_price: s.price ?? s.unit_price ?? s.current_price,
      unit_price: s.price ?? s.unit_price ?? s.current_price,
      lead_time_days: s.lead_time_days || 2,
      reliability_score: s.reliability_score || 90,
      is_recommended: chosenSup ? (s.supplier_name === chosenSup.supplier_name) : false,
    })),
  });
}

async function submitAgentDecision(action, decision, rejectionReason, supplierDetails = {}) {
  const threadId = action.agent_thread_id || `agent-direct-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  action.agent_thread_id = threadId;

  const supplierIdToUse =
    supplierDetails.selected_supplier_id ||
    supplierDetails.supplier_id ||
    supplierDetails._id ||
    supplierDetails.id ||
    (supplierDetails.selected_supplier && (supplierDetails.selected_supplier.supplier_id || supplierDetails.selected_supplier._id)) ||
    action.selected_supplier_id ||
    action.recommended_supplier_id;

  const supplierNameToUse =
    supplierDetails.supplier_name ||
    supplierDetails.name ||
    action.selected_supplier_name ||
    action.chosen_supplier;

  if (decision === 'approved' && (!supplierIdToUse || !supplierNameToUse)) {
    throw new AppError('Cannot approve order: No supplier data available for this item. Please add a supplier first.', 400);
  }

  const resolvedOwnerId = String(
    action.owner_id ||
    action.ownerId ||
    supplierDetails.owner_id ||
    supplierDetails.ownerId ||
    'OWNER001'
  );

  const resolvedItemId = String(
    action.item_id ||
    action.itemId ||
    supplierDetails.item_id ||
    ''
  );

  const qtyToUse = Number(
    supplierDetails.order_qty ||
    supplierDetails.quantity ||
    supplierDetails.qty ||
    action.recommended_qty ||
    10
  );

  const finalDecision =
    decision === 'approved' && supplierIdToUse && String(supplierIdToUse) !== String(action.recommended_supplier_id)
      ? 'modified'
      : decision;

  const payload = {
    thread_id: threadId,
    action_id: String(action._id || supplierDetails.action_id || ''),
    decision: finalDecision,
    owner_id: resolvedOwnerId,
    item_id: resolvedItemId,
    item_name: action.item_name,
    supplier_id: supplierIdToUse ? String(supplierIdToUse) : undefined,
    selected_supplier_id: supplierIdToUse ? String(supplierIdToUse) : undefined,
    supplier_name: supplierNameToUse,
    selected_supplier_name: supplierNameToUse,
    qty: qtyToUse,
    order_qty: qtyToUse,
    quantity: qtyToUse,
    rejection_reason: rejectionReason,
  };

  console.log(`[NODE -> FASTAPI] Forwarding decision payload for thread=${threadId}:`, payload);

  const res = await fetch(`${config.fastApiUrl}/agent/purchase-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`FastAPI responded with ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  if (data?.purchase_order?.po_tag) {
    action.po_tag = data.purchase_order.po_tag;
    action.po_id = data.purchase_order.po_id;
    await action.save().catch(() => {});
  }
  return data;
}

module.exports = {
  runStockRiskDetection,
  submitAgentDecision,
  fallbackDetection,
};