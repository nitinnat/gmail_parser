import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AuthGate from './AuthGate'
import Sidebar from './components/Sidebar'
import SyncBar from './components/SyncBar'
import Overview from './views/Overview'
import Senders from './views/Senders'
import Subscriptions from './views/Subscriptions'
import Spending from './views/Spending'
import Browse from './views/Browse'
import SyncPage from './views/Sync'
import Categories from './views/Categories'
import Alerts from './views/Alerts'
import Rules from './views/Rules'
import Triage from './views/Triage'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <main key={location.pathname} className="page-in flex-1 overflow-auto dot-grid">
      <div className="p-4 md:p-7">
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/triage" element={<Triage />} />
          <Route path="/senders" element={<Senders />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/spending" element={<Spending />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/search" element={<Navigate to="/browse" replace />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/rules" element={<Rules />} />
        </Routes>
      </div>
    </main>
  )
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const logout = async () => {
    await import('./api').then(({ api }) => api.auth.logout())
    window.location.href = '/'
  }

  return (
    <BrowserRouter>
      <AuthGate>
        <div className="flex h-screen bg-base-950 font-mono overflow-hidden">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={logout} />
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Mobile top bar */}
            <div
              className="md:hidden flex items-center gap-3 px-4 h-12 flex-shrink-0 border-b"
              style={{ background: '#080808', borderColor: 'var(--border)' }}
            >
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex flex-col gap-1 p-1"
                aria-label="Open menu"
              >
                <span className="block w-5 h-px bg-base-300" />
                <span className="block w-5 h-px bg-base-300" />
                <span className="block w-5 h-px bg-base-300" />
              </button>
              <img src="/emailcollie-logo.svg" alt="" className="w-6 h-6 object-contain" />
              <span className="font-display font-700 text-sm text-base-50 tracking-tight flex-1">EmailCollie</span>
              <button
                onClick={logout}
                className="text-[10px] tracking-widest uppercase"
                style={{ color: 'var(--base-500)' }}
              >
                Logout
              </button>
            </div>
            <SyncBar />
            <AnimatedRoutes />
          </div>
        </div>
      </AuthGate>
    </BrowserRouter>
  )
}
