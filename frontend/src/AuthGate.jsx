import { useEffect, useState } from 'react'
import { api } from './api'
import Login from './views/Login'

export default function AuthGate({ children }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.auth.me()
      .then((u) => { setUser(u); setLoading(false) })
      .catch(() => { setUser(null); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-950 font-mono">
        <p className="text-[12px] text-base-400">Checking session<span className="blink">_</span></p>
      </div>
    )
  }

  if (!user || user.detail || !user.email) {
    return <Login />
  }

  if (user.email === 'disabled') {
    return children
  }

  return children
}
