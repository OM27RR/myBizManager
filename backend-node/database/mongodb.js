const mongoose = require('mongoose');
const dns = require('dns');
const config = require('../core/config');
const Owner = require('../models/Owner');
const Inventory = require('../models/Inventory');

// Node's default DNS resolver (c-ares) can fail on mongodb+srv:// SRV record
// lookups on some Windows machines, even though the OS resolver (used by
// nslookup, Compass, Python) succeeds fine on the exact same network. This
// was already applied in database/seed.js but missing here — meaning the
// actual running server could still fail to connect even after seeding
// worked. Harmless no-op if the machine's default resolver already works.
dns.setServers(['8.8.8.8', '1.1.1.1']);

let memoryServer = null;

async function connectDB() {
  try {
    let uri = config.mongoUri;

    if (config.useMemoryDb) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
      console.log('Using in-memory MongoDB for testing');
    }

    await mongoose.connect(uri, { dbName: config.useMemoryDb ? undefined : config.dbName });
    console.log(`MongoDB connected${config.useMemoryDb ? '' : ` (db: ${config.dbName})`}`);

    // Drops any index left over from an earlier version of a schema (e.g. a
    // stale `unique_owner_email` index on a field that no longer exists on
    // Owner) and creates any the current schema is missing, so the database
    // never drifts out of sync with models/Owner.js again. This only touches
    // index metadata — never field names or documents — so it's safe
    // alongside FastAPI, the seed script, or anything else reading `email`.
    await Owner.syncIndexes();

    // One-time cleanup for rows written before status became a derived
    // field (e.g. an item added with 0 stock but manually left as "In
    // Stock" from an old build of AddItemModal). Cheap for a small
    // collection, and a no-op the moment every row is already correct.
    await normalizeInventoryStatus();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

function computeStatus(currentStock, lowStockThreshold) {
  if (currentStock <= 0) return 'Out of Stock';
  if (currentStock <= lowStockThreshold) return 'Low Stock';
  return 'In Stock';
}

async function normalizeInventoryStatus() {
  const docs = await Inventory.find({});
  const stale = docs.filter((doc) => {
    const threshold = doc.low_stock_threshold ?? 10;
    return doc.status !== computeStatus(doc.current_stock, threshold);
  });

  if (stale.length === 0) return;

  await Promise.all(
    stale.map((doc) => {
      doc.low_stock_threshold = doc.low_stock_threshold ?? 10;
      doc.status = computeStatus(doc.current_stock, doc.low_stock_threshold);
      return doc.save();
    })
  );
  console.log(`Normalized status on ${stale.length} inventory row(s) to match current stock.`);
}

async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

module.exports = { connectDB, disconnectDB };