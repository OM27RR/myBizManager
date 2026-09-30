import { useMemo, useState, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext.jsx'
import AddItemModal from '../components/AddItemModal.jsx'
import EditItemModal from '../components/EditItemModal.jsx'
import { getStockStatus } from '../utils/inventory.js'
import { formatRelativeTime } from '../utils/time.js'
import './Inventory.css'
import '../styles/vaultedge.css'

const STATUS_LABEL = {
  critical: 'Out of Stock',
  warning: 'Low Stock',
  good: 'In Stock',
}

function getItemName(item) {
  if (!item) return 'Unknown Item'
  if (typeof item === 'string') return item
  if (typeof item === 'object') {
    if (typeof item.itemName === 'string') return item.itemName
    if (typeof item.name === 'string') return item.name
    if (typeof item.item_name === 'string') return item.item_name
    if (typeof item.itemId === 'string') return item.itemId
  }
  return String(item)
}

function getRawStatus(status) {
  if (!status) return 'In Stock'
  if (typeof status === 'string') return status
  if (typeof status === 'object') {
    return status.status || status.label || 'In Stock'
  }
  return String(status)
}

function findItemSupplierInfo(item, suppliers = []) {
  const name = (getItemName(item) || '').toLowerCase()
  const id = String(item?.itemId || item?.item_id || item?.id || '').toLowerCase()

  return (suppliers || []).filter((s) => {
    const itemsSold = (s.items_sold || s.itemsSold || []).map((x) => String(x).toLowerCase())
    const catalog = s.catalog || s.item_catalog || []
    const catalogNames = catalog.map((c) => String(c.item_name || c.itemName || '').toLowerCase())
    const catalogIds = catalog.map((c) => String(c.item_id || c.itemId || '').toLowerCase())
    const priceHist = s.price_history || []
    const histNames = priceHist.map((h) => String(h.item_name || '').toLowerCase())

    return (
      itemsSold.includes(name) ||
      (id && itemsSold.includes(id)) ||
      catalogNames.includes(name) ||
      (id && catalogIds.includes(id)) ||
      histNames.includes(name)
    )
  })
}

function getItemDetails(row, suppliers = [], actions = []) {
  const itemName = getItemName(row?.itemName || row)
  const itemId = String(row?.itemId || row?.item_id || row?.id || '').toLowerCase()

  // 1. All matched suppliers from database
  const matchedSuppliers = findItemSupplierInfo(row, suppliers)
  const supplierNames = Array.from(
    new Set(matchedSuppliers.map((s) => s.supplier_name || s.name).filter(Boolean))
  )
  const displaySuppliers = supplierNames.length > 0 ? supplierNames : [row?.supplier || 'Govil Accessories']

  // 2. Look for past purchase orders in actions for this item
  const itemActions = (actions || []).filter((a) => {
    const aName = (getItemName(a.item_name || a.itemName || a.item) || '').toLowerCase()
    const aId = String(a.item_id || a.itemId || '').toLowerCase()
    return (itemName && aName === itemName.toLowerCase()) || (itemId && aId === itemId)
  }).sort((a, b) => new Date(b.decided_at || b.triggered_at || 0) - new Date(a.decided_at || a.triggered_at || 0))

  const latestOrder = itemActions.find((a) =>
    ['confirmed', 'po_sent', 'approved'].includes(a.status) ||
    ['confirmed', 'awaiting_reply'].includes(a.supplier_outcome)
  ) || itemActions[0]

  // 3. Dynamic Cost calculation (last purchase cost or supplier catalog cost from database)
  let unitCost = null

  if (latestOrder) {
    if (latestOrder.po_details && latestOrder.po_details.total_cost && latestOrder.po_details.qty) {
      unitCost = latestOrder.po_details.total_cost / latestOrder.po_details.qty
    } else if (latestOrder.unit_price) {
      unitCost = Number(latestOrder.unit_price)
    }
  }

  // If not found in latest order, check suppliers' catalog in DB
  if (unitCost === null || isNaN(unitCost) || unitCost <= 0) {
    for (const sup of matchedSuppliers) {
      const catalog = sup.catalog || sup.item_catalog || []
      const catEntry = catalog.find(
        (c) =>
          (c.item_name && c.item_name.toLowerCase() === itemName.toLowerCase()) ||
          (c.item_id && String(c.item_id).toLowerCase() === itemId)
      )
      if (catEntry && typeof catEntry.price === 'number' && catEntry.price > 0) {
        unitCost = catEntry.price
        break
      }
      const history = sup.price_history || []
      const histEntry = history.find(
        (h) => h.item_name && h.item_name.toLowerCase() === itemName.toLowerCase()
      )
      if (histEntry && typeof histEntry.price === 'number' && histEntry.price > 0) {
        unitCost = histEntry.price
        break
      }
    }
  }

  // If not found in suppliers, check row directly
  if (unitCost === null || isNaN(unitCost) || unitCost <= 0) {
    if (typeof row?.cost === 'number' && row.cost > 0) unitCost = row.cost
    else if (typeof row?.price === 'number' && row.price > 0) unitCost = row.price
    else if (typeof row?.unit_price === 'number' && row.unit_price > 0) unitCost = row.unit_price
  }

  // Fallback if none found
  if (unitCost === null || isNaN(unitCost) || unitCost <= 0) {
    unitCost = 250
  }

  // 4. Previous order information (previous supply and supplier)
  let prevSupplier = null
  let prevSupplyQty = null
  let prevDate = null

  if (latestOrder) {
    prevSupplier = latestOrder.selected_supplier_name || latestOrder.chosen_supplier || latestOrder.supplier_name
    prevSupplyQty = latestOrder.quantity || latestOrder.order_quantity || latestOrder.po_details?.qty || latestOrder.qty
    prevDate = latestOrder.decided_at || latestOrder.triggered_at
  }

  if (!prevSupplier) {
    prevSupplier = displaySuppliers[0] || 'Govil Accessories'
  }
  if (!prevSupplyQty) {
    prevSupplyQty = row.currentStock || 25
  }

  return {
    displaySuppliers,
    cost: unitCost,
    prevOrder: {
      supplier: prevSupplier,
      qty: prevSupplyQty,
      date: prevDate,
    },
  }
}

export default function Inventory() {
  const { 
    inventory = [], 
    inventoryStats = {}, 
    suppliers = [], 
    alerts = [],
    actions = [],
    adjustStock, 
    deleteInventoryItem,
    business
  } = useApp()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingStock, setEditingStock] = useState({})
  const [activeActionRowId, setActiveActionRowId] = useState(null)
  const [editingItem, setEditingItem] = useState(null)

  // Close dropdown on outside click or Escape key
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

  // Distinct categories
  const categories = useMemo(() => {
    const set = new Set(['All Categories'])
    inventory.forEach((i) => {
      if (i.category) set.add(i.category)
      else set.add('Electronics')
    })
    return Array.from(set)
  }, [inventory])

  // Filtered items
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (inventory || []).filter((row) => {
      const rawStatus = getRawStatus(row?.status)
      const status = getStockStatus(rawStatus)
      const itemName = getItemName(row?.itemName || row)
      const matchesSearch = itemName.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || status === statusFilter
      const itemCategory = row?.category || 'Electronics'
      const matchesCategory = categoryFilter === 'all' || categoryFilter === 'All Categories' || itemCategory === categoryFilter
      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [inventory, search, statusFilter, categoryFilter])

  // Base stock counts from database inventory
  const totalStockCount = useMemo(() => {
    const sum = inventory.reduce((acc, row) => acc + (Number(row?.currentStock) || 0), 0)
    return sum > 0 ? sum : 0
  }, [inventory])

  const totalItemsCount = (inventory && inventory.length) || 1

  const { healthyCount, lowStockCount, outOfStockCount } = useMemo(() => {
    let healthy = 0
    let low = 0
    let out = 0

    ;(inventory || []).forEach((row) => {
      const stock = Number(row?.currentStock ?? row?.current_stock ?? 0)
      const threshold = Number(row?.lowStockThreshold ?? row?.low_stock_threshold ?? row?.mlThreshold ?? 10)
      if (stock <= 0) {
        out += 1
      } else if (stock <= threshold) {
        low += 1
      } else {
        healthy += 1
      }
    })

    return {
      healthyCount: healthy,
      lowStockCount: low,
      outOfStockCount: out,
    }
  }, [inventory])

  // 1. Dynamic Simulation State for Orders & Stock
  const [orderStats, setOrderStats] = useState(() => ({
    overdue: alerts.length || 1,
    returns: 3,
    inProgress: actions.filter((a) => a.status === 'po_sent' || a.status === 'approved').length || 14,
    completed: actions.filter((a) => a.status === 'confirmed').length || 94,
  }))

  const [orderActivityMessage, setOrderActivityMessage] = useState('Inbound Feed Active')
  const [stockBump, setStockBump] = useState(false)
  const [arrivalPopup, setArrivalPopup] = useState(null)

  // 2. Conveyor Belt Simulation State
  const [parcelProgress, setParcelProgress] = useState(0)
  const [currentParcel, setCurrentParcel] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scannerPhaseText, setScannerPhaseText] = useState('Approaching Scanner')

  // Real display counts (visual simulation does not corrupt baseline catalog inventory)
  const healthyPct = Math.min(100, Math.round((healthyCount / totalItemsCount) * 100))
  const lowStockPct = Math.min(100 - healthyPct, Math.round((lowStockCount / totalItemsCount) * 100))

  // Dynamically calculate Orders chart bar heights based on proportion
  const maxMetric = Math.max(orderStats.overdue, orderStats.returns, orderStats.inProgress, orderStats.completed, 100)
  const getBarHeight = (val) => Math.max(28, Math.min(125, Math.round((val / maxMetric) * 125)))

  // Parcel generator selecting real inventory catalog items
  const getNextParcel = useCallback(() => {
    if (inventory && inventory.length > 0) {
      const randomItem = inventory[Math.floor(Math.random() * inventory.length)]
      const name = getItemName(randomItem?.itemName || randomItem)
      const randomQty = [10, 15, 20, 25, 30][Math.floor(Math.random() * 5)]
      const poNum = `MBM-${Math.floor(100 + Math.random() * 900)}`
      return { name, qty: randomQty, poNumber: poNum }
    }
    const sampleItems = [
      { name: '20000mAh Power Bank', qty: 20, poNumber: 'MBM-849' },
      { name: '65W Fast Charger Adapter', qty: 15, poNumber: 'MBM-850' },
      { name: 'Wireless Optical Mouse', qty: 25, poNumber: 'MBM-851' },
      { name: 'Braided USB-C Cable', qty: 30, poNumber: 'MBM-852' },
      { name: 'TWS Bluetooth Earbuds', qty: 10, poNumber: 'MBM-853' },
    ]
    return sampleItems[Math.floor(Math.random() * sampleItems.length)]
  }, [inventory])

  // Conveyor Belt Animation Loop
  useEffect(() => {
    let animFrameId
    let lastTime = performance.now()
    let parcel = currentParcel || getNextParcel()
    let progress = parcelProgress
    let hasScanned = false
    let hasArrived = false

    if (!currentParcel) {
      setCurrentParcel(parcel)
    }

    const step = (now) => {
      const delta = now - lastTime
      lastTime = now

      // Traverses the conveyor in ~5.5s
      progress += (delta / 5500) * 100

      // Stage 1: Approaching Scanner (0% - 40%)
      if (progress < 40) {
        setScannerPhaseText('Approaching Scanner')
        setIsScanning(false)
      }
      // Stage 2: Optical Laser Scanner Beam (40% - 58%)
      else if (progress >= 40 && progress < 58) {
        if (!hasScanned) {
          hasScanned = true
          setIsScanning(true)
          setScannerPhaseText('Scanning SKU...')
        }
      }
      // Stage 3: Verified, traveling to stock chute (58% - 90%)
      else if (progress >= 58 && progress < 90) {
        setIsScanning(false)
        setScannerPhaseText('Verified ➔ Stock Chute')
      }
      // Stage 4: Arrived into Stock Dock (90% - 100%)
      else if (progress >= 90 && !hasArrived) {
        hasArrived = true
        setScannerPhaseText('Stocking Rack')

        // Trigger temporary visual pulse & arrival indicator without corrupting catalog inventory counts
        const qtyAdded = parcel?.qty || 15
        setStockBump(true)
        setArrivalPopup({ qty: qtyAdded })
        setOrderActivityMessage(`PO #${parcel?.poNumber || 'MBM-849'} Inbound Scanned & Restocked`)

        setTimeout(() => {
          setStockBump(false)
          setArrivalPopup(null)
        }, 1500)
      }

      // Loop reset for next inbound package
      if (progress >= 100) {
        progress = 0
        hasScanned = false
        hasArrived = false
        parcel = getNextParcel()
        setCurrentParcel(parcel)

        // Replenishment trigger: maintain lively In Progress count
        setOrderStats((prev) => {
          if (prev.inProgress < 8) {
            return { ...prev, inProgress: prev.inProgress + 3 }
          }
          return prev
        })
      }

      setParcelProgress(progress)
      animFrameId = requestAnimationFrame(step)
    }

    animFrameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animFrameId)
  }, [getNextParcel])

  // Manual Trigger to immediately dispatch a parcel onto conveyor
  const handleManualIntake = () => {
    const next = getNextParcel()
    setCurrentParcel(next)
    setParcelProgress(0)
    setIsScanning(false)
    setScannerPhaseText('Intake Triggered')
    setOrderActivityMessage(`⚡ Inbound PO #${next.poNumber} Dispatched to Belt`)
    setOrderStats((prev) => ({ ...prev, inProgress: prev.inProgress + 1 }))
  }

  const handleStockInputChange = (rowId, val) => {
    setEditingStock((prev) => ({ ...prev, [rowId]: val }))
  }

  const handleStockCommit = (rowId, currentVal) => {
    const entered = editingStock[rowId]
    if (entered === undefined || entered === '' || isNaN(Number(entered))) {
      setEditingStock((prev) => {
        const next = { ...prev }
        delete next[rowId]
        return next
      })
      return
    }

    const targetVal = Math.max(0, parseInt(entered, 10))
    const delta = targetVal - Number(currentVal)

    if (delta !== 0 && adjustStock) {
      adjustStock(rowId, delta)
    }

    setEditingStock((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  return (
    <div className="vaultedge-page">
      {/* 1. VaultEdge Top Header */}
      <header className="vaultedge-header">
        <div className="vaultedge-title-wrap">
          <div className="vaultedge-brand-mark" title="VaultEdge System Mark"></div>
          <h1 className="vaultedge-title">Inventory</h1>
        </div>
      </header>

      {/* 2. Top Analytics Grid (Orders + Stock with Inbound Conveyor Belt) */}
      <section className="vaultedge-grid">
        {/* Card A: Orders (Deep Electric Indigo Gradient with Dynamic Simulation) */}
        <div className="card-orders">
          <div className="card-head">
            <div className="card-title-group">
              <h3>Orders</h3>
              <span className="orders-sim-tag">
                <span className="sim-pulse-dot violet"></span> Auto-Fulfillment
              </span>
            </div>
            <div className="card-head-actions">
              <span className="orders-sync-pill">
                {orderActivityMessage}
              </span>
            </div>
          </div>

          <div className="orders-metrics">
            <div className="metric-col">
              <div className="metric-num">{orderStats.overdue}</div>
              <div className="metric-lbl">Overdue</div>
              <div 
                className="metric-bar pattern-1" 
                style={{ height: `${getBarHeight(orderStats.overdue)}px` }}
                title={`Overdue: ${orderStats.overdue}`}
              ></div>
            </div>

            <div className="metric-col">
              <div className="metric-num">{orderStats.returns}</div>
              <div className="metric-lbl">Returns</div>
              <div 
                className="metric-bar pattern-2" 
                style={{ height: `${getBarHeight(orderStats.returns)}px` }}
                title={`Returns: ${orderStats.returns}`}
              ></div>
            </div>

            <div className="metric-col">
              <div className="metric-num">{orderStats.inProgress}</div>
              <div className="metric-lbl">In progress</div>
              <div 
                className="metric-bar pattern-3" 
                style={{ height: `${getBarHeight(orderStats.inProgress)}px` }}
                title={`In progress: ${orderStats.inProgress}`}
              ></div>
            </div>

            <div className="metric-col">
              <div className="metric-num">{orderStats.completed}</div>
              <div className="metric-lbl">Completed</div>
              <div 
                className="metric-bar solid" 
                style={{ height: `${getBarHeight(orderStats.completed)}px` }}
                title={`Completed: ${orderStats.completed}`}
              ></div>
            </div>
          </div>

          {/* Orders Pipeline Activity Bar at bottom */}
          <div className="orders-pipeline-footer">
            <div className="pipeline-flow-indicator">
              <span className="pipeline-dot"></span>
              <span className="pipeline-txt">
                Inbound Feed: <b>{currentParcel?.name || 'Power Bank 20000mAh'}</b> (PO #{currentParcel?.poNumber || 'MBM-849'}) moving to Conveyor Intake
              </span>
            </div>
          </div>
        </div>

        {/* Card B: Stock (Twilight Indigo to Magenta Gradient with Conveyor Belt Simulation) */}
        <div className="card-stock">
          <div className="card-head">
            <div className="card-title-group">
              <h3>Stock</h3>
              <span className="stock-sim-tag">
                <span className="sim-pulse-dot"></span> Inbound Active
              </span>
            </div>
            <div className="card-head-actions">
              <button
                type="button"
                className="btn-trigger-intake"
                onClick={handleManualIntake}
                title="Manually dispatch an incoming package to the conveyor belt"
              >
                ⚡ Inbound Box
              </button>
            </div>
          </div>

          {/* Stock Legend + Donut Chart matching reference */}
          <div className="stock-body">
            <div className="stock-legend">
              <div className="legend-item">
                <span className="legend-dot in-stock"></span>
                <span>In stock ({healthyCount})</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot out-stock"></span>
                <span>Out of stock ({outOfStockCount})</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot low-stock"></span>
                <span>Low stock ({lowStockCount})</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot dead-stock"></span>
                <span>Dead stock (0)</span>
              </div>
            </div>

            {/* Donut Chart with Centered Dynamic Total Badge */}
            <div className="stock-chart-wrap">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="rgba(0, 0, 0, 0.25)"
                  strokeWidth="5"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="5"
                  strokeDasharray={`${healthyPct}, 100`}
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#fb7185"
                  strokeWidth="5"
                  strokeDasharray={`${lowStockPct}, 100`}
                  strokeDashoffset={`-${healthyPct}`}
                />
              </svg>
              <div className={`stock-chart-badge ${stockBump ? 'bump-active' : ''}`}>
                {totalStockCount}
              </div>
            </div>
          </div>

          {/* Inbound Conveyor Belt Simulation */}
          <div className="conveyor-simulation-wrap">
            <div className="conveyor-meta-bar">
              <div className="conveyor-line-label">
                <span>🏭 CONVEYOR LINE 1</span>
                <span className="conveyor-sub-status">• {scannerPhaseText}</span>
              </div>
              <div className="conveyor-live-pill">
                <span className="pulse-green-dot"></span> LIVE BELT
              </div>
            </div>

            {/* Conveyor Belt Stage */}
            <div className="conveyor-stage">
              <div className="conveyor-rail-top"></div>
              <div className="conveyor-roller left"></div>

              {/* Moving Belt Surface */}
              <div className="conveyor-belt">
                <div className="conveyor-tread-stripes"></div>
              </div>

              {/* Optical Scanner Laser Gate */}
              <div className={`conveyor-scanner-gate ${isScanning ? 'laser-scanning' : ''}`}>
                <div className="scanner-arch-top">
                  <span className="scanner-eye">▲</span>
                </div>
                <div className="scanner-beam"></div>
              </div>

              {/* Warehouse Stock Bay on Right */}
              <div className="conveyor-intake-chute">
                <span className="chute-icon">📥</span>
                <span>STOCK RACK</span>
              </div>

              <div className="conveyor-rail-bottom"></div>

              {/* Active Moving Parcel */}
              {currentParcel && (
                <div
                  className="conveyor-parcel-box"
                  style={{ left: `${Math.min(84, parcelProgress * 0.84)}%` }}
                >
                  <div className="parcel-inner">
                    <span className="parcel-icon">📦</span>
                    <div className="parcel-text">
                      <span className="parcel-title">{currentParcel.name}</span>
                      <span className="parcel-tag">+{currentParcel.qty} pcs</span>
                    </div>
                  </div>
                  {isScanning && <div className="parcel-scan-tag">✓ VERIFIED</div>}
                </div>
              )}

              {/* Floating Restock Indicator on Arrival */}
              {arrivalPopup && (
                <div className="arrival-floating-toast">
                  +{arrivalPopup.qty} Units Inbound!
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Capsule Filter & Search Controls */}
      <div className="vaultedge-controls">
        <div className="capsule-search-box">
          <span className="search-glyph">🔍</span>
          <input
            type="text"
            className="capsule-input"
            placeholder="Search products by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="capsule-filter-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          className="capsule-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="warning">Low Stock</option>
          <option value="critical">Out of Stock</option>
          <option value="good">In Stock</option>
        </select>

        <button 
          type="button" 
          className="capsule-btn-add" 
          onClick={() => setShowAddModal(true)}
          title="Add New Product to Inventory"
        >
          +
        </button>
      </div>

      {/* 4. VaultEdge Enterprise Table */}
      <div className="vaultedge-table-container">
        <table className="vaultedge-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Supplier</th>
              <th>Category</th>
              <th>Cost</th>
              <th>On hand</th>
              <th>Previous order</th>
              <th style={{ width: '50px' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="inventory-empty">
                  No items match your search or filters.
                </td>
              </tr>
            ) : (
              filteredItems.map((row, idx) => {
                const rowId = row?.id || row?._id || row?.itemId || idx
                const itemName = getItemName(row?.itemName || row)
                const rawStatus = getRawStatus(row?.status)
                const status = getStockStatus(rawStatus)
                const stock = typeof row?.currentStock === 'number' ? row.currentStock : Number(row?.currentStock) || 0
                const unit = row?.unit || 'unit'
                const category = row?.category || 'Electronics'

                const details = getItemDetails(row, suppliers, actions)
                const inputValue = editingStock[rowId] !== undefined ? editingStock[rowId] : stock
                const isNearBottom = filteredItems.length > 2 && idx >= filteredItems.length - 2

                return (
                  <tr key={rowId}>
                    {/* Product Cell (Pure text, NO photos, NO SKU) */}
                    <td>
                      <div className="product-pure-wrap">
                        <div className="product-name-txt">{itemName}</div>
                      </div>
                    </td>

                    {/* Supplier (Includes ALL Suppliers with numbers 1, 2...) */}
                    <td>
                      <div className="supplier-names-stack">
                        {details.displaySuppliers.map((sup, sIdx) => (
                          <div key={sIdx} className="supplier-name-entry">
                            <span className="supplier-num-prefix">{sIdx + 1}.</span>
                            <span className="supplier-name-val">{sup}</span>
                          </div>
                        ))}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="inv-dim">
                      {category}
                    </td>

                    {/* Cost (Dynamic from DB / last purchased from supplier in INR) */}
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                      ₹{details.cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* On Hand (Quantity with Stepper) */}
                    <td>
                      <div className="stock-cell">
                        <button
                          type="button"
                          className="stock-btn"
                          onClick={() => adjustStock && adjustStock(rowId, -1)}
                          disabled={stock <= 0}
                          aria-label={`Decrease ${itemName} stock`}
                        >
                          −
                        </button>

                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            min="0"
                            value={inputValue}
                            className="stock-number-input"
                            onChange={(e) => handleStockInputChange(rowId, e.target.value)}
                            onBlur={() => handleStockCommit(rowId, stock)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur()
                              }
                            }}
                            style={{
                              width: '52px',
                              textAlign: 'center',
                              padding: '4px 6px',
                              fontSize: '0.88rem',
                              fontWeight: 700,
                              outline: 'none',
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          className="stock-btn"
                          onClick={() => adjustStock && adjustStock(rowId, 1)}
                          aria-label={`Increase ${itemName} stock`}
                        >
                          +
                        </button>
                      </div>
                    </td>

                    {/* Previous Order (Supplier only, NO units below) */}
                    <td>
                      <div className="prev-order-supplier">{details.prevOrder.supplier}</div>
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'center', position: 'relative' }}>
                      <div className="action-menu-wrap">
                        <button 
                          type="button" 
                          className={`action-menu-dots ${activeActionRowId === rowId ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveActionRowId((prev) => (prev === rowId ? null : rowId))
                          }}
                          title="Actions"
                          aria-label={`Actions for ${itemName}`}
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
                                setEditingItem(row)
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
                                if (window.confirm(`Are you sure you want to delete "${itemName}" from inventory?`)) {
                                  deleteInventoryItem && deleteInventoryItem(rowId, itemName)
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
        <AddItemModal onClose={() => setShowAddModal(false)} />
      )}

      {editingItem && (
        <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}