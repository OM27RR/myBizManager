import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { agentApi, approvalApi, authApi, dashboardApi, actionsApi, inventoryApi, supplierApi, googleAuthApi } from '../services/api.js'
import { formatRelativeTime } from '../utils/time.js'


const AppContext = createContext(null)

function getInitials(name) {
  if (!name || typeof name !== 'string') return 'SB'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

function toBusiness(owner) {
  if (!owner) return null
  return {
    ownerId: owner.owner_id || owner.id,
    name: owner.business_name || 'My Business',
    ownerName: owner.owner_name || 'Owner',
    initials: getInitials(owner.business_name || owner.owner_name),
    email: owner.email,
  }
}

function toInventoryShape(raw) {
  if (!raw || typeof raw !== 'object') return raw

  let itemName = 'Unknown Item'
  if (typeof raw.itemName === 'string') itemName = raw.itemName
  else if (typeof raw.item_name === 'string') itemName = raw.item_name
  else if (typeof raw.name === 'string') itemName = raw.name
  else if (typeof raw.itemName === 'object' && raw.itemName !== null) {
    itemName = raw.itemName.item_name || raw.itemName.itemName || raw.itemName.name || 'Unknown Item'
  }

  let status = 'In Stock'
  if (typeof raw.status === 'string') status = raw.status
  else if (typeof raw.status === 'object' && raw.status !== null) {
    status = raw.status.status || raw.status.label || 'In Stock'
  }

  let lastUpdated = '-'
  const rawDate = raw.lastUpdated || raw.last_updated || raw.updatedAt || raw.updated_at
  if (typeof rawDate === 'string') lastUpdated = rawDate
  else if (rawDate instanceof Date) lastUpdated = rawDate.toLocaleString()
  else if (typeof rawDate === 'object' && rawDate !== null) {
    lastUpdated = rawDate.last_updated || rawDate.updated_at || '-'
  }

  let unit = 'unit'
  if (typeof raw.unit === 'string') unit = raw.unit
  else if (typeof raw.unit === 'object' && raw.unit !== null) {
    unit = raw.unit.unit || 'unit'
  }

  const mlThreshold = Number(raw.mlThreshold ?? raw.lowStockThreshold ?? raw.low_stock_threshold ?? 10)
  const currentStock = Number(raw.currentStock ?? raw.current_stock ?? 0)

  // Derive status dynamically from ML predicted threshold
  if (currentStock <= 0) {
    status = 'Out of Stock'
  } else if (currentStock <= mlThreshold) {
    status = 'Low Stock'
  } else {
    status = 'In Stock'
  }

  return {
    ...raw,
    id: String(raw._id || raw.id || raw.itemId || raw.item_id || Math.random()),
    itemId: raw.item_id || raw.itemId || raw._id || raw.id,
    item_id: raw.item_id || raw.itemId || raw._id || raw.id,
    itemName,
    item_name: itemName,
    currentStock,
    current_stock: currentStock,
    lowStockThreshold: mlThreshold,
    low_stock_threshold: mlThreshold,
    mlThreshold,
    mlForecast: raw.mlForecast,
    status,
    lastUpdated,
    unit,
  }
}

function toAlertCardShape(raw, inventoryList = []) {
  const itemStr = typeof raw.item_name === 'object' && raw.item_name !== null
    ? (raw.item_name.item_name || raw.item_name.name || 'Unknown Item')
    : (raw.item_name || raw.itemName || 'Unknown Item')

  const unitStr = typeof raw.unit === 'string' ? raw.unit : 'unit'

  // Look up true stock from inventory if raw.current_stock is empty/null/undefined
  let resolvedStock = raw.current_stock ?? raw.currentStock
  if (resolvedStock === undefined || resolvedStock === null) {
    const invMatch = (inventoryList || []).find(
      (i) => (i.itemName && i.itemName.toLowerCase() === itemStr.toLowerCase()) || i.id === raw.item_id || i.itemId === raw.item_id
    )
    if (invMatch) {
      resolvedStock = invMatch.currentStock
    }
  }

  return {
    id: raw.action_id || raw._id || raw.id,
    action_id: raw.action_id || raw._id || raw.id,
    itemName: itemStr,
    item_name: itemStr,
    currentStock: Number(resolvedStock ?? 0),
    current_stock: Number(resolvedStock ?? 0),
    unit: unitStr,
    status: typeof raw.status === 'string' ? raw.status : 'Low Stock',
    recommendation: { text: raw.recommendation_text || '' },
    recommendation_text: raw.recommendation_text || '',
    predicted_quantity: raw.predicted_quantity ?? raw.recommended_qty,
    forecast_confidence: raw.forecast_confidence,
    is_irregular_demand: raw.is_irregular_demand,
    irregularity_reason: raw.irregularity_reason,
    demand_forecast: raw.demand_forecast,
    qty: raw.recommended_qty ?? raw.predicted_quantity ?? raw.qty,
    suggested_quantity: raw.recommended_qty ?? raw.predicted_quantity,
    suppliers: (raw.suppliers || []).map((s) => {
      let rawPrice = s.price ?? s.current_price ?? s.unit_price

      if (rawPrice === undefined || rawPrice === null) {
        const cat = s.catalog || s.item_catalog || []
        const matchedItem = cat.find(
          (c) =>
            (c.item_name && c.item_name.toLowerCase() === itemStr.toLowerCase()) ||
            (c.item_id && c.item_id === (raw.item_id || raw.itemId))
        )
        if (matchedItem) {
          rawPrice = matchedItem.price ?? matchedItem.current_price ?? matchedItem.unit_price
        }
      }

      let numericPrice = null
      if (typeof rawPrice === 'number') {
        numericPrice = rawPrice
      } else if (typeof rawPrice === 'string') {
        const parsed = parseFloat(rawPrice.replace(/[^0-9.]/g, ''))
        if (!isNaN(parsed)) numericPrice = parsed
      }

      const hasValidPrice = typeof numericPrice === 'number' && numericPrice > 0

      return {
        supplier_id: s.supplier_id || s._id,
        name: s.supplier_name || s.name,
        supplier_name: s.supplier_name || s.name,
        current_price: hasValidPrice ? numericPrice : null,
        price: hasValidPrice ? `₹${numericPrice}/${unitStr}` : 'Price on file soon',
        lead_time_days: s.lead_time_days || 2,
        reliability_score: s.reliability_score !== undefined ? s.reliability_score : 90,
        picked: !!s.is_chosen,
        is_chosen: !!s.is_chosen,
      }
    }),
  }
}

function toLogRowShape(action) {
  const itemStr = typeof action.item_name === 'object' && action.item_name !== null
    ? (action.item_name.item_name || action.item_name.name || 'Unknown Item')
    : (action.item_name || action.itemName || 'Unknown Item')

  const rawStatus = typeof action.status === 'string' ? action.status : 'pending'
  const supplierOutcome = typeof action.supplier_outcome === 'string' ? action.supplier_outcome : ''

  return {
    id: action._id || action.id,
    action_id: action._id || action.id || action.action_id,
    item: itemStr,
    item_name: itemStr,
    reason: typeof action.recommendation_text === 'string' ? action.recommendation_text : '',
    recommendation: typeof action.recommendation_text === 'string' ? action.recommendation_text : '',
    outcome_text: action.outcome_text || '',
    quantity: action.quantity || action.order_quantity || action.qty || 10,
    predicted_quantity: action.predicted_quantity,
    forecast_confidence: action.forecast_confidence,
    is_irregular_demand: action.is_irregular_demand,
    irregularity_reason: action.irregularity_reason,
    decision: rawStatus,
    status: rawStatus,
    supplier_outcome: supplierOutcome,
    supplier_name: action.selected_supplier_name || action.chosen_supplier || '',
    supplier_id: action.selected_supplier_id || action.recommended_supplier_id || '',
    rating: action.rating,
    rated_at: action.rated_at,
    shipment_status: action.shipment_status || (action.rating !== undefined && action.rating !== null ? (Number(action.rating) === 0 ? 'failed' : 'delivered') : 'pending'),
    po_tag: action.po_tag || '',
    when: formatRelativeTime(action.decided_at || action.triggered_at),
  }
}

export function AppProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [business, setBusiness] = useState(null)
  const [emailIntegration, setEmailIntegration] = useState({
    connected: false,
    email: null,
    loading: false,
  })

  const checkEmailStatus = useCallback(async () => {
    try {
      const res = await googleAuthApi.getStatus()
      setEmailIntegration({
        connected: !!res?.connected,
        email: res?.email || null,
        loading: false,
      })
      return res
    } catch {
      setEmailIntegration((prev) => ({ ...prev, loading: false }))
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    authApi
      .me()
      .then(({ owner }) => {
        if (cancelled) return
        setBusiness(toBusiness(owner))
        if (owner?.googleOAuth) {
          setEmailIntegration({
            connected: !!owner.googleOAuth.connected,
            email: owner.googleOAuth.email || null,
            loading: false,
          })
        }
        setIsAuthenticated(true)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])


  const [alerts, setAlerts] = useState([])
  const [actions, setActions] = useState([])
  const logs = actions.filter((a) => a.status !== 'pending').map(toLogRowShape)

  const [inventory, setInventory] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [dataLoading, setDataLoading] = useState(false)

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' })
  const toastTimer = useRef(null)

  const showToast = useCallback((message, type = 'info') => {
    clearTimeout(toastTimer.current)
    setToast({ visible: true, message, type })
    toastTimer.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }))
    }, 3500)
  }, [])

  const knownAlertIds = useRef(new Set())
  const inventoryRef = useRef(inventory)
  inventoryRef.current = inventory

  useEffect(() => {
    if (!isAuthenticated) {
      setInventory([])
      setSuppliers([])
      setAlerts([])
      setActions([])
      return
    }
    let cancelled = false
    setDataLoading(true)
    Promise.all([inventoryApi.list(), supplierApi.list(), dashboardApi.pendingAlerts(), actionsApi.list()])
      .then(([invRes, supRes, alertsRes, actionsRes]) => {
        if (cancelled) return
        const formattedInv = (invRes?.items || []).map(toInventoryShape)
        setInventory(formattedInv)
        setSuppliers(supRes?.suppliers || [])
        const initialAlerts = (alertsRes?.alerts || []).map((a) => toAlertCardShape(a, formattedInv))
        setAlerts(initialAlerts)
        knownAlertIds.current = new Set(initialAlerts.map((a) => String(a.id)))
        setActions(actionsRes?.actions || [])
      })
      .catch((err) => {
        if (!cancelled) showToast(err.message || 'Could not load your inventory/suppliers', 'error')
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, showToast])

  const refreshAgentActivity = useCallback(async (isPolling = false) => {
    const [alertsRes, actionsRes] = await Promise.all([dashboardApi.pendingAlerts(), actionsApi.list()])
    const nextAlerts = (alertsRes?.alerts || []).map((a) => toAlertCardShape(a, inventoryRef.current))

    // Only fire passive background toasts during interval polling, not during explicit simulation
    if (isPolling) {
      const newOnes = nextAlerts.filter((a) => !knownAlertIds.current.has(String(a.id)))
      if (knownAlertIds.current.size > 0 && newOnes.length > 0) {
        if (newOnes.length > 1) {
          showToast(`Detected stock alerts for ${newOnes.length} items`, 'warning')
        } else {
          const first = newOnes[0]
          const stock = Number(first.currentStock ?? first.current_stock ?? 0)
          if (stock < 10) {
            showToast(`Stockout Risk: ${first.itemName} (${stock} units left)`, 'error')
          } else if (stock < 15) {
            showToast(`Stock Warning: ${first.itemName} (${stock} units left)`, 'warning')
          } else {
            showToast(`New approval needed: ${first.itemName}`, 'info')
          }
        }
      }
    }

    knownAlertIds.current = new Set(nextAlerts.map((a) => String(a.id)))
    setAlerts(nextAlerts)
    setActions(actionsRes?.actions || [])
    return nextAlerts
  }, [showToast])

  useEffect(() => {
    if (!isAuthenticated) return
    const interval = setInterval(() => {
      refreshAgentActivity(true).catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [isAuthenticated, refreshAgentActivity])

  const login = useCallback(
    async (email, password) => {
      const { owner } = await authApi.login({ email, password })
      setBusiness(toBusiness(owner))
      setIsAuthenticated(true)
      showToast(`Logged in as ${owner.business_name}`, 'success')
    },
    [showToast]
  )

  const signup = useCallback(
    async ({ ownerName, businessName, email, password }) => {
      const { owner } = await authApi.signup({ ownerName, businessName, email, password })
      setBusiness(toBusiness(owner))
      setIsAuthenticated(true)
      showToast(`Welcome, ${owner.business_name}!`, 'success')
    },
    [showToast]
  )

  const logout = useCallback(() => {
    setIsAuthenticated(false)
    setBusiness(null)
    setInventory([])
    setSuppliers([])
    setAlerts([])
    setActions([])
    setEmailIntegration({ connected: false, email: null, loading: false })
    authApi.logout().catch(() => {})
  }, [])

  // Detect OAuth redirect from Google callback
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === 'true') {
      showToast('Gmail account connected! Autonomous orders will now be sent from your email.', 'success')
      checkEmailStatus()
      params.delete('google_connected')
      const nextUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '')
      window.history.replaceState({}, '', nextUrl)
    } else if (params.get('google_error')) {
      showToast(`Google connection failed: ${params.get('google_error')}`, 'error')
      params.delete('google_error')
      const nextUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '')
      window.history.replaceState({}, '', nextUrl)
    }
  }, [showToast, checkEmailStatus])

  const connectGoogleEmail = useCallback(async () => {
    try {
      setEmailIntegration((prev) => ({ ...prev, loading: true }))
      const res = await googleAuthApi.getUrl()
      if (res?.url) {
        window.location.href = res.url
      } else {
        throw new Error('Failed to obtain Google authorization URL')
      }
    } catch (err) {
      setEmailIntegration((prev) => ({ ...prev, loading: false }))
      showToast(err.message || 'Could not connect Google account', 'error')
    }
  }, [showToast])

  const disconnectGoogleEmail = useCallback(async () => {
    try {
      setEmailIntegration((prev) => ({ ...prev, loading: true }))
      await googleAuthApi.disconnect()
      setEmailIntegration({ connected: false, email: null, loading: false })
      showToast('Google account disconnected. Orders will now use system mailbox fallback.', 'info')
    } catch (err) {
      setEmailIntegration((prev) => ({ ...prev, loading: false }))
      showToast(err.message || 'Could not disconnect Google account', 'error')
    }
  }, [showToast])


  const resolveAlert = useCallback(
    async (id, decision, selectedSupplier = null) => {
      try {
        const supplierName = selectedSupplier?.supplier_name || selectedSupplier?.name
        await approvalApi.resolve(id, decision, selectedSupplier)
        await refreshAgentActivity(false)
        showToast(
          decision === 'approved'
            ? `Purchase order sent to ${supplierName || 'supplier'} ✓`
            : 'Recommendation rejected — logged for agent feedback',
          'success'
        )
      } catch (err) {
        showToast(err.message || 'Could not update that alert', 'error')
      }
    },
    [refreshAgentActivity, showToast]
  )

  const simulateDrop = useCallback(async () => {
    try {
      const res = await agentApi.simulate()
      const updatedAlerts = await refreshAgentActivity(false)

      const count =
        res?.count ??
        res?.actions?.length ??
        res?.action?.count ??
        res?.action?.actions?.length ??
        (updatedAlerts?.length || 0)

      if (count > 1) {
        showToast(`Detected stock alerts for ${count} items below threshold`, 'warning')
      } else if (count === 1) {
        const first = updatedAlerts?.[0] || res?.action
        const name = first?.itemName || first?.item_name || 'Item'
        const stock = first?.currentStock ?? first?.current_stock ?? 'low'
        showToast(`Stock Alert: ${name} (${stock} units left)`, 'warning')
      } else {
        showToast('No Stock Risk Currently: All inventory items are healthy.', 'success')
      }
      return res
    } catch (err) {
      showToast(err.message || 'Error checking stock risk', 'error')
      throw err
    }
  }, [refreshAgentActivity, showToast])

  const addInventoryItem = useCallback(
    async (item) => {
      const { item: created } = await inventoryApi.create(item)
      setInventory((prev) => [toInventoryShape(created), ...prev])
      showToast(`${created?.itemName || created?.item_name || 'Item'} added to inventory`, 'success')
    },
    [showToast]
  )

  const updateInventoryItem = useCallback(
    async (id, updatedData) => {
      try {
        const res = await inventoryApi.update(id, updatedData)
        const updatedItem = res?.item ? toInventoryShape(res.item) : { ...updatedData, id }
        setInventory((prev) =>
          prev.map((row) =>
            row.id === id || row._id === id || row.itemId === id || row.item_id === id
              ? { ...row, ...updatedItem }
              : row
          )
        )
        showToast(`${updatedItem.itemName || 'Item'} updated successfully ✓`, 'success')
        return updatedItem
      } catch (err) {
        showToast(err.message || 'Could not update that item', 'error')
        throw err
      }
    },
    [showToast]
  )

  const deleteInventoryItem = useCallback(
    async (id) => {
      try {
        const { item } = await inventoryApi.remove(id)
        setInventory((prev) =>
          prev.filter(
            (row) =>
              row.id !== id && row._id !== id && row.itemId !== id && row.item_id !== id
          )
        )
        showToast(`${item?.itemName || item?.item_name || 'Item'} removed from inventory`, 'info')
      } catch (err) {
        showToast(err.message || 'Could not delete that item', 'error')
      }
    },
    [showToast]
  )

  const adjustStock = useCallback(
    async (id, delta) => {
      // Optimistic update for instant responsiveness
      setInventory((prev) =>
        prev.map((row) => {
          if (row.id === id || row._id === id || row.itemId === id || row.item_id === id) {
            const current = Number(row.currentStock) || 0
            const nextStock = Math.max(0, current + Number(delta))
            const threshold = Number(row.lowStockThreshold ?? 10)
            const status = nextStock <= 0 ? 'Out of Stock' : (nextStock <= threshold ? 'Low Stock' : 'In Stock')
            return {
              ...row,
              currentStock: nextStock,
              current_stock: nextStock,
              status,
            }
          }
          return row
        })
      )
      try {
        const { item } = await inventoryApi.adjustStock(id, delta)
        if (item) {
          setInventory((prev) =>
            prev.map((row) =>
              row.id === id || row._id === id || row.itemId === id || row.item_id === id
                ? toInventoryShape(item)
                : row
            )
          )
        }
      } catch (err) {
        showToast(err.message || 'Could not update stock', 'error')
      }
    },
    [showToast]
  )

  const addSupplier = useCallback(
    async (supplier) => {
      const { supplier: created } = await supplierApi.create(supplier)
      setSuppliers((prev) => [created, ...prev])
      showToast(`${created.supplier_name || created.name} added to suppliers`, 'success')
    },
    [showToast]
  )

  const updateSupplier = useCallback(
    async (id, updatedData) => {
      try {
        const res = supplierApi.update ? await supplierApi.update(id, updatedData) : null
        const updatedSupplier = res?.supplier || { ...updatedData, _id: id }

        setSuppliers((prev) =>
          prev.map((s) => (s._id === id || s.id === id ? { ...s, ...updatedSupplier } : s))
        )
        showToast(`${updatedSupplier.supplier_name || updatedSupplier.name || 'Supplier'} updated successfully ✓`, 'success')
        return updatedSupplier
      } catch (err) {
        showToast(err.message || 'Could not update that supplier', 'error')
        throw err
      }
    },
    [showToast]
  )

  const deleteSupplier = useCallback(
    async (id) => {
      try {
        const { supplier } = await supplierApi.remove(id)
        setSuppliers((prev) => prev.filter((s) => s._id !== id))
        showToast(`${supplier?.supplier_name || supplier?.name || 'Supplier'} removed from suppliers`, 'info')
      } catch (err) {
        showToast(err.message || 'Could not delete that supplier', 'error')
      }
    },
    [showToast]
  )

  // ==================== 5-Star Supplier Rating System ====================
  const [activeRatingAction, setActiveRatingAction] = useState(null)
  const dismissedRatingActionIds = useRef(new Set())
  const activeRatingActionRef = useRef(activeRatingAction)
  activeRatingActionRef.current = activeRatingAction

  // Populate dismissed ids from sessionStorage so page reloads don't repeatedly prompt dismissed orders
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('dismissedRatingIds') || '[]')
      if (Array.isArray(stored)) {
        stored.forEach((id) => dismissedRatingActionIds.current.add(String(id)))
      }
    } catch {}
  }, [])

  const openRatingPrompt = useCallback((action) => {
    setActiveRatingAction(action)
  }, [])

  const closeRatingPrompt = useCallback((actionId = null) => {
    const currentAction = activeRatingActionRef.current
    const idsToDismiss = [
      actionId,
      currentAction?._id,
      currentAction?.id,
      currentAction?.action_id,
    ].filter(Boolean).map(String)

    idsToDismiss.forEach((id) => {
      dismissedRatingActionIds.current.add(id)
    })

    try {
      const stored = JSON.parse(sessionStorage.getItem('dismissedRatingIds') || '[]')
      const merged = Array.from(new Set([...stored, ...idsToDismiss]))
      sessionStorage.setItem('dismissedRatingIds', JSON.stringify(merged))
    } catch {}

    setActiveRatingAction(null)
  }, [])

  const rateAction = useCallback(
    async (actionId, rating, shipmentStatus = 'delivered') => {
      try {
        const res = await actionsApi.rate(actionId, rating, shipmentStatus)
        const updatedAction = res?.action
        const updatedSupplier = res?.supplier

        setActions((prev) =>
          prev.map((a) => {
            const id = a._id || a.id || a.action_id
            return id === actionId || (updatedAction?._id && id === updatedAction._id)
              ? { ...a, ...updatedAction, rating, shipment_status: shipmentStatus }
              : a
          })
        )

        if (updatedSupplier) {
          setSuppliers((prev) =>
            prev.map((s) => {
              const sId = s._id || s.id || s.supplier_id
              const targetId = updatedSupplier._id || updatedSupplier.id || updatedSupplier.supplier_id
              return sId === targetId || s.supplier_name === updatedSupplier.supplier_name
                ? { ...s, ...updatedSupplier }
                : s
            })
          )
        }

        showToast(
          `⭐ Rated ${rating} stars! ${updatedSupplier?.supplier_name || 'Supplier'} reliability updated to ${updatedSupplier?.reliability_score ?? 100}%`,
          'success'
        )
        closeRatingPrompt(actionId)
        return res
      } catch (err) {
        showToast(err.message || 'Could not submit rating', 'error')
        throw err
      }
    },
    [closeRatingPrompt, showToast]
  )

  const markShipment = useCallback(
    async (actionId, shipmentStatus, rating = null) => {
      try {
        const res = await actionsApi.setShipment(actionId, shipmentStatus, rating)
        const updatedAction = res?.action
        const updatedSupplier = res?.supplier

        setActions((prev) =>
          prev.map((a) => {
            const id = a._id || a.id || a.action_id
            return id === actionId || (updatedAction?._id && id === updatedAction._id)
              ? { ...a, ...updatedAction, shipment_status: shipmentStatus, ...(rating !== null ? { rating } : {}) }
              : a
          })
        )

        if (updatedSupplier) {
          setSuppliers((prev) =>
            prev.map((s) => {
              const sId = s._id || s.id || s.supplier_id
              const targetId = updatedSupplier._id || updatedSupplier.id || updatedSupplier.supplier_id
              return sId === targetId || s.supplier_name === updatedSupplier.supplier_name
                ? { ...s, ...updatedSupplier }
                : s
            })
          )
        }

        if (shipmentStatus === 'failed') {
          showToast(`✕ Shipment marked as failed. Recorded 0★ rating.`, 'error')
        } else if (rating !== null) {
          showToast(`✓ Shipment confirmed! Rated ${rating}★`, 'success')
        } else {
          showToast(`✓ Shipment marked as delivered`, 'success')
        }
        return res
      } catch (err) {
        showToast(err.message || 'Could not update shipment status', 'error')
        throw err
      }
    },
    [showToast]
  )

  const confirmAction = useCallback(
    async (actionId) => {
      try {
        const res = await actionsApi.confirm(actionId)
        const updatedAction = res?.action
        setActions((prev) =>
          prev.map((a) => {
            const id = a._id || a.id || a.action_id
            return id === actionId ? { ...a, ...updatedAction } : a
          })
        )
        showToast('Order confirmed! Shipment is now in transit 🚚', 'success')
        return res
      } catch (err) {
        showToast(err.message || 'Could not confirm that order', 'error')
        throw err
      }
    },
    [showToast]
  )

  const stats = {
    total: logs.length,
    approved: logs.filter((l) => l.decision === 'confirmed' || l.supplier_outcome === 'confirmed').length,
    rejected: logs.filter((l) => ['rejected', 'out_of_stock', 'timeout'].includes(l.decision) || ['rejected', 'out_of_stock', 'timeout', 'owner_rejected'].includes(l.supplier_outcome)).length,
    po_sent: logs.filter((l) => ['po_sent', 'approved'].includes(l.decision) || l.supplier_outcome === 'awaiting_reply').length,
  }

  const inventoryStats = {
    total: inventory.length,
    lowStock: inventory.filter((row) => String(row.status).toLowerCase() === 'low stock').length,
    outOfStock: inventory.filter((row) => String(row.status).toLowerCase() === 'out of stock').length,
    healthy: inventory.filter((row) => !['low stock', 'out of stock'].includes(String(row.status).toLowerCase())).length,
  }

  const value = {
    isAuthenticated,
    authLoading,
    business,
    login,
    signup,
    logout,
    alerts,
    logs,
    stats,
    resolveAlert,
    simulateDrop,
    inventory,
    inventoryStats,
    dataLoading,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    adjustStock,
    suppliers,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    toast,
    showToast,
    emailIntegration,
    connectGoogleEmail,
    disconnectGoogleEmail,
    checkEmailStatus,
    activeRatingAction,
    openRatingPrompt,
    closeRatingPrompt,
    rateAction,
    markShipment,
    confirmAction,
    refreshAgentActivity,
  }


  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within an AppProvider')
  return ctx
}