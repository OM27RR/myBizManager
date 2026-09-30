const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const { AppError } = require('../core/errors');
const { generateEntityCode } = require('../core/format');

function toClientShape(doc) {
  return {
    _id: doc._id.toString(),
    owner_id: doc.owner_id,
    supplier_id: doc.supplier_id,
    supplier_name: doc.supplier_name,
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    lead_time_days: doc.lead_time_days !== undefined ? doc.lead_time_days : 2,
    reliability_score: doc.reliability_score !== undefined ? doc.reliability_score : 90,
    items_sold: doc.items_sold,
    catalog: doc.catalog,
    price_history: doc.price_history,
    ratings: doc.ratings || [],
  };
}

async function listSuppliers(ownerId) {
  const docs = await Supplier.find({ owner_id: ownerId }).sort({ supplier_name: 1 });
  return docs.map(toClientShape);
}

async function createSupplier(ownerId, payload) {
  const supplierName = typeof payload.supplierName === 'string' ? payload.supplierName.trim() : '';
  const contactName = typeof payload.contactName === 'string' ? payload.contactName.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const itemsSold = Array.isArray(payload.itemsSold)
    ? payload.itemsSold.filter(Boolean)
    : Array.isArray(payload.items)
      ? payload.items.filter(Boolean)
      : [];

  const rawLeadTime = payload.leadTimeDays !== undefined ? payload.leadTimeDays : payload.lead_time_days;
  const leadTimeDays = rawLeadTime !== undefined && rawLeadTime !== '' && !isNaN(Number(rawLeadTime))
    ? Number(rawLeadTime)
    : 2;

  const rawReliability = payload.reliabilityScore !== undefined ? payload.reliabilityScore : payload.reliability_score;
  const reliabilityScore = rawReliability !== undefined && rawReliability !== '' && !isNaN(Number(rawReliability))
    ? Number(rawReliability)
    : 90;

  if (!supplierName) throw new AppError('Supplier name is required', 400);
  if (!contactName) throw new AppError('Contact name is required', 400);
  if (!email) throw new AppError('Email is required', 400);
  if (!phone) throw new AppError('Phone number is required', 400);
  if (itemsSold.length === 0) throw new AppError('Add at least one item this supplier sells', 400);

  const supplier_id = await generateEntityCode(Supplier, ownerId, 'SUP');

  const doc = await Supplier.create({
    owner_id: ownerId,
    supplier_id,
    supplier_name: supplierName,
    name: contactName,
    email,
    phone,
    lead_time_days: leadTimeDays,
    reliability_score: reliabilityScore,
    items_sold: itemsSold,
    catalog: Array.isArray(payload.catalog) ? payload.catalog : [],
    price_history: Array.isArray(payload.priceHistory) ? payload.priceHistory : [],
  });

  return toClientShape(doc);
}

async function updateSupplier(ownerId, supplierMongoId, payload) {
  const supplierName = typeof payload.supplierName === 'string' ? payload.supplierName.trim() : undefined;
  const contactName = typeof payload.contactName === 'string' ? payload.contactName.trim() : undefined;
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined;
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : undefined;

  const rawLeadTime = payload.leadTimeDays !== undefined ? payload.leadTimeDays : payload.lead_time_days;
  const rawReliability = payload.reliabilityScore !== undefined ? payload.reliabilityScore : payload.reliability_score;

  const itemsSold = Array.isArray(payload.itemsSold)
    ? payload.itemsSold.filter(Boolean)
    : Array.isArray(payload.items)
      ? payload.items.filter(Boolean)
      : undefined;

  const catalog = Array.isArray(payload.catalog) ? payload.catalog : undefined;

  if (itemsSold !== undefined && itemsSold.length === 0) {
    throw new AppError('Supplier must have at least one item they sell', 400);
  }

  const updateFields = {};
  if (supplierName) updateFields.supplier_name = supplierName;
  if (contactName) updateFields.name = contactName;
  if (email) updateFields.email = email;
  if (phone) updateFields.phone = phone;
  if (rawLeadTime !== undefined && rawLeadTime !== '' && !isNaN(Number(rawLeadTime))) {
    updateFields.lead_time_days = Number(rawLeadTime);
  }
  if (rawReliability !== undefined && rawReliability !== '' && !isNaN(Number(rawReliability))) {
    updateFields.reliability_score = Number(rawReliability);
  }
  if (itemsSold !== undefined) updateFields.items_sold = itemsSold;
  if (catalog !== undefined) updateFields.catalog = catalog;

  const doc = await Supplier.findOneAndUpdate(
    { _id: supplierMongoId, owner_id: ownerId },
    { $set: updateFields },
    { returnDocument: 'after' }
  );

  if (!doc) throw new AppError('Supplier not found', 404);

  return toClientShape(doc);
}

async function deleteSupplier(ownerId, supplierMongoId) {
  const doc = await Supplier.findOneAndDelete({ _id: supplierMongoId, owner_id: ownerId });
  if (!doc) throw new AppError('Supplier not found', 404);
  return toClientShape(doc);
}

async function findSuppliersForItem(ownerId, itemName) {
  const docs = await Supplier.find({ owner_id: ownerId, items_sold: itemName });

  return docs.map((doc) => {
    const catalogEntry = (doc.catalog || []).find((c) => c.item_name === itemName);
    return {
      supplier_id: doc.supplier_id,
      _id: doc._id,
      supplier_name: doc.supplier_name,
      lead_time_days: doc.lead_time_days !== undefined ? doc.lead_time_days : 2,
      reliability_score: doc.reliability_score !== undefined ? doc.reliability_score : 90,
      price: catalogEntry ? catalogEntry.price : null,
    };
  });
}

async function rateSupplier(ownerId, supplierIdentifier, rating, actionId = null) {
  const numRating = Number(rating);
  if (isNaN(numRating) || numRating < 0 || numRating > 5) {
    throw new AppError('Rating must be an integer between 0 and 5', 400);
  }

  // Find supplier by _id, supplier_id, or supplier_name
  const isObjectId = mongoose.Types.ObjectId.isValid(supplierIdentifier);
  const supplier = await Supplier.findOne({
    owner_id: ownerId,
    $or: [
      { supplier_id: String(supplierIdentifier) },
      { supplier_name: String(supplierIdentifier) },
      { name: String(supplierIdentifier) },
      ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(supplierIdentifier) }] : []),
    ],
  });

  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  if (!Array.isArray(supplier.ratings)) {
    supplier.ratings = [];
  }

  // If actionId is provided, check if this specific action was already rated
  if (actionId) {
    const existingIndex = supplier.ratings.findIndex(
      (r) => r.action_id && r.action_id.toString() === actionId.toString()
    );
    if (existingIndex >= 0) {
      supplier.ratings[existingIndex].rating = numRating;
      supplier.ratings[existingIndex].date = new Date();
    } else {
      supplier.ratings.push({
        action_id: actionId.toString(),
        rating: numRating,
        date: new Date(),
      });
    }
  } else {
    supplier.ratings.push({
      rating: numRating,
      date: new Date(),
    });
  }

  // Recalculate reliability score ONLY on the basis of 5 star ratings given by owner:
  // (average_stars / 5) * 100
  const totalStars = supplier.ratings.reduce((sum, r) => sum + Number(r.rating || 0), 0);
  const avgStars = totalStars / supplier.ratings.length;
  const newReliabilityScore = Math.round((avgStars / 5) * 100);

  supplier.reliability_score = Math.max(0, Math.min(100, newReliabilityScore));
  await supplier.save();

  return toClientShape(supplier);
}

module.exports = {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  findSuppliersForItem,
  rateSupplier,
};