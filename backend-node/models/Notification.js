const mongoose = require('mongoose');

// Matches the documents written by FastAPI's
// mcp_service/common.py::log_email_notification (procurement emails) and
// mcp_service/notifications/tools.py::send_notification (generic dashboard
// pings). Both write to the same `notifications` collection, so this
// schema is intentionally loose — every field except owner_id/timestamp is
// optional, since a generic dashboard ping won't have subject/body/etc.
const notificationSchema = new mongoose.Schema(
  {
    notification_id: { type: String, index: true },
    owner_id: { type: String, required: true, index: true },

    // "email" for procurement PO emails (what the Notifications page
    // renders); generic dashboard pings from send_notification omit this.
    kind: { type: String, default: 'generic' },

    // "outbound" (owner -> supplier) | "inbound" (supplier -> owner)
    direction: { type: String },

    // "sent" | "failed" | "confirmed" | "rejected" | "timeout"
    status: { type: String },

    subject: { type: String },
    body: { type: String },
    email_from: { type: String },
    email_to: { type: String },
    supplier_name: { type: String },
    item_id: { type: String },
    item_name: { type: String },
    po_id: { type: String },
    po_tag: { type: String },

    // Generic dashboard-ping fields (send_notification)
    message: { type: String },
    priority: { type: String },
    source: { type: String },

    read: { type: Boolean, default: false },

    // Written by FastAPI as a Unix timestamp (time.time()), not a BSON
    // Date — kept as Number here to match exactly what's on disk instead
    // of coercing/losing precision.
    timestamp: { type: Number, required: true, index: true },
  },
  {
    versionKey: false,
    collection: 'notifications',
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
