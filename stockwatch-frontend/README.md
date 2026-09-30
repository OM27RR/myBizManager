# myBizManager — Frontend

React + Vite frontend for the myBizManager inventory ops-agent (the "Local Business Workflow
Agent" problem statement). This covers the **frontend only** and currently runs on mock data,
so you can build, demo, and test the UI independently of the FastAPI / LangGraph backend.

## Getting started

```bash
npm install
npm run dev
```

Open the local URL Vite prints. On the login form, any email/password works — auth is a
prototype stand-in until the real backend is wired up.

## Folder structure

```
src/
├── main.jsx                 React root: router + global context + global styles
├── App.jsx                  Route table
│
├── styles/                  Global design system (imported once, not per component)
│   ├── variables.css          color & spacing custom properties
│   ├── base.css                resets, shared buttons, shared keyframes
│   ├── shared-ui.css            "alert" visual pieces reused on both the Home
│   │                             hero mockup and the real Dashboard cards
│   │                             (ticket stub, recommendation box, supplier chips)
│   └── page.css                  chrome shared by the logged-in pages
│                                  (page header, empty state, stat boxes)
│
├── context/
│   └── AppContext.jsx        Single source of truth: auth state, pending alerts,
│                              action-log history, toast. This is the frontend
│                              stand-in for the backend's `agent_actions` collection —
│                              swap the setState calls here for real API calls once
│                              /dashboard/alerts, /approve/{id}, /reject/{id} exist.
│
├── data/
│   └── mockData.js           Seed data (alerts, log history, domains, steps)
│
├── layouts/
│   └── AppLayout.jsx         Sidebar + <Outlet/> shell for everything under /app
│
├── components/               Small, reusable pieces
│   ├── ProtectedRoute.jsx      redirects to /auth if not logged in
│   ├── Sidebar.jsx / .css
│   ├── PublicNavbar.jsx / .css
│   ├── AlertCard.jsx / .css    one pending-alert card on the Dashboard
│   ├── EmptyState.jsx
│   ├── StatCard.jsx
│   ├── LogTable.jsx / .css
│   └── Toast.jsx / .css
│
└── pages/                    One file per route
    ├── Home.jsx / .css         public landing page
    ├── Auth.jsx / .css         login / signup (tabs)
    ├── Dashboard.jsx            pending alerts (uses AlertCard)
    └── ActionLog.jsx            history + stats (uses LogTable)
```

**Why this split:** `styles/` holds anything shared across more than one page or component, so a
color or spacing tweak happens once. `components/` holds pieces used by more than one page or
repeated in a list. `pages/` holds one file per route, composed from those components. `context/`
and `data/` are the two places you'd touch to wire up a real backend — everything else just
renders what they hand it.

## Routes

| Path | Page | Notes |
|---|---|---|
| `/` | Home | Public landing page |
| `/auth?tab=login\|signup` | Auth | Demo auth — any input works |
| `/app/dashboard` | Dashboard | Protected — pending alerts, Approve/Reject, "Simulate Stock Drop" |
| `/app/log` | Action Log | Protected — full history + live stats |

## Demo data notes

- The mock inventory and supplier records in `data/mockData.js` mirror the current sample data model.
  The supplied sample has an empty `agent_actions` collection, so the Action Log starts empty.
- "Simulate Stock Drop" on the Dashboard adds a new sample-style stock-risk alert so you can demo the
  approve/reject flow without waiting on real inventory data.

## Wiring up the real backend

Per the architecture doc, the natural integration points are:

- `AppContext.jsx` → replace the `alerts`/`logs` state and the `resolveAlert`/`simulateDrop`
  functions with calls to `GET /dashboard/alerts`, `POST /approve/{id}`, `POST /reject/{id}`.
- A WebSocket/SSE client (e.g. in a new `src/services/` folder) can push live "agent is
  reasoning..." status updates into the same context for the Dashboard to render.
