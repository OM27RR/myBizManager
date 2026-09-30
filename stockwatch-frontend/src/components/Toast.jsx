import { useApp } from '../context/AppContext.jsx'
import './Toast.css'

export default function Toast() {
  const { toast } = useApp()

  if (!toast?.visible) return null

  // Explicit styling for warning (yellow/amber), error (red), and success (green)
  let backgroundStyle = {}
  let icon = '🛈'

  if (toast.type === 'warning') {
    backgroundStyle = {
      backgroundColor: '#78350f', // Warm Amber / Yellow background
      border: '1px solid #f59e0b',
      color: '#fef3c7',
    }
    icon = '⚠'
  } else if (toast.type === 'error') {
    backgroundStyle = {
      backgroundColor: '#7f1d1d',
      border: '1px solid #ef4444',
      color: '#fee2e2',
    }
    icon = '!'
  } else if (toast.type === 'success') {
    backgroundStyle = {
      backgroundColor: '#064e3b',
      border: '1px solid #10b981',
      color: '#34d399',
    }
    icon = '✓'
  }

  return (
    <div
      className={`toast toast-${toast.type || 'info'}`}
      style={{
        ...backgroundStyle,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 18px',
        borderRadius: '8px',
        fontWeight: 500,
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{icon}</span>
      <span>{toast.message}</span>
    </div>
  )
}