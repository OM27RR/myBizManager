// Thin fetch wrapper for backend-node.
//
// Auth is cookie-based (httpOnly `token` cookie set by the server — see
// backend-node/routes/auth.js), so every request must send
// `credentials: 'include'` and the server's CORS config must allow it
// (it does, via CLIENT_URL in backend-node/.env). There is no token to
// store in JS; the browser handles the cookie automatically.

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050/api'
const TOKEN_KEY = 'mybiz_auth_token'

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // Ignore localStorage errors
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {}
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new Error('Could not reach the server. Is the backend running?')
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    // No JSON body (e.g. a 204 from /logout on some setups) — fine.
  }

  if (!res.ok) {
    // backend-node's error middleware always responds { status: 'error', message }
    throw new Error(data?.message || `Request failed (${res.status})`)
  }

  return data
}

export const authApi = {
  // Matches routes/auth.js: POST /api/auth/signup { owner_name, business_name, email, password }
  signup: async ({ ownerName, businessName, email, password }) => {
    const data = await request('/auth/signup', {
      method: 'POST',
      body: { owner_name: ownerName, business_name: businessName, email, password },
    })
    if (data?.token) {
      setAuthToken(data.token)
    }
    return data
  },

  // POST /api/auth/login { email, password }
  login: async ({ email, password }) => {
    const data = await request('/auth/login', { method: 'POST', body: { email, password } })
    if (data?.token) {
      setAuthToken(data.token)
    }
    return data
  },

  // POST /api/auth/logout — clears the cookie server-side
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' })
    } finally {
      setAuthToken(null)
    }
  },

  // GET /api/auth/me — used on app load to check for an existing session
  me: () => request('/auth/me'),
}

// Google Cloud OAuth 2.0 (Gmail API per-user email integration)
export const googleAuthApi = {
  getUrl: () => request('/auth/google/url'),
  getStatus: () => request('/auth/google/status'),
  disconnect: () => request('/auth/google/disconnect', { method: 'POST' }),
}


// Matches routes/inventory.js. Every request rides the auth cookie, and the
// backend scopes every query to req.ownerId — there's no ownerId to pass
// from here, and no way for the client to ask for another owner's data.
export const inventoryApi = {
  list: () => request('/inventory'),
  create: (payload) => request('/inventory', { method: 'POST', body: payload }),
  update: (itemId, payload) => request(`/inventory/${itemId}`, { method: 'PUT', body: payload }),
  adjustStock: (itemId, delta) =>
    request(`/inventory/${itemId}/stock`, { method: 'PATCH', body: { delta } }),
  remove: (itemId) => request(`/inventory/${itemId}`, { method: 'DELETE' }),
}

// Matches routes/suppliers.js — same owner-scoping note as inventoryApi.
export const supplierApi = {
  list: () => request('/suppliers'),
  create: (payload) => request('/suppliers', { method: 'POST', body: payload }),
  update: (supplierId, payload) =>
    request(`/suppliers/${supplierId}`, { method: 'PUT', body: payload }),
  remove: (supplierId) => request(`/suppliers/${supplierId}`, { method: 'DELETE' }),
}

// Matches routes/dashboard.js. Already joins the pending AgentAction docs
// with live inventory + supplier data server-side, so this is the
// ready-to-render shape for the Dashboard's alert cards.
export const dashboardApi = {
  pendingAlerts: () => request('/dashboard/pending-alerts'),
}

// Matches routes/agent.js. item_name is optional — omit it to let the
// backend auto-pick a real at-risk item (see agent.service.js), which is
// what the "+ Simulate Stock Drop" button does.
export const agentApi = {
  simulate: (itemName) =>
    request('/agent/simulate', { method: 'POST', body: itemName ? { item_name: itemName } : {} }),
}

// Matches routes/approvals.js — powers AlertCard's Approve/Reject buttons with dynamic supplier selection.
export const approvalApi = {
  resolve: (actionId, decision, selectedSupplierOrReason) => {
    const payload = { decision }

    if (decision === 'rejected') {
      payload.rejection_reason =
        typeof selectedSupplierOrReason === 'string'
          ? selectedSupplierOrReason
          : selectedSupplierOrReason?.reason || selectedSupplierOrReason?.rejection_reason
    } else if (selectedSupplierOrReason) {
      // Extract supplier identifiers defensively across schemas
      const supplierId =
        selectedSupplierOrReason.supplier_id ||
        selectedSupplierOrReason._id ||
        selectedSupplierOrReason.id

      const supplierName =
        selectedSupplierOrReason.supplier_name ||
        selectedSupplierOrReason.name

      payload.supplier_id = supplierId ? String(supplierId) : undefined
      payload.selected_supplier_id = supplierId ? String(supplierId) : undefined
      payload.supplier_name = supplierName
      payload.selected_supplier = selectedSupplierOrReason

      const resolvedQty =
        selectedSupplierOrReason.order_qty ||
        selectedSupplierOrReason.quantity ||
        selectedSupplierOrReason.qty

      if (resolvedQty !== undefined) {
        payload.order_qty = Number(resolvedQty)
        payload.quantity = Number(resolvedQty)
        payload.qty = Number(resolvedQty)
      }
    }

    console.log(`[API approvalApi.resolve] POST /approvals/${actionId}`, payload)

    return request(`/approvals/${actionId}`, {
      method: 'POST',
      body: payload,
    })
  },
}

// Matches routes/actions.js — full per-owner AgentAction history, used to
// build the Action Log page.
export const actionsApi = {
  list: () => request('/actions'),
  rate: (actionId, rating, shipmentStatus = null) =>
    request(`/actions/${actionId}/rate`, { method: 'POST', body: { rating, shipment_status: shipmentStatus } }),
  setShipment: (actionId, shipmentStatus, rating = null) =>
    request(`/actions/${actionId}/shipment`, { method: 'POST', body: { status: shipmentStatus, rating } }),
  confirm: (actionId) => request(`/actions/${actionId}/confirm`, { method: 'POST' }),
  remove: (actionId) => request(`/actions/${actionId}`, { method: 'DELETE' }),
  clearAll: () => request('/actions', { method: 'DELETE' }),
}

// Matches routes/notifications.js — procurement email trail (PO sent, replies).
export const notificationApi = {
  list: () => request('/notifications'),
  remove: (notificationId) => request(`/notifications/${notificationId}`, { method: 'DELETE' }),
  clearAll: () => request('/notifications', { method: 'DELETE' }),
  keepLast: (count = 10) => request(`/notifications/trim?keep=${count}`, { method: 'DELETE' }),
  structureReply: (notificationId, userPrompt) =>
    request(`/notifications/${notificationId}/structure-reply`, {
      method: 'POST',
      body: { userPrompt },
    }),
  sendCustomReply: (notificationId, { structuredBody, userPrompt }) =>
    request(`/notifications/${notificationId}/send-custom-reply`, {
      method: 'POST',
      body: { structuredBody, userPrompt },
    }),
}