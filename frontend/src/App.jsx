import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import SyncBar from './components/SyncBar'
import Overview from './views/Overview'
import Senders from './views/Senders'
import Subscriptions from './views/Subscriptions'
import Browse from './views/Browse'
import Search from './views/Search'
import SyncPage from './views/Sync'
import Categories from './views/Categories'
import Alerts from './views/Alerts'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <main key={location.pathname} className="page-in flex-1 overflow-auto dot-grid">
      <div className="p-7">
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/senders" element={<Senders />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/alerts" element={<Alerts />} />
        </Routes>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-base-950 font-mono overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <SyncBar />
          <AnimatedRoutes />
        </div>
      </div>
    </BrowserRouter>
  )
}
