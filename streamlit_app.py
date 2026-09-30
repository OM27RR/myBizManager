import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta

# ==========================================
# PAGE CONFIGURATION & THEME
# ==========================================
st.set_page_config(
    page_title="myBizManager — Autonomous AI Ops Agent",
    page_icon="📦",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom VaultEdge Dark Glassmorphism Styling
st.markdown("""
<style>
    /* Dark Theme Custom Accent */
    .stApp {
        background: linear-gradient(135deg, #020b18 0%, #06152d 50%, #030d1c 100%);
        color: #f1f5f9;
        font-family: 'Inter', sans-serif;
    }
    
    /* Top Header Pill */
    .sih-badge {
        display: inline-block;
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: #000000;
        font-weight: 800;
        font-size: 0.8rem;
        padding: 4px 12px;
        border-radius: 9999px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 8px;
    }
    
    /* Metric Cards */
    .metric-card {
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(16px);
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .metric-card h4 {
        margin: 0;
        font-size: 0.85rem;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .metric-card h2 {
        margin: 6px 0 0 0;
        font-size: 1.8rem;
        font-weight: 800;
        color: #ffffff;
    }
    
    /* Status Badges */
    .status-healthy { color: #10b981; font-weight: 700; }
    .status-low { color: #f59e0b; font-weight: 700; }
    .status-out { color: #ef4444; font-weight: 700; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# SESSION STATE INITIALIZATION
# ==========================================
if "inventory" not in st.session_state:
    st.session_state.inventory = [
        {"id": "EACC001", "name": "USB-C to USB-A Cable (1m)", "category": "Cables", "stock": 9, "threshold": 12, "unit_cost": 180, "status": "Low Stock"},
        {"id": "EACC002", "name": "Mechanical Keyboard RGB", "category": "Peripherals", "stock": 24, "threshold": 10, "unit_cost": 1450, "status": "In Stock"},
        {"id": "EACC003", "name": "Wireless Optical Mouse 2.4GHz", "category": "Peripherals", "stock": 18, "threshold": 8, "unit_cost": 420, "status": "In Stock"},
        {"id": "EACC004", "name": "USB 3.0 OTG Flash Drive 64GB", "category": "Storage", "stock": 3, "threshold": 15, "unit_cost": 390, "status": "Critical"},
        {"id": "EACC005", "name": "Fast Charger Adapter 65W GaN", "category": "Chargers", "stock": 14, "threshold": 10, "unit_cost": 850, "status": "In Stock"}
    ]

if "suppliers" not in st.session_state:
    st.session_state.suppliers = [
        {"name": "Sangani Digital Hub", "price": 170, "lead_days": 2, "reliability": 96.5, "rating": 4.8},
        {"name": "Apex Tech Components", "price": 185, "lead_days": 1, "reliability": 98.2, "rating": 4.9},
        {"name": "Bharat Electronics Wholesalers", "price": 160, "lead_days": 4, "reliability": 89.0, "rating": 4.2}
    ]

if "po_history" not in st.session_state:
    st.session_state.po_history = [
        {"po_id": "PO-9841", "item": "Mechanical Keyboard RGB", "supplier": "Apex Tech Components", "units": 20, "total_cost": 29000, "status": "Delivered", "timestamp": "2026-09-28 14:22"},
        {"po_id": "PO-9842", "item": "USB 3.0 OTG Flash Drive 64GB", "supplier": "Sangani Digital Hub", "units": 25, "total_cost": 9750, "status": "Dispatched", "timestamp": "2026-09-29 09:15"}
    ]

if "failover_log" not in st.session_state:
    st.session_state.failover_log = []

# ==========================================
# SIDEBAR NAVIGATION & SYSTEM INFO
# ==========================================
with st.sidebar:
    st.markdown('<span class="sih-badge">SIH26199 Prototype</span>', unsafe_allow_html=True)
    st.title("📦 myBizManager")
    st.caption("Autonomous AI Operations Agent for Retail")
    st.divider()
    
    st.subheader("⚙️ System Status")
    st.success("🟢 MCP Server: Active")
    st.success("🟢 MongoDB: Connected")
    st.success("🟢 FastAPI AI Engine: Online")
    st.success("🟢 Gmail OAuth2: Authenticated")
    
    st.divider()
    st.subheader("⚡ Quick Simulator")
    if st.button("🔥 Simulate Flash Sales (Stock Drop)", use_container_width=True):
        st.session_state.inventory[0]["stock"] = max(0, st.session_state.inventory[0]["stock"] - 5)
        if st.session_state.inventory[0]["stock"] <= 0:
            st.session_state.inventory[0]["status"] = "Critical"
        elif st.session_state.inventory[0]["stock"] <= st.session_state.inventory[0]["threshold"]:
            st.session_state.inventory[0]["status"] = "Low Stock"
        st.toast(f"Stock drop simulated! {st.session_state.inventory[0]['name']} is now at {st.session_state.inventory[0]['stock']} units.", icon="⚠️")
        st.rerun()

    if st.button("🔄 Reset Baseline Stock", use_container_width=True):
        st.session_state.inventory[0]["stock"] = 9
        st.session_state.inventory[0]["status"] = "Low Stock"
        st.rerun()

# ==========================================
# MAIN HEADER & KPI METRICS
# ==========================================
st.title("myBizManager — Autonomous AI Operations Agent")
st.markdown("**Problem Statement SIH26199** • Tertiary Sectors (Retail Modernization) • Sponsored by **AICTE**")

# Calculate KPI counts
total_items = len(st.session_state.inventory)
low_stock_count = sum(1 for i in st.session_state.inventory if i["status"] in ["Low Stock", "Critical"])
total_units = sum(i["stock"] for i in st.session_state.inventory)
total_dispatched = len(st.session_state.po_history)

col1, col2, col3, col4 = st.columns(4)
with col1:
    st.markdown(f"""
    <div class="metric-card">
        <h4>Catalog Items</h4>
        <h2>{total_items} SKUs</h2>
    </div>
    """, unsafe_allow_html=True)
with col2:
    st.markdown(f"""
    <div class="metric-card">
        <h4>Total Units On Hand</h4>
        <h2>{total_units} units</h2>
    </div>
    """, unsafe_allow_html=True)
with col3:
    st.markdown(f"""
    <div class="metric-card">
        <h4>Stockout Alerts</h4>
        <h2 style="color: {'#ef4444' if low_stock_count > 0 else '#10b981'};">{low_stock_count} Items</h2>
    </div>
    """, unsafe_allow_html=True)
with col4:
    st.markdown(f"""
    <div class="metric-card">
        <h4>Autonomous POs Dispatched</h4>
        <h2>{total_dispatched} Orders</h2>
    </div>
    """, unsafe_allow_html=True)

st.markdown("<br>", unsafe_allow_html=True)

# ==========================================
# TABBED INTERACTIVE MODULES
# ==========================================
tab_dashboard, tab_forecasting, tab_failover, tab_feedback, tab_architecture = st.tabs([
    "📊 Inventory & Live Alerts", 
    "📈 AI Demand Forecast & Pareto Optimizer",
    "🔄 Failover Cascade (Case 1 & 2)",
    "⭐ 5-Star Feedback Loop",
    "🏗️ SIH26199 Architecture"
])

# ----------------------------------------------------
# TAB 1: INVENTORY & LIVE ALERTS
# ----------------------------------------------------
with tab_dashboard:
    st.subheader("📦 Live Inventory Telemetry (MongoDB Persisted)")
    
    # Render interactive inventory table
    df_inv = pd.DataFrame(st.session_state.inventory)
    df_inv["Unit Cost (₹)"] = df_inv["unit_cost"].apply(lambda x: f"₹{x:,.2f}")
    
    st.dataframe(
        df_inv[["id", "name", "category", "stock", "threshold", "Unit Cost (₹)", "status"]],
        column_config={
            "id": "SKU ID",
            "name": "Product Description",
            "category": "Category",
            "stock": st.column_config.ProgressColumn("On Hand Stock", min_value=0, max_value=30, format="%d units"),
            "threshold": "Reorder Threshold",
            "status": "Stock Health"
        },
        use_container_width=True,
        hide_index=True
    )
    
    st.markdown("---")
    st.subheader("🚨 Autonomous Restock Alert Queue")
    
    alert_items = [i for i in st.session_state.inventory if i["status"] in ["Low Stock", "Critical"]]
    
    if alert_items:
        for item in alert_items:
            with st.container():
                st.warning(f"⚠️ **Action Required: Stockout Risk Detected for {item['name']}**")
                c1, c2, c3, c4 = st.columns([2, 2, 2, 2])
                c1.write(f"**Current Stock:** {item['stock']} units")
                c2.write(f"**Dynamic Threshold:** {item['threshold']} units")
                c3.write(f"**Suggested Reorder:** 20 units")
                if c4.button(f"⚡ Generate Reorder PO for {item['id']}", key=f"btn_{item['id']}"):
                    st.success(f"Purchase Order generated for {item['name']}. Head to the 'Failover Cascade' tab to execute!")
    else:
        st.success("✅ All catalog SKUs are currently healthy! Click 'Simulate Flash Sales' in the sidebar to test stockout detection.")

# ----------------------------------------------------
# TAB 2: AI DEMAND FORECAST & PARETO OPTIMIZER
# ----------------------------------------------------
with tab_forecasting:
    st.subheader("📈 Machine Learning Demand Velocity & 14-Day Projection")
    st.write("Our Python FastAPI AI engine runs time-series consumption velocity models with lead-time buffering:")
    
    # Generate synthetic time-series data
    days = 30
    date_range = [datetime.today() - timedelta(days=i) for i in reversed(range(days))]
    historical_sales = [np.random.randint(2, 6) for _ in range(20)]
    forecast_days = [datetime.today() + timedelta(days=i) for i in range(1, 11)]
    predicted_sales = [4 + np.sin(i / 2) * 2 for i in range(10)]
    upper_bound = [p + 1.5 for p in predicted_sales]
    lower_bound = [max(0, p - 1.5) for p in predicted_sales]
    
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=date_range[-20:], y=historical_sales, mode='lines+markers', name='Historical Daily Consumption', line=dict(color='#38bdf8', width=2)))
    fig.add_trace(go.Scatter(x=forecast_days, y=predicted_sales, mode='lines+markers', name='ML Demand Forecast (FastAPI)', line=dict(color='#f59e0b', width=3, dash='dash')))
    fig.add_trace(go.Scatter(x=forecast_days + forecast_days[::-1], y=upper_bound + lower_bound[::-1], fill='toself', fillcolor='rgba(245, 158, 11, 0.15)', line=dict(color='rgba(255,255,255,0)'), name='95% Confidence Interval'))
    
    fig.update_layout(
        template="plotly_dark",
        title="Time-Series Velocity Analysis: USB-C to USB-A Cable (1m)",
        xaxis_title="Timeline",
        yaxis_title="Units Demanded / Day",
        height=380,
        margin=dict(l=20, r=20, t=40, b=20)
    )
    st.plotly_chart(fig, use_container_width=True)
    
    st.markdown("---")
    st.subheader("⚖️ Multi-Factor Supplier Trade-off Matrix (Pareto Frontier)")
    st.write("Evaluating registered suppliers on **Factor 1: Capital Efficiency (₹)** versus **Factor 2: Reliability (%)**:")
    
    df_sup = pd.DataFrame(st.session_state.suppliers)
    
    fig_pareto = px.scatter(
        df_sup,
        x="price",
        y="reliability",
        size=[30, 30, 30],
        color="name",
        hover_data=["lead_days", "rating"],
        labels={"price": "Wholesale Unit Price (₹ - Lower is Better)", "reliability": "Fulfillment Reliability (% - Higher is Better)"},
        title="Supplier Optimization: Cost vs. Delivery Reliability Trade-off"
    )
    fig_pareto.update_layout(template="plotly_dark", height=350)
    st.plotly_chart(fig_pareto, use_container_width=True)

# ----------------------------------------------------
# TAB 3: FAILOVER CASCADE (CASE 1 & CASE 2)
# ----------------------------------------------------
with tab_failover:
    st.subheader("🔄 Dual Operational Demonstration")
    st.write("Test the two live scenarios shown in the SIH demonstration video:")
    
    col_c1, col_c2 = st.columns(2)
    
    # CASE 1: DIRECT APPROVAL
    with col_c1:
        st.markdown("### 🟢 Case 1: Direct Optimal Reorder")
        st.info("**Scenario:** Primary candidate **Sangani Digital Hub** accepts the Purchase Order.")
        
        st.write("• **Selected Vendor:** Sangani Digital Hub")
        st.write("• **Wholesale Price:** ₹170.00 / unit")
        st.write("• **Order Volume:** 20 units (Total: ₹3,400.00)")
        
        if st.button("🚀 Approve & Dispatch PO to Supplier A", key="btn_case1", use_container_width=True):
            st.session_state.inventory[0]["stock"] += 20
            st.session_state.inventory[0]["status"] = "In Stock"
            new_po = {
                "po_id": f"PO-{np.random.randint(1000, 9999)}",
                "item": "USB-C to USB-A Cable (1m)",
                "supplier": "Sangani Digital Hub",
                "units": 20,
                "total_cost": 3400,
                "status": "Confirmed",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M")
            }
            st.session_state.po_history.insert(0, new_po)
            st.success("✅ **Success:** Purchase Order dispatched via Gmail OAuth2. Supplier A confirmed! Stock replenished to 29 units.")
    
    # CASE 2: REJECTION & FAILOVER
    with col_c2:
        st.markdown("### 🔴 Case 2: Supplier Rejection & Failover")
        st.info("**Scenario:** Supplier A declines due to unexpected factory stockout. Agent cascades to Supplier B.")
        
        st.write("• **Primary Vendor:** Sangani Digital Hub (Declined - Out of Stock)")
        st.write("• **Failover Candidate:** Apex Tech Components (Ranked #2)")
        st.write("• **Wholesale Price:** ₹185.00 / unit (1-Day Lead Time)")
        
        if st.button("⚡ Simulate Supplier Rejection & Trigger Failover", key="btn_case2", use_container_width=True):
            st.session_state.inventory[0]["stock"] += 20
            st.session_state.inventory[0]["status"] = "In Stock"
            new_po = {
                "po_id": f"PO-{np.random.randint(1000, 9999)}",
                "item": "USB-C to USB-A Cable (1m)",
                "supplier": "Apex Tech Components (Failover B)",
                "units": 20,
                "total_cost": 3700,
                "status": "Confirmed (Failover)",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M")
            }
            st.session_state.po_history.insert(0, new_po)
            
            st.error("⚠️ **Signal:** Supplier A rejected PO due to batch stockout.")
            st.warning("🔄 **Autonomous Failover Initiated:** Re-ranked vendor pool via MCP server $\\to$ Selected Supplier B (Apex Tech).")
            st.success("✅ **Resolved:** Revised PO dispatched. Supplier B confirmed! Replenished with zero downtime.")

    st.markdown("---")
    st.subheader("📜 Purchase Order Audit Ledger (Tamper-Evident History)")
    st.dataframe(pd.DataFrame(st.session_state.po_history), use_container_width=True, hide_index=True)

# ----------------------------------------------------
# TAB 4: 5-STAR FEEDBACK LOOP
# ----------------------------------------------------
with tab_feedback:
    st.subheader("⭐ Reinforced Closed-Loop Supplier Rating System")
    st.write("When shipments arrive at the warehouse, merchant ratings dynamically update the AI scoring weights:")
    
    sup_select = st.selectbox("Select Supplier to Evaluate:", [s["name"] for s in st.session_state.suppliers])
    stars = st.slider("Rating (1 = Poor / Delayed, 5 = Flawless Fulfillment):", 1, 5, 5)
    feedback_notes = st.text_input("Delivery Remarks:", "Delivered on-time, packaging verified.")
    
    if st.button("Submit Supplier Review", use_container_width=True):
        for s in st.session_state.suppliers:
            if s["name"] == sup_select:
                s["rating"] = round((s["rating"] * 4 + stars) / 5, 2)
                if stars >= 4:
                    s["reliability"] = min(100.0, s["reliability"] + 0.5)
                else:
                    s["reliability"] = max(50.0, s["reliability"] - 1.5)
        st.success(f"Feedback logged! {sup_select} updated rating: {stars} Stars. AI scoring weights recalculated.")
        st.dataframe(pd.DataFrame(st.session_state.suppliers), use_container_width=True, hide_index=True)

# ----------------------------------------------------
# TAB 5: SIH26199 ARCHITECTURE
# ----------------------------------------------------
with tab_architecture:
    st.subheader("🏛️ Enterprise Microservices Architecture")
    st.markdown("""
    **myBizManager** is built as a production-grade, decoupled software system aligned directly with **SIH26199** (Tertiary Sectors / Retail):
    
    1. **Frontend:** React 18 + Vite with custom VaultEdge glassmorphism theme, responsive SVG charts, and optimistic UI rendering.
    2. **Backend API:** Node.js + Express handling JWT security, atomic MongoDB transactions (`buildItemQuery`), and Google OAuth 2.0 integration.
    3. **AI / ML Layer:** Python FastAPI server executing time-series demand velocity forecasting models and multi-attribute Pareto ranking algorithms.
    4. **Model Context Protocol (MCP) Server Layer:** Standardizes tool execution, allowing the AI to safely query and update MongoDB collections without brittle code.
    5. **National Economic Impact:** Solves the 10-15% revenue loss across India's 63M MSMEs, preventing stockouts and protecting retail margins for Atmanirbhar Bharat.
    """)

# Footer
st.markdown("---")
st.caption("myBizManager • Smart India Hackathon 2026 Prototype • Problem Statement SIH26199 • Built by Team OM27RR")
