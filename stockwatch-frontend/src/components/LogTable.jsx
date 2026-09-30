import { useApp } from '../context/AppContext.jsx'
import './LogTable.css'

function getStampDetails(decision, supplierOutcome) {
  const status = String(decision || '').toLowerCase().trim()
  const outcome = String(supplierOutcome || '').toLowerCase().trim()

  if (status === 'confirmed' || outcome === 'confirmed') {
    return { className: 'stamp confirmed', label: 'ORDER PLACED' }
  }
  if (status === 'ambiguous' || outcome === 'ambiguous') {
    return { className: 'stamp ambiguous', label: 'CLARIFICATION NEEDED' }
  }
  if (status === 'po_sent' || outcome === 'awaiting_reply' || status === 'approved') {
    return { className: 'stamp approved', label: 'APPROVED' }
  }
  if (
    status === 'out_of_stock' ||
    outcome === 'out_of_stock' ||
    status === 'timeout' ||
    outcome === 'timeout' ||
    status === 'rejected' ||
    outcome === 'rejected' ||
    outcome === 'owner_rejected'
  ) {
    return { className: 'stamp rejected', label: 'ORDER DISAPPROVED' }
  }
  return { className: `stamp ${status}`, label: status ? status.toUpperCase() : 'PENDING' }
}

export default function LogTable({ logs, onDelete }) {
  const { openRatingPrompt, confirmAction, markShipment } = useApp()

  if (!logs || logs.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>
        No action history found.
      </div>
    )
  }

  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Recommendation & Outcome</th>
          <th>Status</th>
          <th>Shipment Status</th>
          <th>When</th>
          {onDelete && <th style={{ textAlign: 'right', width: '60px' }}>Action</th>}
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => {
          const id = log._id || log.action_id || log.id
          const stamp = getStampDetails(log.decision, log.supplier_outcome)
          const outcomeText = log.outcome_text || ''
          const isConfirmed = stamp.label === 'ORDER PLACED'
          const qty = log.quantity || 10

          return (
            <tr key={id}>
              <td className="log-item">
                <div>{log.item_name || log.item}</div>
                {log.supplier_name && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 'normal', marginTop: '2px' }}>
                    Supplier: {log.supplier_name}
                  </div>
                )}
              </td>
              <td className="log-reason">
                <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '13px' }}>
                  Ordered: {qty} units
                </div>
                {(log.predicted_quantity || log.forecast_confidence) && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                    ML Forecast: {log.predicted_quantity || qty} units &nbsp;·&nbsp;
                    <span style={{ color: log.is_irregular_demand ? '#f87171' : '#34d399', fontWeight: 600 }}>
                      {log.forecast_confidence || 85}% Accuracy {log.is_irregular_demand ? '(Irregular)' : '(Regular)'}
                    </span>
                  </div>
                )}
                {outcomeText && (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: stamp.className.includes('confirmed')
                        ? '#34d399'
                        : stamp.className.includes('out_of_stock')
                        ? '#fbbf24'
                        : stamp.className.includes('po_sent')
                        ? '#38bdf8'
                        : stamp.className.includes('timeout')
                        ? '#9ca3af'
                        : '#f87171',
                      marginTop: '4px',
                      fontWeight: 500,
                    }}
                  >
                    ↳ {outcomeText}
                  </div>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                  <span className={stamp.className}>
                    {stamp.label}
                  </span>

                  {stamp.label === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => confirmAction(id)}
                      title="Simulate supplier confirmation / delivery"
                      style={{
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: '#38bdf8',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '10.5px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ✓ Mark Confirmed
                    </button>
                  )}
                </div>
              </td>
              <td>
                {isConfirmed ? (
                  log.shipment_status === 'failed' || (log.rating !== undefined && Number(log.rating) === 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                      <span
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        ✕ Failed
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#f87171', fontWeight: 600 }}>
                        0★ (0% Score)
                      </span>
                    </div>
                  ) : log.shipment_status === 'delivered' || (log.rating !== undefined && Number(log.rating) > 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                      <span
                        style={{
                          background: 'rgba(52, 211, 153, 0.12)',
                          border: '1px solid rgba(52, 211, 153, 0.3)',
                          color: '#34d399',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        ✓ Done
                      </span>

                      {log.rating && Number(log.rating) > 0 ? (
                        <button
                          type="button"
                          onClick={() => openRatingPrompt(log)}
                          title="Click to change your rating"
                          style={{
                            background: 'rgba(251, 191, 36, 0.12)',
                            border: '1px solid rgba(251, 191, 36, 0.35)',
                            color: '#fbbf24',
                            borderRadius: '4px',
                            padding: '2px 7px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {'★'.repeat(log.rating)}{'☆'.repeat(5 - log.rating)} ({log.rating}/5)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRatingPrompt(log)}
                          style={{
                            background: 'rgba(56, 189, 248, 0.12)',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            color: '#38bdf8',
                            borderRadius: '4px',
                            padding: '2px 7px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ⭐ Rate Supplier
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                      <span
                        style={{
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          color: '#38bdf8',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                      >
                        🚚 In Transit
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openRatingPrompt(log)}
                          title="Shipment Done / Received (Opens Rating Prompt)"
                          style={{
                            background: 'rgba(52, 211, 153, 0.15)',
                            border: '1px solid #10b981',
                            color: '#34d399',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.28)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.15)')}
                        >
                          ✓ Done
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Mark shipment from ${log.supplier_name || 'supplier'} as failed / not done? This will automatically assign a 0-star rating.`)) {
                              markShipment(id, 'failed', 0)
                            }
                          }}
                          title="Shipment Not Done / Failed (Auto 0-Star Rating)"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid #ef4444',
                            color: '#f87171',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.28)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)')}
                        >
                          ✕ Wrong
                        </button>
                      </div>
                    </div>
                  )
                ) : stamp.label === 'APPROVED' ? (
                  <span style={{ fontSize: '11.5px', color: '#38bdf8', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    🚚 In Transit
                  </span>
                ) : (
                  <span style={{ color: '#475569' }}>—</span>
                )}
              </td>
              <td className="log-time">{log.when || log.created_at}</td>

              {onDelete && (
                <td style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => onDelete(id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#6b7280',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      transition: 'color 0.15s, background-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#6b7280'
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                    title="Delete log entry"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}