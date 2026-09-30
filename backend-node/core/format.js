// Small shared helpers used by the inventory/supplier services.

function formatDisplayDate(date = new Date()) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Generates a human-friendly code such as OWNER001, SUP002, or EACC001.
// ownerId is optional because owner codes are global.
async function generateEntityCode(Model, ownerId, prefix, padLength = 3) {
  try {
    const filter = ownerId ? { owner_id: ownerId } : {};
    const count = await Model.countDocuments(filter);
    return `${prefix}${String(count + 1).padStart(padLength, '0')}`;
  } catch (err) {
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }
}

module.exports = { formatDisplayDate, generateEntityCode };
