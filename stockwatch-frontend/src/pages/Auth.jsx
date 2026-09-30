import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import './Auth.css'

export default function Auth() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'signup' ? 'signup' : 'login')

  // Login fields
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Signup fields
  const [ownerName, setOwnerName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { login, signup } = useApp()
  const navigate = useNavigate()

  function switchTab(nextTab) {
    setTab(nextTab)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (tab === 'signup') {
        await signup({ ownerName, businessName, email: signupEmail, password: signupPassword })
      } else {
        await login(loginEmail, loginPassword)
      }
      navigate('/app/dashboard')
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-wrap">
      <Link to="/" className="auth-back">
        ← Back to home
      </Link>

      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="myBizManager Logo" className="brand-logo-img" />
          myBizManager
        </div>

        <div className="auth-tabs">
          <div className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>
            Log in
          </div>
          <div className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => switchTab('signup')}>
            Sign up
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                placeholder="owner@yourshop.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                placeholder="Your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Owner name</label>
              <input
                type="text"
                placeholder="Arya Sharma"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="field">
              <label>Business name</label>
              <input
                type="text"
                placeholder="Accessories Store"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                placeholder="owner@yourshop.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                placeholder="Create a password (min. 8 characters)"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
