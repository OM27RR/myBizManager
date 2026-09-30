const Inventory = require('../models/Inventory');
const { AppError } = require('../core/errors');
const { formatDisplayDate, generateEntityCode } = require('../core/format');
const config = require('../core/config');

// In-memory cache for ML forecasts with 45s TTL to minimize redundant HTTP roundtrips
const forecastCache = new Map();
const FORECAST_CACHE_TTL = 45 * 1000;

async function getCachedForecast(ownerId, itemId) {
  if (!itemId) return null;
  const key = `${ownerId}:${itemId}`;
  const entry = forecastCache.get(key);
  if (entry && Date.now() - entry.timestamp < FORECAST_CACHE_TTL) {
    return entry.data;
  }

  try {
    const res = await fetch(
      `${config.fastApiUrl}/api/inventory/${encodeURIComponent(itemId)}/forecast?owner_id=${encodeURIComponent(ownerId)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    forecastCache.set(key, { timestamp: Date.now(), data });
    return data;
  } catch {
    // If FastAPI is temporarily unreachable, fallback cleanly without blocking
    return null;
  }
}

// Computes dynamic ML threshold = current stock + predicted units (e.g. 2 units on hand + 19 units predicted = 21 threshold)
function computeMlThreshold(doc, forecast) {
  const currentStock = Number(doc?.current_stock ?? doc?.currentStock ?? 0);
  const fallback = Number(doc?.low_stock_threshold) || 15;
  if (!forecast) return fallback;
  const predictedUnits = Number(forecast.recommended_qty || forecast.predicted_quantity || forecast.predicted_demand);
  if (predictedUnits && !isNaN(predictedUnits) && predictedUnits > 0) {
    return Math.max(fallback, currentStock + Math.round(predictedUnits));
  }
  return fallback;
}

// Derives status dynamically from stock level and ML-predicted threshold
function computeStatus(currentStock, threshold) {
  if (currentStock <= 0) return 'Out of Stock';
  if (currentStock <= threshold) return 'Low Stock';
  return 'In Stock';
}

function toClientShape(doc, mlThreshold = null, mlForecast = null) {
  const threshold = mlThreshold !== null ? mlThreshold : (doc.low_stock_threshold ?? 10);
  const derivedStatus = computeStatus(doc.current_stock, threshold);

  return {
    id: doc._id.toString(),
    ownerId: doc.owner_id,
    itemId: doc.item_id,
    itemName: doc.item_name,
    currentStock: doc.current_stock,
    status: derivedStatus,
    lowStockThreshold: threshold,
    mlThreshold: threshold,
    mlForecast,
    lastUpdated: formatDisplayDate(doc.last_updated),
    unit: doc.unit,
  };
}

async function listInventory(ownerId) {
  const docs = await Inventory.find({ owner_id: ownerId }).sort({ item_name: 1 });

  // Fetch ML forecasts in parallel for all items
  const forecasts = await Promise.all(
    docs.map((doc) => getCachedForecast(ownerId, doc.item_id || doc._id.toString()))
  );

  const items = docs.map((doc, idx) => {
    const forecast = forecasts[idx];
    const mlThreshold = computeMlThreshold(doc, forecast);
    return toClientShape(doc, mlThreshold, forecast);
  });

  const stats = items.reduce(
    (acc, item) => {
      const status = item.status.toLowerCase();
      if (status === 'out of stock') acc.outOfStock += 1;
      else if (status === 'low stock') acc.lowStock += 1;
      else acc.healthy += 1;
      return acc;
    },
    { total: items.length, lowStock: 0, outOfStock: 0, healthy: 0 }
  );

  return { items, stats };
}

async function createInventoryItem(ownerId, payload) {
  const itemName = typeof payload.itemName === 'string' ? payload.itemName.trim() : '';
  const currentStock = Number(payload.currentStock);
  const lowStockThreshold =
    payload.lowStockThreshold !== undefined && payload.lowStockThreshold !== ''
      ? Number(payload.lowStockThreshold)
      : 10;

  if (!itemName) throw new AppError('Item name is required', 400);
  if (Number.isNaN(currentStock) || currentStock < 0) {
    throw new AppError('Enter a valid current stock amount', 400);
  }
  if (Number.isNaN(lowStockThreshold) || lowStockThreshold < 0) {
    throw new AppError('Enter a valid low stock threshold', 400);
  }

  const itemId =
    typeof payload.itemId === 'string' && payload.itemId.trim()
      ? payload.itemId.trim()
      : await generateEntityCode(Inventory, ownerId, 'EACC');

  const doc = await Inventory.create({
    owner_id: ownerId,
    item_id: itemId,
    item_name: itemName,
    current_stock: currentStock,
    low_stock_threshold: lowStockThreshold,
    status: computeStatus(currentStock, lowStockThreshold),
    last_updated: payload.lastUpdated ? new Date(payload.lastUpdated) : new Date(),
    unit: payload.unit || 'unit',
  });

  return toClientShape(doc, lowStockThreshold);
}

function buildItemQuery(ownerId, itemId) {
  const mongoose = require('mongoose');
  const idStr = String(itemId);
  if (mongoose.Types.ObjectId.isValid(idStr)) {
    return {
      $or: [{ _id: idStr }, { item_id: idStr }],
      owner_id: ownerId,
    };
  }
  return { item_id: idStr, owner_id: ownerId };
}

async function adjustStock(ownerId, itemId, delta) {
  const deltaNum = Number(delta);
  if (Number.isNaN(deltaNum)) throw new AppError('delta must be a number', 400);

  const now = new Date();
  const baseQuery = buildItemQuery(ownerId, itemId);
  let doc;

  if (deltaNum >= 0) {
    doc = await Inventory.findOneAndUpdate(
      baseQuery,
      { $inc: { current_stock: deltaNum }, $set: { last_updated: now } },
      { returnDocument: 'after' }
    );
  } else {
    doc = await Inventory.findOneAndUpdate(
      { ...baseQuery, current_stock: { $gte: -deltaNum } },
      { $inc: { current_stock: deltaNum }, $set: { last_updated: now } },
      { returnDocument: 'after' }
    );
    if (!doc) {
      doc = await Inventory.findOneAndUpdate(
        baseQuery,
        { $set: { current_stock: 0, last_updated: now } },
        { returnDocument: 'after' }
      );
    }
  }

  if (!doc) throw new AppError('Inventory item not found', 404);

  // Recompute status from dynamic ML prediction
  const forecast = await getCachedForecast(ownerId, doc.item_id || doc._id.toString());
  const mlThreshold = computeMlThreshold(forecast, doc.low_stock_threshold || 10, doc.current_stock);
  const nextStatus = computeStatus(doc.current_stock, mlThreshold);

  if (doc.status !== nextStatus || doc.low_stock_threshold !== mlThreshold) {
    doc = await Inventory.findOneAndUpdate(
      { _id: doc._id },
      { $set: { status: nextStatus, low_stock_threshold: mlThreshold } },
      { returnDocument: 'after' }
    );
  }

  return toClientShape(doc, mlThreshold, forecast);
}

async function updateInventoryItem(ownerId, itemId, payload) {
  const baseQuery = buildItemQuery(ownerId, itemId);
  const item = await Inventory.findOne(baseQuery);
  if (!item) throw new AppError('Inventory item not found', 404);

  const updates = { last_updated: new Date() };

  if (payload.itemName !== undefined || payload.item_name !== undefined) {
    const name = String(payload.itemName || payload.item_name || '').trim();
    if (!name) throw new AppError('Item name cannot be empty', 400);
    updates.item_name = name;
  }

  let nextStock = item.current_stock;
  if (payload.currentStock !== undefined || payload.current_stock !== undefined) {
    const rawStock = payload.currentStock !== undefined ? payload.currentStock : payload.current_stock;
    const stockNum = Number(rawStock);
    if (Number.isNaN(stockNum) || stockNum < 0) {
      throw new AppError('Enter a valid current stock amount', 400);
    }
    updates.current_stock = stockNum;
    nextStock = stockNum;
  }

  let nextThreshold = item.low_stock_threshold;
  if (payload.lowStockThreshold !== undefined || payload.low_stock_threshold !== undefined) {
    const rawThresh = payload.lowStockThreshold !== undefined ? payload.lowStockThreshold : payload.low_stock_threshold;
    const threshNum = Number(rawThresh);
    if (Number.isNaN(threshNum) || threshNum < 0) {
      throw new AppError('Enter a valid low stock threshold', 400);
    }
    nextThreshold = threshNum;
  }

  if (payload.unit !== undefined) {
    updates.unit = String(payload.unit).trim() || 'unit';
  }

  // Derive threshold and status from ML prediction
  const forecast = await getCachedForecast(ownerId, item.item_id || item._id.toString());
  const mlThreshold = computeMlThreshold(forecast, nextThreshold, nextStock);
  updates.low_stock_threshold = mlThreshold;
  updates.status = computeStatus(nextStock, mlThreshold);

  const updatedDoc = await Inventory.findOneAndUpdate(
    { _id: item._id },
    { $set: updates },
    { returnDocument: 'after' }
  );

  return toClientShape(updatedDoc, mlThreshold, forecast);
}

async function deleteInventoryItem(ownerId, itemId) {
  const baseQuery = buildItemQuery(ownerId, itemId);
  const doc = await Inventory.findOneAndDelete(baseQuery);
  if (!doc) throw new AppError('Inventory item not found', 404);
  return toClientShape(doc);
}

module.exports = {
  listInventory,
  createInventoryItem,
  adjustStock,
  updateInventoryItem,
  deleteInventoryItem,
};