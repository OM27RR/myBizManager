import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import PublicNavbar from '../components/PublicNavbar.jsx'
import './Home.css'

export default function Home() {

  return (
    <div className="home-french-root">
      <PublicNavbar />

      {/* Atmospheric Background with French Flag Radial Accents */}
      <div className="bg-french-canvas" aria-hidden="true">
        <div className="french-spotlight spotlight-blue"></div>
        <div className="french-spotlight spotlight-red"></div>
        <div className="french-grid-mesh"></div>
      </div>

      {/* 1. HIGH-IMPACT TWO-COLUMN HERO SECTION */}
      <section className="french-hero">
        {/* Left Column: Big Headline, Eyebrow & Live Operations Metrics Dock */}
        <motion.div 
          className="hero-left-col"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <div className="eyebrow-french">
            <span className="eyebrow-pulse-dot"></span>
            <span>AUTONOMOUS OPERATIONS AGENT</span>
          </div>

          <h1 className="french-hero-title">
            Your business runs
            <br />
            while you're <span className="french-gradient-text">not looking.</span>
          </h1>
        </motion.div>

        {/* Right Column: Elevated Description Showcase Card, Primary CTA, Trust Bar */}
        <motion.div 
          className="hero-right-col"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
        >
          {/* Fulfills vacancy: Elevated Hero Value Proposition Card */}
          <div className="hero-narrative-card">
            <div className="narrative-card-header">
              <span className="narrative-tag">
                <span className="narrative-pulse-dot"></span>
                AUTONOMOUS INVENTORY AGENT
              </span>
              <span className="narrative-status-pill">● LIVE AUTOPILOT</span>
            </div>

            <p className="hero-description-prominent">
              Autonomous AI ops that prevents <span className="highlight-text-blue">stockouts</span> and dispatches <span className="highlight-text-white">supplier reorders automatically</span> for any retail shop, pharmacy, supermarket, or business.
            </p>

            <div className="narrative-feature-strip">
              <div className="narrative-pill">
                <span className="pill-icon">🤖</span>
                <span>Dynamic ML Safety Stock</span>
              </div>
              <div className="narrative-pill">
                <span className="pill-icon">⚖️</span>
                <span>AI Multi-Supplier Match</span>
              </div>
              <div className="narrative-pill">
                <span className="pill-icon">✉️</span>
                <span>Gmail OAuth 2.0 Dispatch</span>
              </div>
            </div>
          </div>

          <div className="hero-cta-group">
            <Link to="/auth?tab=signup" className="btn-french-primary">
              <span>Start Free Trial</span>
              <span className="btn-arrow-icon">→</span>
            </Link>
          </div>

          {/* Clean Business Trust Bar (No credit card text) */}
          <div className="french-trust-bar">
            <div className="trust-pill">
              <span className="trust-check">✓</span> 3-Min POS &amp; Excel Sync
            </div>
            <div className="trust-pill">
              <span className="trust-check">✓</span> Retail · Grocery · Pharma · Hardware
            </div>
            <div className="trust-pill">
              <span className="trust-check">✓</span> Zero Technical Friction
            </div>
          </div>
        </motion.div>
      </section>

      {/* 2. CORE PROJECT CAPABILITIES & ARCHITECTURE */}
      <section className="french-features-section" id="features">
        <div className="section-header-french">
          <div className="section-kicker-french">CORE CAPABILITIES &amp; ARCHITECTURE</div>
          <h2 className="section-main-heading-french">Built for Autonomous Retail Operations.</h2>
          <p className="section-sub-paragraph-french">
            myBizManager replaces manual stock checks and tedious supplier follow-ups with an end-to-end autonomous agent driven by ML demand forecasting, multi-supplier evaluation, and direct Gmail OAuth 2.0 dispatch.
          </p>
        </div>

        <div className="features-showcase-grid">
          {/* Feature 1: Dynamic ML Demand Forecasting */}
          <div className="feature-card-modern">
            <div className="feature-card-header">
              <div className="feature-icon-wrapper blue">
                <span className="feature-emoji">🤖</span>
              </div>
              <span className="feature-pill-status live-pill">
                <span className="feature-live-dot"></span> ML ENGINE
              </span>
            </div>
            <h3 className="feature-title">Dynamic ML Demand Forecasting</h3>
            <p className="feature-description">
              Continuous time-series ML models forecast upcoming sales velocity for every individual item. Reorder thresholds dynamically adapt (Current Stock + Predicted Demand), triggering early reorders before inventory drops to zero.
            </p>
            <div className="feature-metric-tags">
              <span className="feature-tag">92.3% ML Precision</span>
              <span className="feature-tag">Dynamic Safety Thresholds</span>
              <span className="feature-tag">Zero Stockouts</span>
            </div>
          </div>

          {/* Feature 2: Multi-Supplier Evaluation */}
          <div className="feature-card-modern">
            <div className="feature-card-header">
              <div className="feature-icon-wrapper red">
                <span className="feature-emoji">⚖️</span>
              </div>
              <span className="feature-pill-status red-pill">
                <span className="feature-live-dot red"></span> MULTI-AGENT
              </span>
            </div>
            <h3 className="feature-title">AI Multi-Supplier Evaluation &amp; Trade-off</h3>
            <p className="feature-description">
              Intelligent multi-agent negotiation dynamically evaluates all candidate suppliers by weighing unit wholesale price against historical reliability SLAs, providing descriptive comparison reasoning for every recommendation.
            </p>
            <div className="feature-metric-tags">
              <span className="feature-tag">Cost vs Reliability SLA</span>
              <span className="feature-tag">Descriptive Trade-off Rationale</span>
            </div>
          </div>

          {/* Feature 3: Automated PO Dispatch via Gmail */}
          <div className="feature-card-modern">
            <div className="feature-card-header">
              <div className="feature-icon-wrapper green">
                <span className="feature-emoji">✉️</span>
              </div>
              <span className="feature-pill-status green-pill">
                <span className="feature-live-dot green"></span> ZERO-CLICK PO
              </span>
            </div>
            <h3 className="feature-title">Automated PO Dispatch via Gmail OAuth 2.0</h3>
            <p className="feature-description">
              Native integration with Google Workspace via secure OAuth 2.0. The agent formats official Purchase Orders with full line-item details, dispatches them directly to supplier inboxes, and provides one-click owner approval with an immutable audit log.
            </p>
            <div className="feature-metric-tags">
              <span className="feature-tag">&lt; 3.2s Autonomous Latency</span>
              <span className="feature-tag">Gmail OAuth 2.0 API</span>
              <span className="feature-tag">Full Audit Ledger</span>
            </div>
          </div>

          {/* Feature 4: Real-Time Inventory Control */}
          <div className="feature-card-modern">
            <div className="feature-card-header">
              <div className="feature-icon-wrapper cyan">
                <span className="feature-emoji">📊</span>
              </div>
              <span className="feature-pill-status cyan-pill">
                <span className="feature-live-dot cyan"></span> LIVE LEDGER
              </span>
            </div>
            <h3 className="feature-title">Real-Time Inventory Control &amp; Simulation</h3>
            <p className="feature-description">
              Live warehouse inventory ledger featuring instant manual quantity adjustments, real-time status alerts, and a built-in bulk stock drop simulator to stress test agent reactivity and restock automation in real time.
            </p>
            <div className="feature-metric-tags">
              <span className="feature-tag">Simulate Bulk Stock Drop</span>
              <span className="feature-tag">Instant Threshold Alerts</span>
              <span className="feature-tag">Full Catalog Sync</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. IMPACT METRICS BAR */}
      <section className="french-stats-strip" id="metrics">
        <div className="stat-pod-french">
          <div className="stat-pod-num-french">₹3,40,000+</div>
          <div className="stat-pod-lbl-french">Inventory Protected</div>
        </div>
        <div className="stat-pod-divider-french"></div>
        <div className="stat-pod-french">
          <div className="stat-pod-num-french">92.3%</div>
          <div className="stat-pod-lbl-french">ML Reorder Precision</div>
        </div>
        <div className="stat-pod-divider-french"></div>
        <div className="stat-pod-french">
          <div className="stat-pod-num-french">0</div>
          <div className="stat-pod-lbl-french">Stockouts On Active Watches</div>
        </div>
        <div className="stat-pod-divider-french"></div>
        <div className="stat-pod-french">
          <div className="stat-pod-num-french">&lt; 3.2s</div>
          <div className="stat-pod-lbl-french">Autonomous PO Latency</div>
        </div>
      </section>

      {/* 4. VISUAL REORDER PIPELINE WITH 3 WORKFLOW STAGES (NO SCANNER) */}
      <section className="french-photo-pipeline-section" id="stages">
        <div className="section-header-french">
          <div className="section-kicker-french">AUTONOMOUS RESTOCK WORKFLOW</div>
          <h2 className="section-main-heading-french">From ML Risk Detection to Shelf Restocked.</h2>
          <p className="section-sub-paragraph-french">
            Zero-latency replenishment cycle powered by machine learning, multi-supplier optimization, and direct Gmail dispatch.
          </p>
        </div>

        <div className="photo-pipeline-grid">
          {/* Stage 1: Dynamic ML Risk Detection */}
          <div className="pipeline-card">
            <div className="pipeline-photo-wrapper">
              <img 
                src="/stage1_loading.jpg" 
                alt="Real-time stock risk detection" 
                className="pipeline-img"
              />
              <div className="pipeline-badge-overlay blue">STAGE 01 · DETECTION</div>
            </div>
            <div className="pipeline-content">
              <h3 className="pipeline-title">Stage 1 : Real-Time Stock Risk Detection</h3>
              <p className="pipeline-desc">
                Continuous ML forecasting models monitor inventory against dynamic safety thresholds. When available stock dips below predicted upcoming demand, a restock risk alert is triggered immediately.
              </p>
            </div>
          </div>

          {/* Stage 2: AI Multi-Supplier Evaluation */}
          <div className="pipeline-card active-card">
            <div className="pipeline-photo-wrapper">
              <img 
                src="/stage2_ai_supplier.jpg" 
                alt="AI multi-supplier evaluation and comparison" 
                className="pipeline-img stage2-img"
              />
              <div className="check-verified-overlay ai-match-badge">✓ OPTIMAL SLA MATCH</div>
              <div className="pipeline-badge-overlay red">STAGE 02 · AI EVALUATION</div>
            </div>
            <div className="pipeline-content">
              <h3 className="pipeline-title">Stage 2 : Multi-Supplier Evaluation &amp; Smart Match</h3>
              <p className="pipeline-desc">
                The AI agent evaluates candidate suppliers on unit wholesale price, delivery lead time, and reliability SLA benchmarks, providing transparent descriptive reasoning for the optimal restock choice.
              </p>
            </div>
          </div>

          {/* Stage 3: Automated PO Dispatch via Gmail & Restocking */}
          <div className="pipeline-card">
            <div className="pipeline-photo-wrapper">
              <img 
                src="/stage3_restocked.jpg" 
                alt="Automated PO dispatch and stock restocked" 
                className="pipeline-img"
              />
              <div className="check-verified-overlay">✓ REFILLED</div>
              <div className="pipeline-badge-overlay green">STAGE 03 · RESTOCKED</div>
            </div>
            <div className="pipeline-content">
              <h3 className="pipeline-title">Stage 3 : Automated PO Dispatch &amp; Shelf Restocked</h3>
              <p className="pipeline-desc">
                The official Purchase Order is dispatched autonomously via Gmail OAuth 2.0 to the chosen vendor. The shipment is delivered directly to store shelves, keeping inventory full with zero customer downtime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. PUBLIC FOOTER */}
      <footer className="french-public-footer">
        <div className="footer-left-french">
          <div className="footer-brand-french">
            <img src="/logo.png" alt="myBizManager Logo" className="brand-logo-img" />
            <b>myBizManager</b>
          </div>
          <span className="footer-sub-french">Autonomous Business Operations Agent</span>
        </div>
        <div className="footer-right-french">
          <span>© 2026 myBizManager</span>
        </div>
      </footer>
    </div>
  )
}
