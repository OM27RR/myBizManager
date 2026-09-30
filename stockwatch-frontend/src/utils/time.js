// Small relative-time helper for the Action Log's "When" column. Backend
// AgentAction docs give us real timestamps (triggered_at / decided_at) now
// that the log is wired to the live API instead of mock data.

export function formatRelativeTime(dateInput) {
  if (!dateInput) return ''

  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.round(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} min ago`

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`

  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`

  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
