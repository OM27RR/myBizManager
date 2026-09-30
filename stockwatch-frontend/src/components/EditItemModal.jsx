import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from './Modal.jsx'

export default function EditItemModal({ item, onClose }) {
  const { updateInventoryItem } = useApp()

  const [itemName, setItemName] = useState(item?.itemName || item?.item_name || '')
  const [currentStock, setCurrentStock] = useState(
    item?.currentStock !== undefined
      ? String(item.currentStock)
      : item?.current_stock !== undefined
      ? String(item.current_stock)
      : '0'
  )
  const [lowStockThreshold, setLowStockThreshold] = useState(
    item?.lowStockThreshold !== undefined
      ? String(item.lowStockThreshold)
      : item?.low_stock_threshold !== undefined
      ? String(item.low_stock_threshold)
      : '10'
  )
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
      const itemId = item?.id || item?._id || item?.itemId
      await updateInventoryItem(itemId, {
        itemName: name,
        currentStock: stockNum,
        lowStockThreshold: thresholdNum,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Could not update that item. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Edit Item" subtitle="Modify item details and stock levels" onClose={onClose}>
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
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
