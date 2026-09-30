// Shared status/date helpers for the Inventory page + AppContext.
// Status is a real field on the database model, but the backend derives its
// value from current_stock vs. low_stock_threshold on every create/adjust —
// it's never picked by hand — so this stays a dumb passthrough on purpose.

export function getStockStatus(status) {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'out of stock') return 'critical'
  if (value === 'low stock') return 'warning'
  return 'good'
}

export function todayDisplayDate() {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
