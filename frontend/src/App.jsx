import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AuthGate from './AuthGate'
import Sidebar from './components/Sidebar'
import SyncBar from './components/SyncBar'
import EmailPanel from './components/EmailPanel'
import Overview from './views/Overview'
import Senders from './views/Senders'
import Spending from './views/Spending'
import Browse from './views/Browse'
import Actions from './views/Actions'
import Triage from './views/Triage'
import Settings from './views/Settings'
import MDR from './views/MDR'

function AnimatedRoutes({ onOpenEmail }) {
  const location = useLocation()
  const isMDR = location.pathname === '/mdr'

  if (isMDR) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Routes location={location}>
          <Route path="/mdr" element={<MDR />} />
        </Routes>
      </div>
    )
  }

  return (
    <main key={location.pathname} className="page-in flex-1 overflow-auto dot-grid">
      <div className="p-4 md:p-7">
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/triage" element={<Triage onOpenEmail={onOpenEmail} />} />
          <Route path="/browse" element={<Browse onOpenEmail={onOpenEmail} />} />
          <Route path="/spending" element={<Spending />} />
          <Route path="/senders" element={<Senders />} />
          <Route path="/alerts" element={<Actions onOpenEmail={onOpenEmail} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/search" element={<Navigate to="/browse" replace />} />
          <Route path="/subscriptions" element={<Navigate to="/senders" replace />} />
          <Route path="/sync" element={<Navigate to="/settings" replace />} />
          <Route path="/categories" element={<Navigate to="/settings" replace />} />
          <Route path="/rules" element={<Navigate to="/settings" replace />} />
        </Routes>
      </div>
    </main>
  )
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openEmailId, setOpenEmailId] = useState(null)

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
            <AnimatedRoutes onOpenEmail={(id) => setOpenEmailId(id)} />
          </div>
        </div>
        {openEmailId && (
          <EmailPanel emailId={openEmailId} onClose={() => setOpenEmailId(null)} />
        )}
      </AuthGate>
    </BrowserRouter>
  )
}
