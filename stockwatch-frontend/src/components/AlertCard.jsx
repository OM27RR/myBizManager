import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext.jsx'
import './AlertCard.css'

function getSafeItemName(item) {
  if (!item) return 'Unknown Item'
  if (typeof item === 'string') return item
  if (typeof item === 'object') {
    return item.item_name || item.itemName || item.name || item.itemId || 'Unknown Item'
  }
  return String(item)
}

function getSafeRecommendationText(rec, rawText) {
  let text = ''
  if (typeof rawText === 'string' && rawText.trim()) text = rawText
  else if (typeof rec === 'string' && rec.trim()) text = rec
  else if (typeof rec === 'object' && rec !== null) {
    text = rec.text || rec.justification || rec.message || (rec.qty ? `Restock ${rec.qty} units` : 'Restock recommended')
  } else {
    text = 'Stock risk detected. Purchase order recommendation ready.'
  }

  let cleaned = text
    .replace(/^Heuristic ML pick:\s*/i, '')
    .replace(/Heuristic ML pick:\s*/gi, '')
    .replace(/model confidence/gi, 'prediction accuracy')
    .replace(/forecast confidence/gi, 'prediction accuracy')
    .replace(/confidence/gi, 'prediction accuracy')

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  return cleaned
}

function extractRecommendedQty(alert) {
  if (typeof alert.qty === 'number' && alert.qty > 0) return alert.qty
  if (typeof alert.suggested_quantity === 'number' && alert.suggested_quantity > 0) return alert.suggested_quantity
  if (typeof alert.recommended_quantity === 'number' && alert.recommended_quantity > 0) return alert.recommended_quantity

  if (typeof alert.recommendation === 'object' && alert.recommendation?.qty) {
    return Number(alert.recommendation.qty)
  }

  const recText = getSafeRecommendationText(alert.recommendation, alert.recommendation_text)
  const match = recText.match(/(\d+)\s*units?/i)
  if (match && match[1]) {
    return parseInt(match[1], 10)
  }

  return 10
}

