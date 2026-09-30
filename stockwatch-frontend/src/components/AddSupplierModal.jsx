import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from './Modal.jsx'

const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com']

export default function AddSupplierModal({ onClose, supplierToEdit = null }) {
  const { addSupplier, updateSupplier, inventory = [] } = useApp()
  const isEdit = Boolean(supplierToEdit)

  // Direct state initialization from supplierToEdit to prevent blank renders
  const [supplierName, setSupplierName] = useState(
    () => supplierToEdit?.supplier_name || supplierToEdit?.name || ''
  )
  const [contactName, setContactName] = useState(
    () => supplierToEdit?.contact_name || supplierToEdit?.name || ''
  )
  const [email, setEmail] = useState(() => supplierToEdit?.email || '')
  const [phone, setPhone] = useState(() => supplierToEdit?.phone || '')
  const [leadTimeDays, setLeadTimeDays] = useState(
    () => (supplierToEdit?.lead_time_days !== undefined ? supplierToEdit.lead_time_days : 2)
  )
  const [reliabilityScore, setReliabilityScore] = useState(
    () => (supplierToEdit?.reliability_score !== undefined ? supplierToEdit.reliability_score : 90)
  )

  // Pre-load existing items: handles both structured catalog and legacy items_sold
  const [catalogItems, setCatalogItems] = useState(() => {
    if (!supplierToEdit) return []
    const catalog = supplierToEdit.catalog || supplierToEdit.item_catalog || []
    const itemsSold = supplierToEdit.items_sold || supplierToEdit.itemsSold || []

    if (catalog.length > 0) {
      return catalog.map((c) => ({
        item_id: c.item_id,
        item_name: c.item_name || c.itemName,
        price: Number(c.price || c.current_price || c.unit_price || 500),
      }))
    }
    return itemsSold.map((name) => ({
      item_name: name,
      price: 500,
    }))
  })

  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Email autocomplete suggestions on '@'
  const emailSuggestions = (() => {
    if (!email.includes('@')) return []
    const [userPart, domainPart = ''] = email.split('@')
    if (!userPart) return []

    return COMMON_DOMAINS
      .filter((d) => d.startsWith(domainPart.toLowerCase()))
      .map((d) => `${userPart}@${d}`)
  })()

  function handleAddItem(e) {
    if (e) e.preventDefault()
    const name = itemName.trim()
    const parsedPrice = parseFloat(itemPrice)

    if (!name) {
      setError('Please enter or select an item name.')
      return
    }
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Please enter a valid price.')
      return
    }

    if (catalogItems.some((i) => i.item_name.toLowerCase() === name.toLowerCase())) {
      setError('This item is already listed for this supplier.')
      return
    }

    const matchedInventory = inventory.find(
      (inv) => (inv.item_name || inv.itemName || '').toLowerCase() === name.toLowerCase()
    )

    setCatalogItems((prev) => [
      ...prev,
      {
        item_id: matchedInventory?.item_id || matchedInventory?.itemId,
        item_name: matchedInventory?.item_name || matchedInventory?.itemName || name,
        price: parsedPrice,
      },
    ])

    setItemName('')
    setItemPrice('')
    setError('')
  }

  function removeItem(indexToRemove) {
    setCatalogItems((prev) => prev.filter((_, idx) => idx !== indexToRemove))
  }

  function isValidEmail(val) {
    const clean = val.trim().toLowerCase()
    const baseEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!baseEmailRegex.test(clean)) return false

    const commonTypos = [
      /@gmail\.(c|co|con|cm|om)$/i,
      /@yahoo\.(c|co|con|cm|om)$/i,
      /@outlook\.(c|co|con|cm|om)$/i,
      /@hotmail\.(c|co|con|cm|om)$/i,
      /@icloud\.(c|co|con|cm|om)$/i,
    ]
    return !commonTypos.some((pattern) => pattern.test(clean))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const name = supplierName.trim()
    const contact = contactName.trim()
    const emailVal = email.trim()
    const cleanPhone = phone.trim().replace(/\D/g, '')
    const parsedLeadTime = leadTimeDays !== '' ? parseInt(leadTimeDays, 10) : 2
    const parsedReliability = reliabilityScore !== '' ? parseFloat(reliabilityScore) : 90

    if (!name) return setError('Enter a supplier name.')
    if (!contact) return setError('Enter a contact person name.')
    if (!emailVal || !isValidEmail(emailVal)) return setError('Invalid email address.')
    if (!cleanPhone || cleanPhone.length !== 10) return setError('Invalid phone number.')
    if (isNaN(parsedLeadTime) || parsedLeadTime < 0) {
      return setError('Lead time must be 0 or more days.')
    }
    if (isNaN(parsedReliability) || parsedReliability < 0 || parsedReliability > 100) {
      return setError('Reliability score must be between 0 and 100.')
    }
    if (catalogItems.length === 0) {
      return setError('Supplier must supply at least one item.')
    }

    setError('')
    setSubmitting(true)

    const payload = {
      supplierName: name,
      contactName: contact,
      email: emailVal,
      phone: cleanPhone,
      leadTimeDays: parsedLeadTime,
      reliabilityScore: parsedReliability,
      itemsSold: catalogItems.map((c) => c.item_name),
      catalog: catalogItems.map((c) => ({
        ...c,
        current_price: c.price,
        unit_price: c.price,
        lead_time_days: parsedLeadTime,
      })),
    }

    try {
      if (isEdit) {
        const id = supplierToEdit._id || supplierToEdit.id
        await updateSupplier(id, payload)
      } else {
        await addSupplier(payload)
      }
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save supplier changes.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Supplier' : 'Add Supplier'}
      subtitle={isEdit ? 'Update supplier contact details and catalog items' : 'Add a new supplier to your directory'}
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '520px' }}>
        
        {/* Supplier & Contact Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Supplier / Business</label>
            <input
              type="text"
              placeholder="e.g. Govil Accessories"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Contact Person</label>
            <input
              type="text"
              placeholder="e.g. Nishita Govil"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
        </div>

        {/* Email & Phone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Email</label>
            <input
              type="email"
              list="email-suggestions"
              placeholder="supplier@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
            <datalist id="email-suggestions">
              {emailSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Phone (10 Digits)</label>
            <input
              type="tel"
              placeholder="9876543210"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
        </div>

        {/* Lead Time & Reliability Score */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Lead Time (Days)</label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 2"
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Reliability Score (0-100)</label>
            <input
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 91"
              value={reliabilityScore}
              onChange={(e) => setReliabilityScore(e.target.value)}
            />
          </div>
        </div>

        {/* Catalog Items Section */}
        <div className="field">
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
            Items They Sell & Unit Pricing
          </label>

          {/* Item Add Row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              type="text"
              list="inv-list"
              style={{ flex: 3 }}
              placeholder="Select or type inventory item..."
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
            />
            <datalist id="inv-list">
              {inventory.map((i) => {
                const title = i.item_name || i.itemName
                return title ? <option key={i.id || i.item_id || title} value={title} /> : null
              })}
            </datalist>

            <input
              type="number"
              style={{ flex: 1.2 }}
              placeholder="₹ Price"
              value={itemPrice}
              onChange={(e) => setItemPrice(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
            />

            <button
              type="button"
              className="btn btn-ghost"
              style={{ border: '1px solid #3b82f6', color: '#60a5fa', whiteSpace: 'nowrap', padding: '0 14px' }}
              onClick={handleAddItem}
            >
              + Add Item
            </button>
          </div>

          {/* Interactive Item Badges with Remove (×) Button */}
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '10px',
              minHeight: '60px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '180px',
              overflowY: 'auto',
            }}
          >
            {catalogItems.length === 0 ? (
              <span style={{ color: '#64748b', fontSize: '0.85rem', alignSelf: 'center', margin: 'auto' }}>
                No items attached. Add items using the inputs above.
              </span>
            ) : (
              catalogItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#1e293b',
                    padding: '6px 12px',
                    borderRadius: '6px',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#f8fafc' }}>
                    {item.item_name}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: '#10b981', fontWeight: 600, fontSize: '0.875rem' }}>
                      ₹{item.price}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      title={`Remove ${item.item_name}`}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid #ef4444',
                        color: '#f87171',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        padding: '2px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {error && (
          <div style={{ color: '#f87171', fontSize: '0.85rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: '6px' }}>
            {error}
          </div>
        )}

        {/* Modal Buttons */}
        <div className="modal-actions" style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Supplier'}
          </button>
        </div>
      </form>
    </Modal>
  )
}