import { useEffect, useState } from 'react'
import { notificationApi } from '../services/api.js'
import { formatRelativeTime } from '../utils/time.js'
import { useApp } from '../context/AppContext.jsx'
import './Notifications.css'

const STATUS_LABEL = {
  sent: 'Sent to supplier',
  failed: 'Delivery failed',
  confirmed: 'Order confirmed',
  in_transit: 'In transit',
  ambiguous: 'Clarification needed',
  rejected: 'Declined',
  out_of_stock: 'Out of stock',
  timeout: 'No reply received',
  pending_approval: 'Approval needed',
  exhausted: 'No suppliers left',
}

const DIRECTION_LABEL = {
  outbound: 'You → Supplier',
  inbound: 'Supplier → You',
  system: 'Agent update',
}

function NotificationCard({ n, onDelete, onReplied, showToast }) {
  const notifId = n._id || n.id || n.notification_id
  const [replyPrompt, setReplyPrompt] = useState('')
  const [structuredDraft, setStructuredDraft] = useState('')
  const [structuring, setStructuring] = useState(false)
  const [sending, setSending] = useState(false)
  const [isReplied, setIsReplied] = useState(!!n.replied)

  const isAmbiguous = n.status === 'ambiguous' || n.needsCustomReply

  const handleStructure = async () => {
    if (!replyPrompt.trim()) {
      if (showToast) showToast('Please enter your reply instructions first', 'info')
      return
    }
    try {
      setStructuring(true)
      const res = await notificationApi.structureReply(notifId, replyPrompt)
      if (res.structuredBody) {
        setStructuredDraft(res.structuredBody)
        if (showToast) showToast('Draft structured by AI ✨', 'success')
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Failed to structure reply with AI', 'error')
    } finally {
      setStructuring(false)
    }
  }

  const handleSendReply = async () => {
    if (!structuredDraft.trim()) {
      if (showToast) showToast('Structured email draft cannot be empty', 'warning')
      return
    }
    try {
      setSending(true)
      const res = await notificationApi.sendCustomReply(notifId, {
        structuredBody: structuredDraft,
        userPrompt: replyPrompt,
      })
      setIsReplied(true)
      if (res?.declined) {
        if (showToast) showToast('Order declined. Finding next supplier for your dashboard ✨', 'info')
      } else {
        if (showToast) showToast('Custom reply sent to supplier ✓', 'success')
      }
      if (onReplied) onReplied(res?.declined)
    } catch (err) {
      if (showToast) showToast(err.message || 'Failed to send reply to supplier', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`notif-card notif-${n.color}`}>
      <div className="notif-stripe" />
      <div className="notif-body">
        <div className="notif-head">
          <div>
            <span className="notif-arrow">{DIRECTION_LABEL[n.direction] || 'Supplier → You'}</span>
            <span className={`notif-badge notif-badge-${n.color}`}>{STATUS_LABEL[n.status] || n.status}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="notif-time">{formatRelativeTime(n.timestamp * 1000)}</span>
            {onDelete && (
              <button
                onClick={() => onDelete(notifId)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '2px 6px',
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
                title="Delete notification"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="notif-subject">{n.subject}</div>

        <div className="notif-meta">
          {n.itemName && <span>{n.itemName}</span>}
          {n.supplierName && <span>{n.supplierName}</span>}
          {n.poTag && <span className="notif-po">{n.poTag}</span>}
        </div>

        {n.body && <div className="notif-snippet">{n.body}</div>}

        {isAmbiguous && (
          isReplied ? (
            <div className="notif-reply-success">
              <span className="notif-reply-check">✓</span>
              <span>Custom reply has been structured and sent to {n.supplierName || 'supplier'}.</span>
            </div>
          ) : (
            <div className="notif-reply-box">
              <div className="notif-reply-title">
                <span className="notif-reply-sparkle">✨</span>
                <span>AI Custom Reply Assistant</span>
                <span className="notif-reply-hint">Supplier message requires clarification</span>
              </div>

              {!structuredDraft ? (
                <>
                  <textarea
                    className="notif-reply-input"
                    placeholder="Enter your message..."
                    value={replyPrompt}
                    onChange={(e) => setReplyPrompt(e.target.value)}
                    rows={3}
                  />
                  <div className="notif-reply-actions">
                    <button
                      className="notif-btn-structure"
                      onClick={handleStructure}
                      disabled={structuring || !replyPrompt.trim()}
                    >
                      {structuring ? 'Structuring with AI...' : '✨ Structure with AI'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="notif-preview-label">
                    AI-Structured Formal Email (Review & Edit before sending):
                  </div>
                  <textarea
                    className="notif-reply-input notif-reply-preview"
                    value={structuredDraft}
                    onChange={(e) => setStructuredDraft(e.target.value)}
                    rows={6}
                  />
                  <div className="notif-reply-actions">
                    <button
                      className="notif-btn-send"
                      onClick={handleSendReply}
                      disabled={sending || !structuredDraft.trim()}
                    >
                      {sending ? 'Sending to Supplier...' : '🚀 Send to Supplier'}
                    </button>
                    <button
                      className="notif-btn-cancel"
                      onClick={() => setStructuredDraft('')}
                      disabled={sending}
                    >
                      ↺ Edit Instructions
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

export default function Notifications() {
  const { showToast, refreshAgentActivity } = useApp()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [trimming, setTrimming] = useState(false)

  async function load(quiet = false) {
    try {
      if (!quiet) setLoading(true)
      const res = await notificationApi.list()
      const rows = res.notifications || res.data || []
      setNotifications(rows)
    } catch {
      // Quiet poll recovery
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    load()

    const interval = setInterval(() => {
      if (!cancelled) load(true)
    }, 6000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const handleDeleteSingle = async (id) => {
    if (!window.confirm('Delete this notification?')) return
    try {
      await notificationApi.remove(id)
      setNotifications((prev) => prev.filter((item) => (item._id || item.id || item.notification_id) !== id))
      if (showToast) showToast('Notification deleted', 'info')
    } catch (err) {
      alert(err.message || 'Failed to delete notification')
    }
  }

  const handleKeepLast10 = async () => {
    if (notifications.length <= 10) {
      if (showToast) {
        showToast(`You have ${notifications.length} notification${notifications.length === 1 ? '' : 's'} (10 or fewer). None deleted.`, 'info')
      } else {
        alert(`You have ${notifications.length} notification${notifications.length === 1 ? '' : 's'} (10 or fewer). None deleted.`)
      }
      return
    }

    const deleteCount = notifications.length - 10
    if (!window.confirm(`Keep only the 10 most recent notifications and delete ${deleteCount} older notification${deleteCount === 1 ? '' : 's'}?`)) {
      return
    }

    try {
      setTrimming(true)
      await notificationApi.keepLast(10)
      setNotifications((prev) => prev.slice(0, 10))
      if (showToast) {
        showToast(`Kept last 10 notifications (${deleteCount} older removed) ✓`, 'success')
      }
    } catch (err) {
      if (showToast) {
        showToast(err.message || 'Failed to trim notifications', 'error')
      } else {
        alert(err.message || 'Failed to trim notifications')
      }
    } finally {
      setTrimming(false)
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Clear all notifications?')) return
    try {
      setTrimming(true)
      await notificationApi.clearAll()
      setNotifications([])
      if (showToast) showToast('All notifications cleared ✓', 'info')
    } catch (err) {
      alert(err.message || 'Failed to clear notifications')
    } finally {
      setTrimming(false)
    }
  }

  return (
    <div className="page">
      <div className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Notifications</div>
          <div className="page-sub">Every procurement email — sent and received — in one live feed</div>
        </div>

        {notifications.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={handleKeepLast10}
              disabled={trimming}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                cursor: trimming ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={(e) => {
                if (!trimming) e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.2)'
              }}
              onMouseLeave={(e) => {
                if (!trimming) e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)'
              }}
              title="Keep the 10 most recent notifications and delete all older ones"
            >
              Keep Last 10
            </button>

            <button
              onClick={handleClearAll}
              disabled={trimming}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                cursor: trimming ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={(e) => {
                if (!trimming) e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'
              }}
              onMouseLeave={(e) => {
                if (!trimming) e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
              }}
            >
              Clear All Notifications
            </button>
          </div>
        )}
      </div>

      <div className="notif-legend">
        <span><span className="dot notif-dot-yellow" /> Sent to supplier</span>
        <span><span className="dot notif-dot-green" /> Order confirmed</span>
        <span><span className="dot notif-dot-blue" /> In transit</span>
        <span><span className="dot notif-dot-purple" /> Clarification needed</span>
        <span><span className="dot notif-dot-red" /> Declined / no reply</span>
      </div>

      {!loading && notifications.length === 0 ? (
        <div className="empty-state">
          <div className="icon">✉</div>
          No procurement emails yet. They'll show up here as soon as the agent contacts a supplier.
        </div>
      ) : (
        notifications.map((n) => (
          <NotificationCard
            key={n._id || n.id || n.notification_id}
            n={n}
            onDelete={handleDeleteSingle}
            onReplied={(declined) => {
              load(true)
              if (declined && refreshAgentActivity) {
                setTimeout(() => refreshAgentActivity(false), 1200)
              }
            }}
            showToast={showToast}
          />
        ))
      )}
    </div>
  )
}