import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

function formatCountdown(nextRun) {
  if (!nextRun) return null
  const mins = Math.round((new Date(nextRun) - Date.now()) / 60000)
  if (mins <= 0) return 'soon'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function SyncBar() {
  const [status, setStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [autoSync, setAutoSync] = useState({ enabled: false, next_run: null })
  const [, setTick] = useState(0)

  const fetchStatus = useCallback(async () => {
    const s = await api.sync.status()
    setStatus(s)
    setSyncing(s.is_syncing)
  }, [])

  useEffect(() => {
    fetchStatus()
    api.sync.autoSync().then(setAutoSync)
  }, [fetchStatus])

  // Refresh countdown display every 30s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!syncing) return
    const id = setInterval(async () => {
      const p = await api.sync.progress()
      if (!p.is_syncing) { setSyncing(false); fetchStatus() }
    }, 3000)
    return () => clearInterval(id)
  }, [syncing, fetchStatus])

  const startSync = async () => {
    await api.sync.start({ max_emails: 100000, days_ago: 90 })
    setSyncing(true)
  }

  const toggleAutoSync = async () => {
    const result = await api.sync.setAutoSync(!autoSync.enabled)
    setAutoSync(result)
  }

  const lastSync = status?.last_sync
    ? new Date(status.last_sync).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    : null

  const countdown = formatCountdown(autoSync.next_run)

  return (
    <div
      className="flex items-center gap-2 md:gap-5 px-4 md:px-7 py-3 border-b text-[11px] flex-shrink-0"
      style={{ background: '#080808', borderColor: 'var(--border)' }}
    >
      {/* Status dot */}
      <span className="flex items-center gap-2 flex-shrink-0">
        <span
          className={syncing ? 'spin' : ''}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: syncing ? 'var(--accent)' : '#555',
            flexShrink: 0,
          }}
        />
        {syncing
          ? <span style={{ color: 'var(--accent)' }}>syncing…</span>
          : <span className="text-base-400">idle</span>
        }
      </span>

      <span className="text-base-400 hidden md:inline">|</span>

      {status?.total_emails
        ? <span className="text-base-300 hidden md:inline">{status.total_emails.toLocaleString()} <span className="text-base-400">emails</span></span>
        : <span className="text-base-400 hidden md:inline">no data</span>
      }

      {lastSync && (
        <>
          <span className="text-base-400 hidden md:inline">|</span>
          <span className="text-base-400 hidden md:inline">synced <span className="text-base-300">{lastSync}</span></span>
        </>
      )}

      <span className="text-base-400 hidden md:inline">|</span>

      <span className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={toggleAutoSync}
          className="text-[10px] tracking-[0.15em] uppercase transition-colors duration-150"
          style={{ color: autoSync.enabled ? 'var(--accent)' : 'var(--base-300)' }}
        >
          auto {autoSync.enabled ? 'on' : 'off'}
        </button>
        {autoSync.enabled && countdown && (
          <span className="text-base-400 hidden md:inline">· next {countdown}</span>
        )}
      </span>

      <button
        onClick={startSync}
        disabled={syncing}
        className="ml-auto px-3 md:px-4 py-1.5 text-[11px] tracking-widest uppercase border transition-all duration-150 disabled:opacity-40 flex-shrink-0"
        style={{
          borderColor: 'var(--accent)',
          color: 'var(--accent)',
          background: syncing ? 'rgba(0,200,240,0.06)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!syncing) e.currentTarget.style.background = 'rgba(0,200,240,0.08)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = syncing ? 'rgba(0,200,240,0.06)' : 'transparent' }}
      >
        Sync
      </button>
    </div>
  )
}
