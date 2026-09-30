const { connectDB } = require('../database/mongodb');
const Inventory = require('../models/Inventory');

async function run() {
  await connectDB();
  const updates = [
    { name: '20000mAh Power Bank', threshold: 21 },
    { name: 'Mechanical Keychron K2', threshold: 14 },
    { name: 'happy dent chewing gum', threshold: 15 },
    { name: '64GB USB 3.2 Pen Drive', threshold: 20 },
    { name: '65W Fast Charger Adapter', threshold: 30 },
    { name: 'Braided USB-C Cable 1.5m', threshold: 26 },
    { name: 'TWS Bluetooth Earbuds', threshold: 36 },
    { name: 'Wireless Optical Mouse', threshold: 45 },
    { name: 'Membrane USB Keyboard', threshold: 30 },
    { name: 'High-Speed HDMI 2.0 Cable 2m', threshold: 38 },
    { name: 'USB-C to USB-A OTG Adapter', threshold: 60 },
    { name: 'Multi-Card Reader (SD/MicroSD)', threshold: 26 },
  ];

  for (const u of updates) {
    const updatePayload = { low_stock_threshold: u.threshold };
    if (u.name === '20000mAh Power Bank') {
      updatePayload.current_stock = 2;
    }
    await Inventory.updateOne({ item_name: u.name }, { $set: updatePayload });
  }

  const AgentAction = require('../models/AgentAction');
  await AgentAction.updateMany({ item_name: '20000mAh Power Bank', status: 'pending' }, { $set: { current_stock: 2 } });

  const all = await Inventory.find({}, 'item_name current_stock low_stock_threshold');
  console.log('Updated inventory items in MongoDB:');
  console.log(all.map(i => `${i.item_name}: Stock ${i.current_stock}, Threshold ${i.low_stock_threshold}`).join('\n'));
  process.exit(0);
}

run().catch(console.error);
