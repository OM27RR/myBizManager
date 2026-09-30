const { connectDB } = require('../database/mongodb');
const Inventory = require('../models/Inventory');
const AgentAction = require('../models/AgentAction');
const config = require('../core/config');

async function test() {
  await connectDB();
  const pendingItemNames = await AgentAction.find({ owner_id: 'OWNER001', status: 'pending' }).distinct('item_name');
  console.log('pendingItemNames:', pendingItemNames);

  const inventoryItems = await Inventory.find({
    owner_id: 'OWNER001',
    item_name: { $nin: pendingItemNames },
  }).sort({ current_stock: 1 });

  for (const item of inventoryItems) {
    let threshold = item.low_stock_threshold || 10;
    let mlUnits = null;
    try {
      const res = await fetch(
        config.fastApiUrl + '/api/inventory/' + encodeURIComponent(item.item_id || item._id) + '/forecast?owner_id=OWNER001',
        { signal: AbortSignal.timeout(2000) }
      );
      if (res.ok) {
        const forecast = await res.json();
        mlUnits = Number(forecast.recommended_qty || forecast.predicted_quantity || forecast.predicted_demand);
        if (mlUnits && mlUnits > 0) threshold = mlUnits;
      }
    } catch (e) {
      console.log('forecast error for ' + item.item_name + ':', e.message);
    }
    const isAtRisk = Number(item.current_stock) < Number(threshold);
    console.log(item.item_name + ': stock=' + item.current_stock + ', threshold=' + threshold + ', mlUnits=' + mlUnits + ', isAtRisk=' + isAtRisk);
  }
  process.exit(0);
}
test().catch(console.error);
