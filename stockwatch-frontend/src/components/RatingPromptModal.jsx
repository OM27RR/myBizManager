import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from './Modal.jsx'

const RATING_LEVELS = {
  1: {
    label: 'Poor',
    score: 20,
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    desc: 'Severe delays or quality issues. Significantly lowers supplier score.',
  },
  2: {
    label: 'Fair',
    score: 40,
    color: '#fb923c',
    bg: 'rgba(251, 146, 60, 0.12)',
    border: 'rgba(251, 146, 60, 0.35)',
    desc: 'Below average fulfillment. Minor delivery delays or issues.',
  },
  3: {
    label: 'Good',
    score: 60,
    color: '#facc15',
    bg: 'rgba(250, 204, 21, 0.12)',
    border: 'rgba(250, 204, 21, 0.35)',
    desc: 'Acceptable fulfillment. Order delivered within acceptable parameters.',
  },
  4: {
    label: 'Very Good',
    score: 80,
    color: '#60a5fa',
    bg: 'rgba(96, 165, 250, 0.12)',
    border: 'rgba(96, 165, 250, 0.35)',
    desc: 'Fast, smooth fulfillment. Reliable high-quality service.',
  },
  5: {
    label: 'Excellent',
    score: 100,
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.35)',
    desc: 'Perfect on-time delivery with zero issues. Top-tier supplier.',
  },
}

export default function RatingPromptModal() {
  const { activeRatingAction, closeRatingPrompt, rateAction, markShipment } = useApp()
  const [hoveredRating, setHoveredRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [rating, setRating] = useState(5)

  // Strictly sync rating state whenever activeRatingAction changes
  useEffect(() => {
    if (activeRatingAction?.rating && Number(activeRatingAction.rating) > 0) {
      setRating(Number(activeRatingAction.rating))
    } else {
      setRating(5)
    }
    setHoveredRating(0)
  }, [activeRatingAction])

  if (!activeRatingAction) return null

  const supplierName =
    activeRatingAction.selected_supplier_name ||
    activeRatingAction.chosen_supplier ||
    activeRatingAction.supplier_name ||
    'Supplier'

  const itemName = activeRatingAction.item_name || activeRatingAction.item || 'Inventory Item'
  const actionId = activeRatingAction._id || activeRatingAction.id || activeRatingAction.action_id

  // Strictly sync displayed rating: when hovering, use hoveredRating; otherwise use selected rating
  const displayRating = hoveredRating > 0 ? hoveredRating : rating
  const currentLevel = RATING_LEVELS[displayRating] || RATING_LEVELS[5]

  const handleDismissLater = () => {
    if (activeRatingAction?.shipment_status !== 'delivered' && !activeRatingAction?.rating) {
      markShipment(actionId, 'delivered')
    }
    closeRatingPrompt(actionId)
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submitting || !actionId) return
    setSubmitting(true)
    try {
      await rateAction(actionId, rating, 'delivered')
    } catch (err) {
      console.error('Rating submission failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
        maxWidth: '430px',
        width: 'calc(100vw - 48px)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        background: '#0d131f',
        border: '1px solid #1e293b',
        padding: '20px 22px',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontFamily: 'Sora, sans-serif', fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
            ⭐ Rate Supplier Fulfillment
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            Review fulfillment by <strong>{supplierName}</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismissLater}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            fontSize: '20px',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '2px 6px',
            borderRadius: '4px',
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Order Details Header Card */}
        <div
          style={{
            background: '#070b12',
            border: '1px solid #1e293b',
            borderRadius: '10px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ✓ Confirmed Order
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {itemName}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>
              Supplier
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>
              {supplierName}
            </div>
          </div>
        </div>

        {/* 5-Star Interactive Rating Section */}
        <div
          style={{
            background: '#070b12',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            padding: '16px 14px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: '#94a3b8' }}>
            Select rating (1 to 5 stars):
          </div>

          {/* Large Interactive Star Buttons */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            onMouseLeave={() => setHoveredRating(0)}
          >
            {[1, 2, 3, 4, 5].map((star) => {
              const isFilled = star <= displayRating
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => {
                    setRating(star)
                    setHoveredRating(0)
                  }}
                  onMouseEnter={() => setHoveredRating(star)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '2.4rem',
                    lineHeight: 1,
                    padding: '2px',
                    color: isFilled ? '#fbbf24' : '#334155',
                    filter: isFilled ? 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.45))' : 'none',
                    transform: isFilled ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s ease, filter 0.15s ease',
                    outline: 'none',
                  }}
                  aria-label={`${star} Star`}
                >
                  ★
                </button>
              )
            })}
          </div>

          {/* Dynamic Synchronized Rating Badge */}
          <div
            style={{
              background: currentLevel.bg,
              border: `1px solid ${currentLevel.border}`,
              color: currentLevel.color,
              padding: '5px 14px',
              borderRadius: '20px',
              fontSize: '0.88rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{displayRating} ★</span>
            <span style={{ opacity: 0.6 }}>•</span>
            <span>{currentLevel.label}</span>
            <span style={{ opacity: 0.6 }}>•</span>
            <span>{currentLevel.score}% Reliability</span>
          </div>

          {/* Description */}
          <div style={{ textAlign: 'center', fontSize: '0.76rem', color: '#cbd5e1', lineHeight: 1.4 }}>
            {currentLevel.desc}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flex: 1, padding: '9px 12px', fontSize: '13px' }}
            onClick={handleDismissLater}
          >
            Later
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1.6, padding: '9px 14px', fontSize: '13px' }}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : `Submit ${rating}★ Rating`}
          </button>
        </div>
      </form>
    </div>
  )
}
