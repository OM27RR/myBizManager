const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema(
  {
    owner_id: { type: String, required: true, index: true },

    item_id: { type: String, required: true, trim: true },

    item_name: { type: String, required: [true, 'Item name is required'], trim: true },

    current_stock: {
      type: Number,
      required: [true, 'Current stock is required'],
      min: [0, 'Current stock cannot be negative'],
      default: 0,
    },

    status: {
      type: String,
      required: [true, 'Status is required'],
      trim: true,
      enum: ['In Stock', 'Low Stock', 'Out of Stock'],
      default: 'In Stock',
    },

    // Stock level at/below which an item counts as "Low Stock" (and 0 is
    // always "Out of Stock"). Drives the automatic status recalculation in
    // inventory.service.js — status is derived from this + current_stock,
    // never set by hand, so it can never go stale after a stock change.
    low_stock_threshold: {
      type: Number,
      required: true,
      min: [0, 'Low stock threshold cannot be negative'],
      default: 10,
    },

    last_updated: {
      type: Date,
      required: [true, 'Last updated is required'],
      default: Date.now,
    },

    unit: { type: String, required: true, trim: true, default: 'unit' },
  },
  {
    versionKey: false,
    // Without this, Mongoose auto-pluralizes the model name "Inventory" to
    // the collection name "inventories" (standard consonant+y -> ies rule),
    // NOT "inventory". Every item was actually being saved and read back
    // correctly by the app the whole time — the app was just reading from
    // and writing to "inventories" while anyone checking Compass for a
    // collection literally called "inventory" would see nothing there.
    // Pinning it explicitly avoids this trap for good.
    collection: 'inventory',
  }
);

inventorySchema.index({ owner_id: 1, item_id: 1 }, { unique: true });
inventorySchema.index({ owner_id: 1, item_name: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);