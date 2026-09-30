import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import RatingPromptModal from '../components/RatingPromptModal.jsx'
import '../styles/page.css'

export default function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
      <RatingPromptModal />
    </div>
  )
}
