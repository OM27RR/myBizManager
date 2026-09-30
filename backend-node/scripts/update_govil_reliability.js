const { connectDB } = require('../database/mongodb');
const Supplier = require('../models/Supplier');
const AgentAction = require('../models/AgentAction');

async function updateGovil() {
  await connectDB();
  
  // 1. Update Govil Accessories in Supplier collection
  const sRes = await Supplier.updateOne(
    { supplier_name: { $regex: /govil/i } },
    { $set: { reliability_score: 99 } }
  );
  console.log('Supplier update res:', sRes);
  
  // 2. Update candidate_suppliers in AgentAction collection
  const actions = await AgentAction.find({});
  let updatedCount = 0;
  for (const action of actions) {
    let changed = false;
    if (Array.isArray(action.candidate_suppliers)) {
      action.candidate_suppliers = action.candidate_suppliers.map(c => {
        const cName = (c.supplier_name || c.name || '').toLowerCase();
        if (cName.includes('govil') || c.supplier_id === 'SUP001') {
          changed = true;
          return { ...c, reliability_score: 99 };
        }
        return c;
      });
    }
    if (changed) {
      await AgentAction.updateOne({ _id: action._id }, { $set: { candidate_suppliers: action.candidate_suppliers } });
      updatedCount++;
    }
  }
  console.log('AgentAction documents updated:', updatedCount);
  
  // Verify
  const allSups = await Supplier.find({}, 'supplier_name reliability_score').sort({ reliability_score: -1 });
  console.log('All suppliers sorted by reliability:');
  allSups.forEach(s => console.log(`- ${s.supplier_name}: ${s.reliability_score}%`));
  
  process.exit(0);
}

updateGovil().catch((err) => {
  console.error(err);
  process.exit(1);
});
