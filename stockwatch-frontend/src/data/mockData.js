// Alerts/logs/inventory/suppliers now come from the real backend (see
// AppContext.jsx) — this file only holds display data with no live-data
// equivalent yet.

export const domains = [
  { label: 'Inventory & Reordering', active: true },
  { label: 'Staff Scheduling', active: false },
  { label: 'Invoice Follow-ups', active: false },
  { label: 'Customer Win-back', active: false },
]