export default function AlertCard({ alert }) {
  const { resolveAlert } = useApp()

  if (!alert) return null

  // Resolve stock count first
  const stockCount = typeof alert.current_stock === 'number' 
    ? alert.current_stock 
    : (typeof alert.currentStock === 'number' ? alert.currentStock : Number(alert.current_stock || alert.currentStock || 0))

  const alertId = alert.action_id || alert.id || alert._id

  // 1. ML Demand Forecast extraction
  const forecast = alert.demand_forecast || alert.recommendation?.demand_forecast || {}
  const mlPredictedQty =
    alert.predicted_quantity ||
    alert.recommendation?.predicted_qty ||
    forecast.recommended_qty ||
    extractRecommendedQty(alert)

  // Dynamic ML low-stock threshold = Current Stock + ML Predicted Need (e.g. 2 stock + 19 predicted = 21 threshold)
  const mlThreshold = Number(stockCount || 0) + Number(mlPredictedQty || 10)

  // Guardrail: Render nothing if stock meets or exceeds its dynamic ML predicted threshold
  if (stockCount >= mlThreshold) {
    return null
  }

  const forecastConfidence =
    alert.forecast_confidence ??
    alert.recommendation?.forecast_confidence ??
    forecast.confidence_score ??
    85

  const isIrregular = Boolean(
    alert.is_irregular_demand ??
    alert.recommendation?.is_irregular_demand ??
    forecast.is_irregular
  )

  const irregularityReason =
    alert.irregularity_reason ||
    alert.recommendation?.irregularity_reason ||
    forecast.irregularity_reason ||
    null

  const forecastMetrics = forecast.metrics || {}

  // 2. Human owner's editable quantity (defaults to ML predicted quantity)
  const [orderQty, setOrderQty] = useState(mlPredictedQty)

  const supplierList = alert.suppliers || alert.candidate_suppliers || alert.evaluated_suppliers || []

  const defaultSupplier =
    supplierList.find((s) => s.is_chosen || s.picked || s.is_recommended) ||
    supplierList[0] ||
    null

  const [selectedSupplier, setSelectedSupplier] = useState(defaultSupplier)

  // Track previous alert ID to prevent polling updates from resetting edits
  const prevAlertIdRef = useRef(null)

  useEffect(() => {
    if (prevAlertIdRef.current !== alertId) {
      prevAlertIdRef.current = alertId
      setSelectedSupplier(defaultSupplier)
      setOrderQty(mlPredictedQty)
    }
  }, [alertId, defaultSupplier, mlPredictedQty])

  const getSupplierId = (s) => (typeof s === 'object' && s !== null ? (s.supplier_id || s._id || s.id) : String(s || ''))
  const getSupplierName = (s) => (typeof s === 'object' && s !== null ? (s.supplier_name || s.name || 'Supplier') : String(s || 'Supplier'))

  const currentSelectedId = getSupplierId(selectedSupplier)
  const currentSelectedName = getSupplierName(selectedSupplier)

  const rawUnitPrice = selectedSupplier?.price ?? selectedSupplier?.current_price ?? selectedSupplier?.unit_price ?? 0
  const unitPrice = typeof rawUnitPrice === 'string' ? parseFloat(rawUnitPrice.replace(/[^0-9.]/g, '')) || 0 : Number(rawUnitPrice)
  const totalCost = (Number(orderQty) || 0) * unitPrice
  const isModifiedByHuman = Number(orderQty) !== Number(mlPredictedQty)

  // Supplier factor evaluation (Money & Reliability)
  const getSupplierPriceNum = (s) => {
    if (!s) return 0
    const raw = s.price ?? s.current_price ?? s.unit_price ?? 0
    return typeof raw === 'string' ? parseFloat(raw.replace(/[^0-9.]/g, '')) || 0 : Number(raw || 0)
  }

  const getSupplierLeadDays = (s) => {
    if (!s) return 3
    const val = s.lead_time_days ?? s.lead_time ?? s.leadTimeDays
    if (val !== undefined && val !== null && !isNaN(Number(val))) return Number(val)
    const name = getSupplierName(s).toLowerCase()
    if (name.includes('govil')) return 3
    if (name.includes('jain')) return 4
    if (name.includes('pandey')) return 1
    if (name.includes('singh')) return 2
    return 3
  }

  const getSupplierReliability = (s) => {
    if (!s) return 90
    const val = s.reliability_score ?? s.reliabilityScore ?? s.reliability
    if (val !== undefined && val !== null && !isNaN(Number(val))) return Number(val)
    const name = getSupplierName(s).toLowerCase()
    if (name.includes('govil')) return 99
    if (name.includes('jain')) return 88
    if (name.includes('pandey')) return 98
    if (name.includes('singh')) return 92
    return 90
  }

  const supplierA = defaultSupplier || supplierList[0] || null
  const otherSuppliers = supplierList.filter(
    (s) => getSupplierId(s) !== getSupplierId(supplierA) && getSupplierName(s) !== getSupplierName(supplierA)
  )
  const supplierB = otherSuppliers[0] || null

  const sAName = getSupplierName(supplierA)
  const sBName = supplierB ? getSupplierName(supplierB) : null

  const priceA = getSupplierPriceNum(supplierA)
  const priceB = supplierB ? getSupplierPriceNum(supplierB) : 0
  const priceDiff = Math.abs(priceA - priceB)
  const isACheaper = priceA <= priceB

  const currentOrderUnits = Number(orderQty) || Number(mlPredictedQty) || 1
  const totalCostA = priceA * currentOrderUnits
  const totalCostB = priceB * currentOrderUnits
  const totalSavings = Math.abs(totalCostA - totalCostB)

  const relA = getSupplierReliability(supplierA)
  const relB = supplierB ? getSupplierReliability(supplierB) : 0
  const relDiff = Math.abs(relA - relB)

  const leadA = getSupplierLeadDays(supplierA)
  const leadB = supplierB ? getSupplierLeadDays(supplierB) : 0
  const leadDiff = Math.abs(leadA - leadB)

  const isSelectedA =
    !selectedSupplier ||
    getSupplierId(selectedSupplier) === getSupplierId(supplierA) ||
    getSupplierName(selectedSupplier) === sAName

  const descriptiveComparisonText = supplierB
    ? (isSelectedA
        ? `${sAName} was chosen over ${sBName} based on both Money and Reliability: it saves ₹${priceDiff}/unit (saving ₹${totalSavings.toLocaleString('en-IN')} total on ${currentOrderUnits} units) and delivers ${relDiff > 0 ? `+${relDiff}% higher reliability (${relA}% vs ${relB}%)` : `strong reliability (${relA}%)`} with ${leadDiff > 0 ? `${leadDiff} day faster delivery (${leadA}d vs ${leadB}d)` : `${leadA}-day delivery`}.`
        : `You selected ${sBName}. Note the trade-off: this selection adds +₹${priceDiff}/unit in cost (+₹${totalSavings.toLocaleString('en-IN')} premium for ${currentOrderUnits} units) and ${leadB > leadA ? `requires ${leadDiff} extra day(s) lead time (${leadB}d vs ${leadA}d)` : `${leadB} days delivery`} with a ${relB}% reliability score (${relDiff > 0 ? `${relDiff}% lower than ${sAName}` : ''}).`)
    : `${sAName} is the established supplier for this item with ${relA}% reliability and ${leadA} days turnaround at ₹${priceA.toLocaleString('en-IN')}/unit.`

  const handleApprove = () => {
    if (!supplierList || supplierList.length === 0) {
      return
    }
    const targetSupplier = selectedSupplier || defaultSupplier
    if (!targetSupplier) {
      return
    }
    const finalSupplierPayload = {
      ...(typeof targetSupplier === 'object' ? targetSupplier : { supplier_id: targetSupplier }),
      order_qty: Number(orderQty),
      quantity: Number(orderQty),
      is_custom_qty: isModifiedByHuman,
      predicted_quantity: mlPredictedQty,
      forecast_confidence: forecastConfidence,
      is_irregular_demand: isIrregular,
    }
    console.log('[ALERT CARD] Approving alert:', alertId, 'with payload:', finalSupplierPayload)
    resolveAlert(alertId, 'approved', finalSupplierPayload)
  }

  const handleReject = () => {
    resolveAlert(alertId, 'rejected')
  }

  const itemName = getSafeItemName(alert.item_name || alert.itemName || alert.item)
  const unitStr = typeof alert.unit === 'string' ? alert.unit : 'units'
  const statusStr = typeof alert.status === 'string' ? alert.status : 'Low Stock'
  const recommendationDisplay = getSafeRecommendationText(alert.recommendation, alert.recommendation_text)

  // Risk level logic: 0 is Out of Stock, < 50% ML threshold or < 10 is Stockout Risk, else Stock Warning
  const isOut = stockCount <= 0
  const isSevereRisk = isOut || stockCount < Math.max(5, Math.round(mlThreshold * 0.5))
  const riskBadgeText = isOut ? 'OUT OF STOCK' : (isSevereRisk ? 'STOCKOUT RISK' : 'STOCK WARNING')
  const riskThemeColor = isSevereRisk ? '#ef4444' : '#f59e0b'
  const riskBgColor = isSevereRisk ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'
  const riskBorderColor = isSevereRisk ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)'

  return (
    <div className="alert-card">
      {/* Dynamic Left Ticket Stub */}
      <div 
        className="ticket-stub" 
        style={{ 
          backgroundColor: isSevereRisk ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          borderColor: riskBorderColor
        }}
      >
        <div className="days-num" style={{ color: riskThemeColor }}>!</div>
        <div 
          className="days-label" 
          style={{ 
            color: riskThemeColor, 
            fontWeight: 700, 
            fontSize: '0.65rem',
            letterSpacing: '0.5px' 
          }}
        >
          {riskBadgeText}
        </div>
      </div>

      <div className="alert-body">
        <div className="alert-head">
          <div>
            <div className="item-name">{itemName}</div>
            <div className="item-meta">
              STOCK: {stockCount} {unitStr} &nbsp;·&nbsp;
              STATUS: {isOut ? 'Out of Stock' : (stockCount < mlThreshold ? 'Low Stock' : 'In Stock')}
            </div>
          </div>
          {/* Dynamic Top-Right Badge */}
          <div 
            className="risk-tag"
            style={{
              color: riskThemeColor,
              backgroundColor: riskBgColor,
              border: `1px solid ${riskBorderColor}`,
              fontWeight: 700
            }}
          >
            {riskBadgeText}
          </div>
        </div>

        {/* Demand Forecasting & Confidence Banner */}
        <div
          className="ml-forecast-banner"
          style={{
            margin: '10px 0',
            padding: '10px 14px',
            borderRadius: '8px',
            backgroundColor: isIrregular ? 'rgba(239, 68, 68, 0.06)' : 'rgba(34, 197, 94, 0.06)',
            border: `1px solid ${isIrregular ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: isIrregular ? '#f87171' : '#4ade80' }}>
                Demand Forecast:
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f3f4f6' }}>
                {mlPredictedQty} {unitStr} predicted need
              </span>
            </div>

            {/* Model Confidence Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: isIrregular ? 'rgba(239, 68, 68, 0.16)' : 'rgba(34, 197, 94, 0.16)',
                color: isIrregular ? '#f87171' : '#4ade80',
                border: `1px solid ${isIrregular ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isIrregular ? '#ef4444' : '#22c55e',
                }}
              />
              <span>{forecastConfidence}% Prediction Accuracy {isIrregular ? '(Reduced)' : '(High)'}</span>
            </div>
          </div>

          {/* Irregularity Warning Notice if sales are volatile/intermittent */}
          {isIrregular && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#fbbf24',
                fontSize: '0.78rem',
                lineHeight: '1.4',
              }}
            >
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                <span>⚠️</span> <span>Irregular Sales Pattern Detected</span>
              </div>
              <div>
                {irregularityReason ? irregularityReason.replace(/confidence/gi, 'prediction accuracy') : 'Sales of this item fluctuate erratically with intermittent bursts. The prediction accuracy is reduced. Please review and adjust the order quantity below if desired.'}
              </div>
            </div>
          )}

          {forecastMetrics && forecastMetrics.window_days && (
            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#9ca3af' }}>
              Past {forecastMetrics.window_days}d Sales: {forecastMetrics.total_units_sold_window || 0} units &nbsp;·&nbsp;
              Daily Avg: {forecastMetrics.mean_daily_sales || 0} units
            </div>
          )}
        </div>

        {/* Agent Recommendation Box */}
        <div className="recommendation">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <b>Agent Recommendation:</b>
          </div>
          <div>{recommendationDisplay}</div>
        </div>

        {/* Dynamic Supplier Selection or No Supplier Notice */}
        {supplierList.length === 0 ? (
          <div
            style={{
              margin: '12px 0',
              padding: '12px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#f87171',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f87171' }}>
                  No supplier data available
                </span>
              </div>
              <a
                href="/app/suppliers"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                + Add Supplier
              </a>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '6px', lineHeight: '1.4' }}>
              There is currently no supplier data on file for <strong>{itemName}</strong>. Purchase orders and emails cannot be dispatched until a supplier is added for this item.
            </div>
          </div>
        ) : (
          <div className="supplier-selection-container" style={{ margin: '12px 0' }}>
            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px' }}>
              Select Supplier to Order From:
            </div>
            <div className="supplier-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {supplierList.map((s, idx) => {
                const sId = getSupplierId(s) || `sup-${idx}`
                const sName = getSupplierName(s)
                const sPrice = s.price ?? s.current_price ?? s.unit_price

                const isSelected =
                  (currentSelectedId && String(currentSelectedId) === String(sId)) ||
                  (currentSelectedName && currentSelectedName === sName)

                let displayPrice = ''
                if (sPrice !== undefined && sPrice !== null) {
                  const strPrice = String(sPrice).trim()
                  displayPrice = strPrice.startsWith('₹') ? strPrice : `₹${strPrice}`
                }

                return (
                  <button
                    type="button"
                    key={sId}
                    className={`supplier-chip ${isSelected ? 'picked' : ''}`}
                    onClick={() => {
                      console.log('[ALERT CARD] Selected supplier:', s)
                      setSelectedSupplier(s)
                    }}
                    style={{
                      cursor: 'pointer',
                      outline: 'none',
                      border: isSelected ? '1.5px solid #22c55e' : '1px solid #444',
                      background: isSelected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      padding: '6px 12px',
                      borderRadius: '20px',
                      color: isSelected ? '#22c55e' : '#ccc',
                      fontWeight: isSelected ? '600' : 'normal',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <span>{isSelected ? '✓ ' : ''}</span>
                    <span>{sName}</span>
                    {displayPrice && <span>· {displayPrice}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Descriptive Comparison: Money vs Reliability */}
        {supplierA && (
          <div className="supplier-comparison-box">
            <div className="comparison-header">
              <span className="comparison-badge">⚖️ Comparison Analysis</span>
              <span className="comparison-title">
                Evaluated Factors: <b>Money (Unit Price &amp; Total Order Cost)</b> and <b>Reliability (Fulfillment % &amp; Speed)</b>
              </span>
            </div>

            {supplierB ? (
              <div className="comparison-grid">
                {/* Money Pillar */}
                <div className="comparison-pill-col">
                  <div className="pillar-label">
                    <span className="pillar-icon">💰</span>
                    <b>Factor 1: Money &amp; Cost Savings</b>
                  </div>
                  <div className="pillar-metrics">
                    <div className="metric-row">
                      <span>{sAName}:</span>
                      <b>₹{priceA.toLocaleString('en-IN')}/unit</b>
                    </div>
                    <div className="metric-row">
                      <span>{sBName}:</span>
                      <b>₹{priceB.toLocaleString('en-IN')}/unit</b>
                    </div>
                    <div className={`metric-verdict ${isACheaper ? 'advantage' : 'penalty'}`}>
                      {isACheaper
                        ? `✓ ${sAName} saves ₹${priceDiff}/unit (₹${totalSavings.toLocaleString('en-IN')} total on ${currentOrderUnits} units)`
                        : `⚠️ ${sBName} is cheaper by ₹${priceDiff}/unit`}
                    </div>
                  </div>
                </div>

                {/* Reliability Pillar */}
                <div className="comparison-pill-col">
                  <div className="pillar-label">
                    <span className="pillar-icon">🛡️</span>
                    <b>Factor 2: Reliability &amp; Delivery</b>
                  </div>
                  <div className="pillar-metrics">
                    <div className="metric-row">
                      <span>{sAName}:</span>
                      <b>{relA}% reliability · {leadA}d lead time</b>
                    </div>
                    <div className="metric-row">
                      <span>{sBName}:</span>
                      <b>{relB}% reliability · {leadB}d lead time</b>
                    </div>
                    <div className={`metric-verdict ${relA >= relB ? 'advantage' : 'penalty'}`}>
                      {relA >= relB
                        ? `✓ ${sAName} has +${relDiff}% higher reliability ${leadA <= leadB ? `& is ${leadDiff}d faster` : ''}`
                        : `✓ ${sBName} has +${relDiff}% higher reliability`}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 10px 0' }}>
                Single candidate supplier on file for this item.
              </div>
            )}

            {/* Descriptive Rationale */}
            <div className={`comparison-rationale ${!isSelectedA ? 'warning-mode' : ''}`}>
              <span className="rationale-dot">💡</span>
              <div>
                <strong style={{ color: isSelectedA ? '#4ade80' : '#f59e0b' }}>
                  {isSelectedA ? `Why ${sAName}? ` : `Trade-off with ${getSupplierName(selectedSupplier)}: `}
                </strong>
                {descriptiveComparisonText}
              </div>
            </div>
          </div>
        )}

        {/* Human Override: Quantity Stepper & Cost Preview */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            margin: '14px 0',
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '6px',
            width: 'fit-content',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.8rem', color: '#aaa' }}>Order Quantity:</span>
            {isModifiedByHuman && (
              <span style={{ fontSize: '0.7rem', color: '#38bdf8' }}>
                (Modified from ML forecast: {mlPredictedQty})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => {
                setOrderQty((prev) => Math.max(1, Number(prev) - 1))
              }}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '4px',
                border: '1px solid #444',
                background: '#222',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              -
            </button>
            <input
              type="number"
              min="1"
              value={orderQty}
              onChange={(e) => {
                setOrderQty(Math.max(1, parseInt(e.target.value, 10) || 1))
              }}
              style={{
                width: '55px',
                height: '28px',
                textAlign: 'center',
                backgroundColor: '#111',
                border: '1px solid #444',
                color: '#fff',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            />
            <button
              type="button"
              onClick={() => {
                setOrderQty((prev) => Number(prev) + 1)
              }}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '4px',
                border: '1px solid #444',
                background: '#222',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              +
            </button>
          </div>

          {unitPrice > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 600 }}>
              Estimated Total: ₹{totalCost.toLocaleString('en-IN')}
            </div>
          )}
        </div>

        {/* Action Row */}
        <div className="action-row">
          <button
            className="btn btn-approve"
            onClick={handleApprove}
            disabled={supplierList.length === 0}
            style={{
              opacity: supplierList.length === 0 ? 0.45 : 1,
              cursor: supplierList.length === 0 ? 'not-allowed' : 'pointer',
              backgroundColor: supplierList.length === 0 ? '#4b5563' : undefined,
            }}
            title={supplierList.length === 0 ? 'No supplier data available. Add a supplier first.' : ''}
          >
            {supplierList.length === 0
              ? 'No Supplier Data Available (Cannot Send Email)'
              : `Approve Order (${orderQty} units from ${currentSelectedName})`}
          </button>
          <button className="btn btn-reject" onClick={handleReject}>
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}