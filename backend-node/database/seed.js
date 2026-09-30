// Run with: node database/seed.js
// Wipes and repopulates the database using the sample data model.
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../core/config');

const Owner = require('../models/Owner');
const Inventory = require('../models/Inventory');
const Supplier = require('../models/Supplier');
const AgentAction = require('../models/AgentAction');
const Order = require('../models/Order');

async function seed() {
  await mongoose.connect(config.mongoUri, {
    dbName: config.useMemoryDb ? undefined : config.dbName,
  });
  console.log(`Connected (db: ${config.dbName}). Seeding...`);

  await Promise.all([
    Owner.deleteMany({}),
    Inventory.deleteMany({}),
    Supplier.deleteMany({}),
    AgentAction.deleteMany({}),
    Order.deleteMany({}),
  ]);

  const owner = await Owner.create({
    owner_id: 'OWNER001',
    owner_name: 'Om Gupta',
    business_name: 'Accessories Store',
    email: 'odi45rs@gmail.com',
    password: 'password123',
  });

  await Inventory.insertMany([
    { owner_id: 'OWNER001', item_id: 'EACC001', item_name: '65W Fast Charger Adapter', current_stock: 25, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC002', item_name: '20000mAh Power Bank', current_stock: 18, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC003', item_name: 'Braided USB-C Cable 1.5m', current_stock: 60, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC004', item_name: 'TWS Bluetooth Earbuds', current_stock: 22, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC005', item_name: 'Wireless Optical Mouse', current_stock: 35, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC006', item_name: 'Membrane USB Keyboard', current_stock: 20, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC007', item_name: 'High-Speed HDMI 2.0 Cable 2m', current_stock: 28, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC008', item_name: 'USB-C to USB-A OTG Adapter', current_stock: 50, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC009', item_name: '64GB USB 3.2 Pen Drive', current_stock: 40, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
    { owner_id: 'OWNER001', item_id: 'EACC010', item_name: 'Multi-Card Reader (SD/MicroSD)', current_stock: 16, status: 'In Stock', last_updated: new Date('2026-08-30T00:00:00Z'), unit: 'unit' },
  ]);

  await Supplier.insertMany([
    {
      owner_id: 'OWNER001',
      supplier_id: 'SUP001',
      supplier_name: 'Govil Accessories',
      name: 'Nishita Govil',
      email: 'govil.nishita@gmail.com',
      phone: '9650410830',
      lead_time_days: 3,
      reliability_score: 99,
      items_sold: ['65W Fast Charger Adapter', '20000mAh Power Bank', 'Braided USB-C Cable 1.5m', 'TWS Bluetooth Earbuds'],
      catalog: [
        { item_name: '65W Fast Charger Adapter', price: 850.0 },
        { item_name: '20000mAh Power Bank', price: 1250.0 },
        { item_name: 'Braided USB-C Cable 1.5m', price: 140.0 },
        { item_name: 'TWS Bluetooth Earbuds', price: 950.0 },
      ],
      price_history: [
        { item_name: '65W Fast Charger Adapter', price: 820.0, date: new Date('2026-08-01T00:00:00Z') },
        { item_name: '65W Fast Charger Adapter', price: 850.0, date: new Date('2026-08-28T00:00:00Z') },
      ],
    },
    {
      owner_id: 'OWNER001',
      supplier_id: 'SUP002',
      supplier_name: 'Pandey Electronics',
      name: 'Swastik Pandey',
      email: 'swastikpandey9999@gmail.com',
      phone: '9161236436',
      lead_time_days: 1,
      reliability_score: 98,
      items_sold: ['Wireless Optical Mouse', 'Membrane USB Keyboard', 'High-Speed HDMI 2.0 Cable 2m'],
      catalog: [
        { item_name: 'Wireless Optical Mouse', price: 320.0 },
        { item_name: 'Membrane USB Keyboard', price: 450.0 },
        { item_name: 'High-Speed HDMI 2.0 Cable 2m', price: 180.0 },
      ],
      price_history: [
        { item_name: 'Wireless Optical Mouse', price: 310.0, date: new Date('2026-08-01T00:00:00Z') },
        { item_name: 'Wireless Optical Mouse', price: 320.0, date: new Date('2026-08-28T00:00:00Z') },
      ],
    },
    {
      owner_id: 'OWNER001',
      supplier_id: 'SUP003',
      supplier_name: 'Sangani Digital',
      name: 'Meet Sangani',
      email: 'meetsangani015@gmail.com',
      phone: '9925808590',
      lead_time_days: 2,
      reliability_score: 91,
      items_sold: ['USB-C to USB-A OTG Adapter', '64GB USB 3.2 Pen Drive', 'Multi-Card Reader (SD/MicroSD)', 'Braided USB-C Cable 1.5m'],
      catalog: [
        { item_name: 'USB-C to USB-A OTG Adapter', price: 95.0 },
        { item_name: '64GB USB 3.2 Pen Drive', price: 380.0 },
        { item_name: 'Multi-Card Reader (SD/MicroSD)', price: 240.0 },
        { item_name: 'Braided USB-C Cable 1.5m', price: 135.0 },
      ],
      price_history: [
        { item_name: '64GB USB 3.2 Pen Drive', price: 390.0, date: new Date('2026-08-01T00:00:00Z') },
        { item_name: '64GB USB 3.2 Pen Drive', price: 380.0, date: new Date('2026-08-28T00:00:00Z') },
      ],
    },
    {
      owner_id: 'OWNER001',
      supplier_id: 'SUP004',
      supplier_name: 'Jain Tech Hub',
      name: 'Pragya Jain',
      email: 'pragyaaa.jainnn@gmail.com',
      phone: '7724982055',
      lead_time_days: 4,
      reliability_score: 88,
      items_sold: ['65W Fast Charger Adapter', '20000mAh Power Bank', 'High-Speed HDMI 2.0 Cable 2m', 'Multi-Card Reader (SD/MicroSD)'],
      catalog: [
        { item_name: '65W Fast Charger Adapter', price: 860.0 },
        { item_name: '20000mAh Power Bank', price: 1280.0 },
        { item_name: 'High-Speed HDMI 2.0 Cable 2m', price: 175.0 },
        { item_name: 'Multi-Card Reader (SD/MicroSD)', price: 245.0 },
      ],
      price_history: [
        { item_name: 'High-Speed HDMI 2.0 Cable 2m', price: 190.0, date: new Date('2026-08-01T00:00:00Z') },
        { item_name: 'High-Speed HDMI 2.0 Cable 2m', price: 175.0, date: new Date('2026-08-28T00:00:00Z') },
      ],
    },
    {
      owner_id: 'OWNER001',
      supplier_id: 'SUP005',
      supplier_name: 'Singh Components',
      name: 'Shivendra Singh',
      email: 'shivendras0902@gmail.com',
      phone: '6387139978',
      lead_time_days: 2,
      reliability_score: 92,
      items_sold: ['Braided USB-C Cable 1.5m', 'TWS Bluetooth Earbuds', 'Wireless Optical Mouse', '64GB USB 3.2 Pen Drive'],
      catalog: [
        { item_name: 'Braided USB-C Cable 1.5m', price: 130.0 },
        { item_name: 'TWS Bluetooth Earbuds', price: 920.0 },
        { item_name: 'Wireless Optical Mouse', price: 310.0 },
        { item_name: '64GB USB 3.2 Pen Drive', price: 370.0 },
      ],
      price_history: [
        { item_name: 'TWS Bluetooth Earbuds', price: 950.0, date: new Date('2026-08-01T00:00:00Z') },
        { item_name: 'TWS Bluetooth Earbuds', price: 920.0, date: new Date('2026-08-28T00:00:00Z') },
      ],
    },
  ]);

  // Seed 60-day realistic sales history for ML Demand Forecasting
  const ordersToInsert = [];
  const now = Date.now();
  const DAY_MS = 86400 * 1000;

  for (let day = 59; day >= 0; day--) {
    const dayDate = new Date(now - day * DAY_MS);

    // 1. Regular/Smooth demand items: steady daily sales, low volatility
    const regularItems = [
      { item_id: 'EACC001', item_name: '65W Fast Charger Adapter', unit_price: 850, base_qty: 3, variance: 1 },
      { item_id: 'EACC002', item_name: '20000mAh Power Bank', unit_price: 1250, base_qty: 2, variance: 1 },
      { item_id: 'EACC003', item_name: 'Braided USB-C Cable 1.5m', unit_price: 140, base_qty: 6, variance: 2 },
      { item_id: 'EACC005', item_name: 'Wireless Optical Mouse', unit_price: 320, base_qty: 3, variance: 1 },
      { item_id: 'EACC006', item_name: 'Membrane USB Keyboard', unit_price: 450, base_qty: 2, variance: 1 },
      { item_id: 'EACC007', item_name: 'High-Speed HDMI 2.0 Cable 2m', unit_price: 180, base_qty: 3, variance: 1 },
      { item_id: 'EACC008', item_name: 'USB-C to USB-A OTG Adapter', unit_price: 95, base_qty: 4, variance: 2 },
      { item_id: 'EACC009', item_name: '64GB USB 3.2 Pen Drive', unit_price: 380, base_qty: 3, variance: 1 },
    ];

    regularItems.forEach((it, idx) => {
      const jitter = ((day * 7 + idx * 13) % (it.variance * 2 + 1)) - it.variance;
      const qty = Math.max(1, it.base_qty + jitter);
      ordersToInsert.push({
        order_id: `ORD-REG-${day}-${idx}`,
        owner_id: 'OWNER001',
        customer_id: `CUST-${1000 + ((day * 3 + idx) % 50)}`,
        items: [{ item_id: it.item_id, item_name: it.item_name, quantity: qty, unit_price: it.unit_price }],
        total_amount: qty * it.unit_price,
        status: 'completed',
        timestamp: dayDate,
      });
    });

    // 2. Irregular demand item: 'TWS Bluetooth Earbuds' (EACC004)
    // Intermittent sporadic sales: 0 units most days, then spikes of 8-12 units
    if (day % 7 === 2 || day % 11 === 0) {
      const burstQty = ((day % 3) + 1) * 4;
      ordersToInsert.push({
        order_id: `ORD-IRR1-${day}`,
        owner_id: 'OWNER001',
        customer_id: `CUST-IRR-${day}`,
        items: [{ item_id: 'EACC004', item_name: 'TWS Bluetooth Earbuds', quantity: burstQty, unit_price: 950 }],
        total_amount: burstQty * 950,
        status: 'completed',
        timestamp: dayDate,
      });
    }

    // 3. Lumpy/Volatile demand item: 'Multi-Card Reader (SD/MicroSD)' (EACC010)
    // Highly irregular: zero for 10-12 days, then sudden bulk order of 14 units
    if (day % 12 === 5) {
      const burstQty = (day % 2 === 0) ? 14 : 2;
      ordersToInsert.push({
        order_id: `ORD-IRR2-${day}`,
        owner_id: 'OWNER001',
        customer_id: `CUST-LUMP-${day}`,
        items: [{ item_id: 'EACC010', item_name: 'Multi-Card Reader (SD/MicroSD)', quantity: burstQty, unit_price: 240 }],
        total_amount: burstQty * 240,
        status: 'completed',
        timestamp: dayDate,
      });
    }
  }

  await Order.insertMany(ordersToInsert);
  console.log(`Seeded ${ordersToInsert.length} historical sales transactions in orders collection.`);

  console.log('Seed complete.');
  console.log('Login with: odi45rs@gmail.com / password123');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
