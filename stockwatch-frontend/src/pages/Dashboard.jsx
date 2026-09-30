import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import AlertCard from '../components/AlertCard.jsx'
import EmptyState from '../components/EmptyState.jsx'

export default function Dashboard() {
  const { business, alerts, simulateDrop, emailIntegration, connectGoogleEmail, disconnectGoogleEmail } = useApp()
  const [loadingSimulate, setLoadingSimulate] = useState(false)

  // Filter alerts so only items strictly below their dynamic ML predicted threshold are treated as active
  const activeAlerts = (alerts || []).filter((alert) => {
    const rawStock =
      alert.current_stock ??
      alert.currentStock ??
      alert.stock ??
      (typeof alert.inventory === 'object' ? alert.inventory?.current_stock : null)

    const currentStockNum =
      rawStock !== undefined && rawStock !== null && !isNaN(Number(rawStock))
        ? Number(rawStock)
        : 0

    const predNeed =
      alert.predicted_quantity ??
      alert.recommended_qty ??
      alert.demand_forecast?.recommended_qty ??
      alert.demand_forecast?.predicted_demand ??
      alert.low_stock_threshold ??
      10

    // Dynamic ML threshold = current stock + predicted need (e.g. 2 + 19 = 21)
    const mlThreshold = currentStockNum + Number(predNeed)

    // If stock number is explicitly provided, evaluate against the item's individual ML threshold
    if (rawStock !== undefined && rawStock !== null && !isNaN(Number(rawStock))) {
      return currentStockNum < mlThreshold
    }

    // Default to true if stock property is not on the alert model directly
    return true
  })

  const handleSimulate = async () => {
    setLoadingSimulate(true)
    try {
      await simulateDrop()
    } catch (err) {
      console.warn('Simulation check error:', err)
    } finally {
      setLoadingSimulate(false)
    }
  }

  return (
    <div className="page">
      <div className="welcome-banner">
        <div>
          Welcome, <b>{business?.ownerName || 'Business Owner'}</b>
        </div>
        <div>
          {activeAlerts.length === 0
            ? 'No pending alerts right now, everything looks on track.'
            : `You have ${activeAlerts.length} alert${activeAlerts.length > 1 ? 's' : ''} waiting on your decision.`}
        </div>
      </div>

      {/* Email Integration Status Card (Google OAuth 2.0) */}
      <div
        style={{
          background: emailIntegration?.connected ? 'rgba(16, 185, 129, 0.08)' : 'var(--panel)',
          border: `1px solid ${emailIntegration?.connected ? 'rgba(16, 185, 129, 0.35)' : 'var(--border)'}`,
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: emailIntegration?.connected ? 'rgba(16, 185, 129, 0.18)' : 'var(--panel-raised)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              border: '1px solid var(--border)',
            }}
          >
            {emailIntegration?.connected ? '🟢' : '📧'}
          </div>
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: '15px',
                color: emailIntegration?.connected ? '#34d399' : 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {emailIntegration?.connected
                ? `Connected: sending as ${emailIntegration.email}`
                : 'Email Integration: Not connected'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-mid)', marginTop: '3px', maxWidth: '650px', lineHeight: '1.4' }}>
              {emailIntegration?.connected
                ? 'All autonomous purchase orders go out directly from your Gmail, and supplier replies are monitored in your inbox.'
                : 'Supplier orders currently fall back to the shared relay (odi45rs@gmail.com). Click Connect Gmail to authorize personalized sending via Google.'}
            </div>
          </div>
        </div>

        <div>
          {emailIntegration?.connected ? (
            <button
              onClick={disconnectGoogleEmail}
              disabled={emailIntegration?.loading}
              className="btn btn-secondary"
              style={{
                padding: '7px 14px',
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '6px',
                borderColor: '#cbd5e1',
              }}
            >
              {emailIntegration?.loading ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={connectGoogleEmail}
              disabled={emailIntegration?.loading}
              className="btn btn-primary"
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '6px',
                background: '#2563eb',
              }}
            >
              {emailIntegration?.loading ? 'Connecting…' : 'Connect Gmail'}
            </button>
          )}
        </div>
      </div>

      <div className="topbar">

        <div>
          <div className="page-title">Pending Alerts</div>
          <div className="page-sub">Agent-detected issues awaiting your decision</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSimulate}
          disabled={loadingSimulate}
          style={{ opacity: loadingSimulate ? 0.7 : 1, cursor: loadingSimulate ? 'not-allowed' : 'pointer' }}
        >
          {loadingSimulate ? 'Checking Stock...' : '+ Simulate Stock Drop'}
        </button>
      </div>

      {activeAlerts.length === 0 ? (
        <EmptyState
          title="No Stock Risk Currently"
          description="All inventory items are currently healthy and well above their reorder thresholds."
        />
      ) : (
        activeAlerts.map((alert) => (
          <AlertCard key={alert.action_id || alert.id || alert._id} alert={alert} />
        ))
      )}
    </div>
  )
}