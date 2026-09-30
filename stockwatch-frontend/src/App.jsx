import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Auth from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Inventory from './pages/Inventory.jsx'
import Suppliers from './pages/Suppliers.jsx'
import ActionLog from './pages/ActionLog.jsx'
import Notifications from './pages/Notifications.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<Auth />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="log" element={<ActionLog />} />
            <Route path="notifications" element={<Notifications />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Mounted once, outside the route tree, so it survives navigation */}
      <Toast />
    </>
  )
}
