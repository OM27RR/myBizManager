# myBizManager — Autonomous AI Operations Agent for Retail

[![Smart India Hackathon 2026](https://img.shields.io/badge/SIH-2026-orange.svg)](https://sih.gov.in/)
[![Problem Statement](https://img.shields.io/badge/Problem%20Statement-SIH26199-blue.svg)](https://sih.gov.in/)
[![Theme](https://img.shields.io/badge/Theme-Tertiary%20Sectors%20%7C%20Retail-success.svg)](#)
[![Stack](https://img.shields.io/badge/Architecture-Decoupled%20Microservices-purple.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **myBizManager** is an **Autonomous AI Operations (AI Ops) Agent** designed to eliminate stockouts, automate vendor procurement, and safeguard business margins for India's 63+ million retail stores, pharmacies, and supermarkets.

---

## 📌 Problem Statement: SIH26199
* **Theme:** Technology ideas in tertiary sectors like Hospitality, Financial Services, Entertainment and **Retail**
* **Category:** Software
* **Sponsoring Body:** AICTE (All India Council for Technical Education)

In India, over **63 million retail and pharmacy businesses** lose an estimated **10% to 15% of annual revenue** to stockouts, delayed shipments, and single-supplier dependencies. Traditional inventory software is purely **passive**—it only records an out-of-stock event *after* the customer has already walked away.

**myBizManager** transforms inventory from passive bookkeeping into a **proactive, self-healing digital workforce**.

---

## 🏗️ System Architecture

```text
                               +-------------------------------------------------+
                               |         VaultEdge UI (React 18 + Vite)          |
                               |    Glassmorphic Telemetry & Real-Time Controls  |
                               +------------------------+------------------------+
                                                        |
                                                        | REST API / JSON
                                                        v
                               +-------------------------------------------------+
                               |           Backend API (Node.js + Express)       |
                               |  - JWT Auth  - Atomic Inventory Transactions    |
                               |  - Google OAuth 2.0 Gmail Dispatch Service      |
                               +------------+-----------------------+------------+
                                            |                       |
                           Mongoose / BSON  |                       | REST / MCP
                                            v                       v
                    +-------------------------------+   +-------------------------------+
                    |     MongoDB Persistence       |   |  FastAPI AI & ML Engine       |
                    |  - Inventories                |   |  - Time-Series Demand Forecast|
                    |  - Suppliers & Catalogs       |   |  - Pareto Multi-Factor Scorer |
                    |  - PO Audit Ledger (Actions)  |   |  - MCP Tool Server Layer      |
                    +-------------------------------+   +-------------------------------+
```

---

## ⚡ Key Technical Features

### 1. 📈 Time-Series Demand Forecasting
* Machine-learning consumption velocity model calculating moving averages, seasonal trends, and buffer margins.
* Recommends exact, data-backed reorder quantities—preventing both stockouts and working capital lockup.

### 2. ⚖️ Multi-Factor Supplier Trade-off Matrix
* Evaluates all registered suppliers along an objective **two-dimensional Pareto frontier**:
  * **Factor 1: Capital Efficiency** — Wholesale unit price in Indian Rupees (₹) and bulk purchase savings.
  * **Factor 2: Operational Reliability** — Historical delivery fulfillment rate (%) and lead time in days.

### 3. 🔌 Model Context Protocol (MCP) Server Architecture
* Decouples AI reasoning from database internals using the global **Model Context Protocol (MCP)** standard.
* Exposes sandboxed, schema-validated tool definitions for safe inventory inspection and atomic updates directly to **MongoDB**.

### 4. 🔄 Autonomous Failover Cascading (Self-Healing Looping)
* **The Problem:** In conventional retail, a supplier cancellation halts business and leaves shelves empty.
* **The Solution:** If Supplier A declines or experiences factory stockouts, the agent **autonomously loops back**, re-ranks the vendor pool, selects **Supplier B**, generates a revised PO with Supplier B's rates, and dispatches it with **zero human intervention**.

### 5. 📧 Authentic PO Dispatch via Google OAuth 2.0
* Compiles official, itemized Purchase Orders complete with cryptographic tracking numbers and delivery terms.
* Transmits orders straight to the vendor's inbox via authenticated **Google Gmail API**.

### 6. ⭐ Reinforced Closed-Loop Feedback Loop
* Merchants submit a 5-star performance rating when shipments arrive.
* Ratings dynamically update future AI scoring weights—rewarding reliable suppliers and demoting chronically delayed vendors.

---

## 🛠️ Tech Stack & Directory Structure

| Module | Technologies | Description |
| :--- | :--- | :--- |
| **`stockwatch-frontend/`** | React 18, Vite, React Router 6 | Responsive VaultEdge glassmorphic dashboard |
| **`backend-node/`** | Node.js, Express, MongoDB (Mongoose) | REST API, Auth, MongoDB CRUD, Gmail OAuth2 |
| **`ai_final_fastapi/`** | Python 3.11+, FastAPI, Uvicorn | Time-series forecasting & MCP tool servers |

```text
myBizManager/
├── backend-node/               # Express + MongoDB API Server (Port 5050)
│   ├── routes/                 # Auth, inventory, supplier, PO action routes
│   ├── services/               # Inventory math, mail service, PO lifecycle
│   ├── models/                 # Mongoose schemas (User, Inventory, Supplier, Action)
│   └── database/               # MongoDB connection client
│
├── stockwatch-frontend/        # React + Vite Frontend (Port 5173)
│   ├── src/
│   │   ├── pages/              # LandingPage, Dashboard, Inventory, Suppliers, Actions
│   │   ├── components/         # AlertCard, Sidebar, AddItemModal, Toast
│   │   ├── context/            # AppContext (Optimistic UI & state management)
│   │   └── styles/             # VaultEdge glassmorphic theme
│
└── ai_final_fastapi/           # Python FastAPI AI Engine (Port 8000)
    ├── forecasting/            # Demand forecasting ML logic
    ├── agents/                 # Multi-attribute supplier selection agent
    ├── mcp_service/            # Model Context Protocol database tools
    └── main.py                 # FastAPI application routes
```

---

## 🚀 Quickstart & Installation

### Prerequisites
* **Node.js** (v18+)
* **Python** (v3.11+)
* **MongoDB** (Local instance or MongoDB Atlas URI)

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/OM27RR/myBizManager.git
cd myBizManager
```

---

### Step 2: Set Up Backend (Node.js + Express)
```bash
cd backend-node
npm install

# Configure environment variables (.env)
PORT=5050
MONGODB_URI=mongodb://localhost:27017/mybizmanager
JWT_SECRET=your_jwt_secret_key

npm run dev
```
*Backend runs on `http://localhost:5050`*

---

### Step 3: Set Up AI Engine (Python FastAPI)
```bash
cd ../ai_final_fastapi

# Create & activate virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
*FastAPI server runs on `http://127.0.0.1:8000` (Docs at `/docs`)*

---

### Step 4: Set Up Frontend (React + Vite)
```bash
cd ../stockwatch-frontend
npm install
npm run dev
```
*Frontend opens at `http://localhost:5173`*

---

## 🇮🇳 Impact for Atmanirbhar Bharat
By providing local Kirana stores, pharmacies, and MSMEs with the same autonomous supply-chain intelligence used by Fortune 500 retailers, **myBizManager** protects small business margins, prevents supply chain breakdowns, and powers the digital transformation of India's retail backbone.

---

## 👥 Contributors & Team
* **Team:** Smart India Hackathon 2026 Team
* **Repository:** [https://github.com/OM27RR/myBizManager](https://github.com/OM27RR/myBizManager)
* **License:** [MIT License](LICENSE)
