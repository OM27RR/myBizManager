import { useApp } from '../context/AppContext.jsx'
import StatCard from '../components/StatCard.jsx'
import LogTable from '../components/LogTable.jsx'
import { actionsApi } from '../services/api.js'

export default function ActionLog() {
  const { logs, stats, refreshData, setLogs } = useApp()

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear the entire action log?')) return
    try {
      await actionsApi.clearAll()
      if (typeof refreshData === 'function') {
        await refreshData()
      } else if (typeof setLogs === 'function') {
        setLogs([])
      }
    } catch (err) {
      alert(err.message || 'Failed to clear action log')
    }
  }

  const handleDeleteSingle = async (actionId) => {
    if (!window.confirm('Delete this action entry?')) return
    try {
      await actionsApi.remove(actionId)
      if (typeof refreshData === 'function') {
        await refreshData()
      } else if (typeof setLogs === 'function') {
        setLogs((prev) => prev.filter((item) => (item._id || item.action_id || item.id) !== actionId))
      }
    } catch (err) {
      alert(err.message || 'Failed to delete action')
    }
  }

  return (
    <div className="page">
      <div className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Action Log</div>
          <div className="page-sub">Full history of what the agent recommended and what you decided</div>
        </div>

        {logs && logs.length > 0 && (
          <button
            onClick={handleClearAll}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)')}
          >
            Clear All Logs
          </button>
        )}
      </div>

      <div className="stat-row">
        <StatCard value={stats?.total ?? 0} label="Total Actions" tone="amber" />
        <StatCard value={stats?.po_sent ?? 0} label="Approved" tone="cyan" />
        <StatCard value={stats?.approved ?? 0} label="Order Placed" tone="green" />
        <StatCard value={stats?.rejected ?? 0} label="Order Disapproved" tone="red" />
      </div>

      <LogTable logs={logs} onDelete={handleDeleteSingle} />
    </div>
  )
}