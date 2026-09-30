import { Navigate, Outlet } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

export default function ProtectedRoute() {
  const { isAuthenticated, authLoading } = useApp()

  // Still waiting on GET /api/auth/me — don't redirect yet, or a real
  // logged-in session (valid cookie) gets bounced to /auth on every refresh.
  if (authLoading) {
    return <div className="auth-loading">Loading…</div>
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/auth?tab=login" replace />
}
