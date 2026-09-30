import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { todayDisplayDate } from '../utils/inventory.js'
import Modal from './Modal.jsx'

export default function AddItemModal({ onClose }) {
  const { addInventoryItem } = useApp()

  const [itemName, setItemName] = useState('')
  const [currentStock, setCurrentStock] = useState('')
  const [lowStockThreshold, setLowStockThreshold] = useState('10')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()

    const name = itemName.trim()
    const stockNum = Number(currentStock)
    const thresholdNum = Number(lowStockThreshold)

    if (!name) {
      setError('Enter an item name.')
      return
    }
    if (currentStock === '' || Number.isNaN(stockNum) || stockNum < 0) {
      setError('Enter a valid current stock amount.')
      return
    }
    if (lowStockThreshold === '' || Number.isNaN(thresholdNum) || thresholdNum < 0) {
      setError('Enter a valid low stock alert level.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await addInventoryItem({
        itemName: name,
        currentStock: stockNum,
        // Status is derived server-side from currentStock vs. this
        // threshold — there's no manual status field anymore, so a 0-stock
        // item can never be saved as "Healthy" again.
        lowStockThreshold: thresholdNum,
        unit: 'unit',
        lastUpdated: todayDisplayDate(),
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Could not add that item. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Add Item" subtitle="Add a new item to your inventory" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Item name</label>
          <input
            type="text"
            placeholder="e.g. USB-C Cable"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="field">
          <label>Current stock</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="e.g. 30"
            value={currentStock}
            onChange={(e) => setCurrentStock(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Low stock alert level</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="e.g. 10"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Item'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
