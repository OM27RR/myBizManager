export default function StatCard({ value, label, tone = '' }) {
  // Safeguard: Ensure value is always rendered as a primitive number or string
  let displayValue = 0
  if (Array.isArray(value)) {
    displayValue = value.length
  } else if (typeof value === 'number' || typeof value === 'string') {
    displayValue = value
  } else if (typeof value === 'object' && value !== null) {
    displayValue = value.total ?? value.count ?? value.length ?? 0
  }

  // Safeguard: Ensure label is a string
  const displayLabel = typeof label === 'string' ? label : String(label || '')

  return (
    <div className={`stat-box ${tone}`.trim()}>
      <div className="num">{displayValue}</div>
      <div className="lbl">{displayLabel}</div>
    </div>
  )
}