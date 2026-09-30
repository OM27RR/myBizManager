const config = require('../core/config');

// Human-readable labels for fields that can trigger a duplicate-key
// (E11000) error across the app's unique indexes. Falls back to a generic
// message for any field not listed here, rather than guessing.
const DUPLICATE_FIELD_MESSAGES = {
  email: 'An account with this email already exists',
  owner_id: 'That owner ID is already in use',
  item_id: 'An inventory item with that ID already exists',
  supplier_id: 'A supplier with that ID already exists',
};

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong';

  if (err.code === 11000) {
    statusCode = 409;
    // err.keyValue looks like { email: 'x@y.com' } or, for a compound index,
    // { owner_id: 'OWNER001', item_id: 'EACC001' }. Previously this always
    // said "email already exists" regardless of which field actually
    // collided. owner_id shows up in every compound key but is rarely the
    // meaningful cause, so specific fields are checked first.
    const keys = err.keyValue ? Object.keys(err.keyValue) : [];
    const priority = ['item_id', 'supplier_id', 'email', 'owner_id'];
    const duplicateField = priority.find((f) => keys.includes(f)) || keys[0] || null;
    message = DUPLICATE_FIELD_MESSAGES[duplicateField] || 'A record with these details already exists';
  }
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  }

  const response = { status: 'error', message };
  if (!config.isProd && !err.isOperational) {
    response.stack = err.stack;
  }
  if (!config.isProd) console.error(err);

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
