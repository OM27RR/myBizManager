import { Link } from 'react-router-dom'
import './PublicNavbar.css'

export default function PublicNavbar() {
  return (
    <nav className="public-nav">
      <Link to="/" className="brand">
        <img src="/logo.png" alt="myBizManager Logo" className="brand-logo-img" />
        myBizManager
      </Link>
      <div className="nav-links">
        <a 
          className="link" 
          href="#features"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          Core Features
        </a>
        <a 
          className="link" 
          href="#metrics"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('metrics')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
        >
          Impact Metrics
        </a>
        <a 
          className="link" 
          href="#stages"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('stages')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          How It Works
        </a>
      </div>
      <div className="nav-cta">
        <Link to="/auth?tab=login" className="btn btn-ghost">
          Log in
        </Link>
        <Link to="/auth?tab=signup" className="btn btn-primary">
          Get started
        </Link>
      </div>
    </nav>
  )
}
