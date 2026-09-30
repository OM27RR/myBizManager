import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import './Sidebar.css'

export default function Sidebar() {
  const { business, logout, emailIntegration } = useApp()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('mybiz_sidebar_collapsed') === 'true'
  })

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('mybiz_sidebar_collapsed', String(next))
      return next
    })
  }

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Sidebar Header & Toggle */}
      <div className="sidebar-header">
        <div 
          className="brand" 
          title={collapsed ? 'myBizManager — Ops Agent' : undefined}
        >
          <img src="/logo.png" alt="myBizManager Logo" className="brand-logo-img" />
          {!collapsed && (
            <div className="brand-text">
              myBizManager
              <span className="sub">Ops Agent</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse to icon rail'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        <NavLink
          to="/app/dashboard"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Dashboard"
        >
          <span className="nav-icon">&#9679;</span>
          {!collapsed && <span className="nav-label">Dashboard</span>}
        </NavLink>

        <NavLink
          to="/app/inventory"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Inventory"
        >
          <span className="nav-icon">&#9776;</span>
          {!collapsed && <span className="nav-label">Inventory</span>}
        </NavLink>

        <NavLink
          to="/app/suppliers"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Suppliers"
        >
          <span className="nav-icon">&#128230;</span>
          {!collapsed && <span className="nav-label">Suppliers</span>}
        </NavLink>

        <NavLink
          to="/app/log"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Action Log"
        >
          <span className="nav-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="15" x2="8" y2="17" />
              <line x1="16" y1="15" x2="16" y2="17" />
            </svg>
          </span>
          {!collapsed && <span className="nav-label">Action Log</span>}
        </NavLink>

        <NavLink
          to="/app/notifications"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Notifications"
        >
          <span className="nav-icon">&#9993;</span>
          {!collapsed && <span className="nav-label">Notifications</span>}
        </NavLink>
      </nav>

      {/* Footer / Account & Explicit Logout */}
      <div className="sidebar-footer">
        <div 
          className="owner-row" 
          title={`${business?.name || 'Owner'} (${business?.ownerName || 'Admin'})`}
        >
          <div className="owner-avatar">{business?.initials || 'OM'}</div>
          {!collapsed && (
            <div className="owner-meta">
              <div className="owner-name">{business?.name || 'OM’s Electronics'}</div>
              <div className="owner-shop">{business?.ownerName || 'Store Owner'}</div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-logout-btn"
          onClick={handleLogout}
          title="Log out of account"
          aria-label="Log out"
        >
          <svg className="logout-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  )
}

