const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    item_id: { type: String, required: true },
    item_name: { type: String },
    quantity: { type: Number, required: true },
    unit_price: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    order_id: { type: String, required: true, unique: true },
    owner_id: { type: String, default: 'OWNER001', index: true },
    customer_id: { type: String, default: 'CUST_RETAIL' },
    items: [orderItemSchema],
    total_amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'completed' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Order', orderSchema);
