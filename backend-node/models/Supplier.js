const mongoose = require('mongoose');

const catalogEntrySchema = new mongoose.Schema(
  {
    item_name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    lead_time_days: { type: Number, default: 2, min: 0 },
  },
  { _id: false }
);

const priceHistoryEntrySchema = new mongoose.Schema(
  {
    item_name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ratingEntrySchema = new mongoose.Schema(
  {
    action_id: { type: String },
    rating: { type: Number, required: true, min: 0, max: 5 },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supplierSchema = new mongoose.Schema(
  {
    owner_id: { type: String, required: true, index: true },

    supplier_id: { type: String, required: true, trim: true },

    supplier_name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
    },

    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },

    phone: { type: String, required: true, trim: true },

    items_sold: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'A supplier must sell at least one item',
      },
    },

    catalog: { type: [catalogEntrySchema], default: [] },

    price_history: { type: [priceHistoryEntrySchema], default: [] },

    lead_time_days: {
      type: Number,
      default: 2,
      min: [0, 'Lead time cannot be negative'],
    },

    reliability_score: {
      type: Number,
      default: 90,
      min: [0, 'Reliability score cannot be less than 0'],
      max: [100, 'Reliability score cannot exceed 100'],
    },

    ratings: { type: [ratingEntrySchema], default: [] },
  },
  { versionKey: false }
);

supplierSchema.index({ owner_id: 1, supplier_id: 1 }, { unique: true });
supplierSchema.index({ owner_id: 1, items_sold: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
