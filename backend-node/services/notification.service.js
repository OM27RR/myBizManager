const Notification = require('../models/Notification');

// Derives the Notifications page's color from direction + status, per the
// spec: yellow = owner -> supplier (outbound), green = supplier confirmed
// (order placed), red = supplier rejected / timed out (not placed).
function colorFor(direction, status) {
  if (status === 'in_transit') return 'blue';
  if (status === 'ambiguous') return 'purple';
  if (direction === 'outbound') return status === 'failed' ? 'red' : 'yellow';
  if (direction === 'inbound') return status === 'confirmed' ? 'green' : 'red';
  // direction === 'system' — agent-generated updates that aren't themselves
  // an email (e.g. reply_watcher.py asking approval to try the next
  // supplier, or reporting suppliers are exhausted for an item).
  if (direction === 'system') return status === 'exhausted' ? 'red' : 'blue';
  return 'yellow';
}

function toEmailShape(doc) {
  return {
    id: doc._id,
    direction: doc.direction,
    status: doc.status,
    color: colorFor(doc.direction, doc.status),
    subject: doc.subject,
    body: doc.body,
    from: doc.email_from,
    to: doc.email_to,
    supplierName: doc.supplier_name,
    itemName: doc.item_name,
    itemId: doc.item_id,
    poId: doc.po_id,
    poTag: doc.po_tag,
    timestamp: doc.timestamp,
    needsCustomReply: doc.needs_custom_reply || doc.status === 'ambiguous',
    replied: !!doc.replied,
    supplierEmail: doc.email_from || doc.supplier_email,
  };
}

// Only the procurement email trail (kind: 'email') is shown on the
// Notifications page — generic dashboard pings (kind: 'generic', written
// by send_notification for things like "PO email sent" summaries) are a
// different feed and would just be noise here.
async function getEmailNotifications(ownerId) {
  const docs = await Notification.find({ owner_id: ownerId, kind: 'email' }).sort({ timestamp: -1 });
  return docs.map(toEmailShape);
}

module.exports = { getEmailNotifications };
