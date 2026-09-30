import { useMemo, useState, useEffect } from 'react'
import { useApp } from '../context/AppContext.jsx'
import StatCard from '../components/StatCard.jsx'
import AddSupplierModal from '../components/AddSupplierModal.jsx'
import '../styles/vaultedge.css'
import './Suppliers.css'

export default function Suppliers() {
  const { suppliers, deleteSupplier } = useApp()

  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [activeActionRowId, setActiveActionRowId] = useState(null)

  // Close action dropdown on outside click or Escape key
  useEffect(() => {
    if (!activeActionRowId) return
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.action-menu-wrap')) {
        setActiveActionRowId(null)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setActiveActionRowId(null)
    }
    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeActionRowId])

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => {
      const supName = (s.supplier_name || s.name || '').toLowerCase()
      const contactName = (s.contact_name || '').toLowerCase()
      const email = (s.email || '').toLowerCase()
      const items = (s.items_sold || s.itemsSold || []).map((i) => String(i).toLowerCase())
      return (
        supName.includes(q) ||
        contactName.includes(q) ||
        email.includes(q) ||
        items.some((item) => item.includes(q))
      )
    })
  }, [suppliers, search])

  const categoriesCovered = useMemo(() => {
    const set = new Set()
    suppliers.forEach((s) => {
      const items = s.items_sold || s.itemsSold || []
      items.forEach((item) => set.add(item))
    })
    return set.size
  }, [suppliers])

  const avgReliability = useMemo(() => {
    if (!suppliers.length) return '—'
    const valid = suppliers.filter((s) => s.reliability_score !== undefined)
    if (!valid.length) return '90%'
    const avg = Math.round(valid.reduce((sum, s) => sum + Number(s.reliability_score || 0), 0) / valid.length)
    return `${avg}%`
  }, [suppliers])

  const avgLeadTime = useMemo(() => {
    if (!suppliers.length) return '—'
    const valid = suppliers.filter((s) => s.lead_time_days !== undefined)
    if (!valid.length) return '2d'
    const avg = (valid.reduce((sum, s) => sum + Number(s.lead_time_days || 0), 0) / valid.length).toFixed(1)
    return `${avg}d`
  }, [suppliers])

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier)
    setShowAddModal(true)
  }

  const handleCloseModal = () => {
    setShowAddModal(false)
    setEditingSupplier(null)
  }

  return (
    <div className="page suppliers-page">
      {/* 1. Header with Page Title & Add Button */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <div className="page-sub">Directory of all connected vendors and fulfillment partners</div>
        </div>
        <button
          type="button"
          className="btn-add-supplier"
          onClick={() => {
            setEditingSupplier(null)
            setShowAddModal(true)
          }}
        >
          + Add Supplier
        </button>
      </div>

      {/* 2. Full-Size Stat Cards */}
      <div className="stat-row">
        <StatCard value={suppliers.length} label="Total Suppliers" tone="default" />
        <StatCard value={categoriesCovered} label="Items Covered" tone="amber" />
        <StatCard value={avgReliability} label="Avg Reliability" tone="green" />
        <StatCard value={avgLeadTime} label="Avg Lead Time" tone="cyan" />
      </div>

      {/* 3. Search Bar Controls */}
      <div className="inventory-controls">
        <div className="search-capsule-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="inventory-search"
            placeholder="Search supplier, contact, email, or item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 4. Suppliers Directory Table (Fixed layout, 100% in-frame, shows all items) */}
      <div className="suppliers-table-card">
        <table className="suppliers-table">
          <colgroup>
            <col style={{ width: '17%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Lead Time</th>
              <th>Reliability</th>
              <th>Items Sold</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={8} className="suppliers-empty">
                  No suppliers match your search query.
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((s, idx) => {
                const rowId = s._id || s.id || `sup-${idx}`
                const items = s.items_sold || s.itemsSold || []
                const relScore = Number(s.reliability_score || 90)
                const relColor = relScore >= 90 ? '#10b981' : relScore >= 75 ? '#e5a823' : '#ef4444'
                const isNearBottom = filteredSuppliers.length > 2 && idx >= filteredSuppliers.length - 2

                return (
                  <tr key={rowId}>
                    {/* Supplier Name & Avatar */}
                    <td>
                      <div className="supplier-cell">
                        <div className="supplier-avatar-badge">
                          {(s.supplier_name || s.name || 'S').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="supplier-title-wrap">
                          <span className="supplier-name-txt" title={s.supplier_name || s.name}>
                            {s.supplier_name || s.name}
                          </span>
                          <span className="supplier-verified-badge">
                            ✓ Verified Partner
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Contact Person */}
                    <td>
                      <div className="supplier-contact-txt" title={s.contact_name || s.name}>
                        {s.contact_name || s.name || '—'}
                      </div>
                    </td>

                    {/* Email with Hover Tooltip */}
                    <td>
                      {s.email ? (
                        <a href={`mailto:${s.email}`} className="supplier-email-link" title={s.email}>
                          {s.email}
                        </a>
                      ) : (
                        <span className="supplier-dim-txt">—</span>
                      )}
                    </td>

                    {/* Phone Number */}
                    <td>
                      <span className="supplier-phone-txt" title={s.phone || '—'}>
                        {s.phone || '—'}
                      </span>
                    </td>

                    {/* Lead Time */}
                    <td>
                      <span className="supplier-mono-txt">
                        {s.lead_time_days !== undefined ? `${s.lead_time_days}d` : '2d'}
                      </span>
                    </td>

                    {/* Reliability Percentage */}
                    <td>
                      <span className="supplier-reliability-pill" style={{ color: relColor }}>
                        {s.reliability_score !== undefined ? `${s.reliability_score}%` : '90%'}
                      </span>
                    </td>

                    {/* Items Sold - Shows ALL items with badge wrapping */}
                    <td>
                      <div className="supplier-items-wrap">
                        {items.length > 0 ? (
                          items.map((item, iIdx) => (
                            <span key={iIdx} className="supplier-item-badge" title={item}>
                              {item}
                            </span>
                          ))
                        ) : (
                          <span className="supplier-dim-txt">No items listed</span>
                        )}
                      </div>
                    </td>

                    {/* Actions - Three dots menu identical to Inventory */}
                    <td className="supplier-actions-cell" style={{ textAlign: 'center', position: 'relative' }}>
                      <div className="action-menu-wrap">
                        <button
                          type="button"
                          className={`action-menu-dots ${activeActionRowId === rowId ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveActionRowId((prev) => (prev === rowId ? null : rowId))
                          }}
                          title="Actions"
                          aria-label={`Actions for ${s.supplier_name || s.name}`}
                          aria-haspopup="true"
                          aria-expanded={activeActionRowId === rowId}
                        >
                          ⋮
                        </button>

                        {activeActionRowId === rowId && (
                          <div className={`action-dropdown ${isNearBottom ? 'drop-up' : ''}`} role="menu">
                            <button
                              type="button"
                              className="action-dropdown-item edit"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveActionRowId(null)
                                handleEdit(s)
                              }}
                              role="menuitem"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              className="action-dropdown-item delete"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveActionRowId(null)
                                const targetName = s.supplier_name || s.name
                                const targetId = s._id || s.id
                                if (window.confirm(`Delete "${targetName}" from suppliers?`)) {
                                  deleteSupplier(targetId)
                                }
                              }}
                              role="menuitem"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <AddSupplierModal
          key={editingSupplier?._id || editingSupplier?.id || 'new'}
          supplierToEdit={editingSupplier}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}