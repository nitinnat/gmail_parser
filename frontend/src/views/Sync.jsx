import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

function ProgressBar({ pct }) {
  return (
    <div className="w-full h-px relative" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <div
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--accent)' }}
      />
    </div>
  )
}

function LogLine({ level, line, ts }) {
  const color =
    level === 'ERROR'   ? 'var(--danger)' :
    level === 'WARNING' ? 'var(--warn)'   :
    line.includes('complete') || line.includes('Done') ? 'var(--ok)' :
    line.includes('found') || line.includes('synced') ? '#cccccc' :
    '#888'

  const tsStr = ts
    ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="flex gap-3 leading-5">
      <span className="text-base-400 flex-shrink-0 tabular-nums select-none" style={{ minWidth: 58 }}>
        {tsStr ?? '      '}
      </span>
      <span style={{ color, wordBreak: 'break-all' }}>{line}</span>
    </div>
  )
}

export default function SyncPage() {
  const [progress, setProgress] = useState(null)
  const [liveCount, setLiveCount] = useState(null)
  const [status, setStatus] = useState(null)
  const [scriptLines, setScriptLines] = useState([])
  const [apiLogs, setApiLogs] = useState([])
  const [lastApiLogTs, setLastApiLogTs] = useState(null)
  const [syncReq, setSyncReq] = useState({ days_ago: 90, max_emails: 100000 })
  const [autoScroll, setAutoScroll] = useState(true)
  const [categorizing, setCategorizing] = useState(false)
  const [catResult, setCatResult] = useState(null)
  const logRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const [prog, cnt, stat] = await Promise.all([
      api.sync.progress(),
      api.sync.liveCount(),
      api.sync.status(),
    ])
    setProgress(prog)
    setLiveCount(cnt.count)
    setStatus(stat)
  }, [])

  const fetchLogs = useCallback(async () => {
    const res = await api.sync.logs(lastApiLogTs)
    // Script log: always replace (server reads full file each time)
    setScriptLines(res.script_lines ?? [])
    // API logs: append new entries
    if (res.api_logs?.length > 0) {
      setApiLogs((prev) => [...prev, ...res.api_logs].slice(-500))
      setLastApiLogTs(res.api_logs[res.api_logs.length - 1].ts)
    }
  }, [lastApiLogTs])

  useEffect(() => {
    fetchAll()
    fetchLogs()
  }, []) // eslint-disable-line

  useEffect(() => {
    if (status && !status.has_history_id) {
      setSyncReq((r) => ({ ...r, days_ago: null }))
    }
  }, [status?.has_history_id])

  const isSyncing = progress?.is_syncing

  useEffect(() => {
    const interval = setInterval(() => {
      fetchAll()
      fetchLogs()
    }, isSyncing ? 2000 : 5000)
    return () => clearInterval(interval)
  }, [fetchAll, fetchLogs, isSyncing])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [scriptLines, apiLogs, autoScroll])

  const handleScroll = () => {
    const el = logRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const startSync = async () => {
    await api.sync.start(syncReq)
    setApiLogs([])
    setLastApiLogTs(null)
    fetchAll()
    fetchLogs()
  }

  const startIncremental = async () => {
    await api.sync.incremental()
    setApiLogs([])
    setLastApiLogTs(null)
    fetchAll()
    fetchLogs()
  }

  const runCategorize = async () => {
    setCategorizing(true)
    setCatResult(null)
    const res = await api.sync.categorize()
    setCatResult(res)
    setCategorizing(false)
  }

  // Merge: show script lines then api logs (api logs are for API-triggered syncs)
  const allLines = [
    ...scriptLines.map((l) => ({ ...l, source: 'script' })),
    ...apiLogs.map((l) => ({ ...l, source: 'api' })),
  ]

  const pct = progress?.pct ?? 0

  return (
    <div className="max-w-3xl space-y-7">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">EmailCollie Sync</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Sync Status</h2>
      </div>

      {/* Live counter */}
      <div className="p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-base-400 mb-2">Emails in Database</p>
            <p
              className="font-display font-700 leading-none tabular-nums"
              style={{ fontSize: 56, color: isSyncing ? 'var(--accent)' : '#eeeeee' }}
            >
              {liveCount?.toLocaleString() ?? '—'}
            </p>
          </div>
          {isSyncing && progress?.total > 0 && (
            <div className="text-right">
              <p className="text-[10px] tracking-[0.2em] uppercase text-base-400 mb-1">Target</p>
              <p className="font-display font-600 text-3xl text-base-300 tabular-nums">
                {progress.total.toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {isSyncing && progress?.total > 0 && (
          <div className="space-y-2">
            <ProgressBar pct={pct} />
            <div className="flex justify-between text-[11px] text-base-400 tabular-nums">
              <span>{progress.synced.toLocaleString()} synced</span>
              <span style={{ color: 'var(--accent)' }}>{pct}%</span>
            </div>
          </div>
        )}

        {isSyncing && progress?.total === 0 && (
          <div className="space-y-2">
            <div className="h-px w-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full w-1/3" style={{ background: 'var(--accent)', animation: 'indeterminate 1.4s ease-in-out infinite' }} />
            </div>
            <p className="text-[11px] text-base-400">Fetching message list from Gmail<span className="blink">_</span></p>
          </div>
        )}

        {!isSyncing && status?.last_sync && (
          <p className="text-[11px] text-base-400">
            Last synced: <span className="text-base-300">{new Date(status.last_sync).toLocaleString()}</span>
          </p>
        )}

        {progress?.error && (
          <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{progress.error}</p>
        )}
      </div>

      {/* Application log */}
      <div style={{ border: '1px solid var(--border)' }}>
        {/* Terminal title bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: '#555' }} />
              <span className="w-3 h-3 rounded-full" style={{ background: '#555' }} />
              <span className="w-3 h-3 rounded-full" style={{ background: isSyncing ? 'var(--ok)' : '#555' }} />
            </div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-base-400">
              Application Logs
            </span>
            {isSyncing && (
              <span className="text-[10px] tracking-wider" style={{ color: 'var(--accent)' }}>
                ● live
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {!autoScroll && (
              <button
                onClick={() => {
                  setAutoScroll(true)
                  if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
                }}
                className="text-[10px] tracking-wider uppercase transition-colors"
                style={{ color: 'var(--accent)' }}
              >
                ↓ Scroll to bottom
              </button>
            )}
            <span className="text-[10px] text-base-400 tabular-nums">{allLines.length} lines</span>
          </div>
        </div>

        {/* Log content */}
        <div
          ref={logRef}
          onScroll={handleScroll}
          className="overflow-y-auto text-[11px] font-mono"
          style={{
            height: 420,
            background: '#050505',
            padding: '10px 16px',
            lineHeight: 1.6,
          }}
        >
          {allLines.length === 0 ? (
            <p className="text-base-400 text-center mt-16 tracking-wider">No logs yet</p>
          ) : (
            allLines.map((l, i) => (
              <LogLine key={i} level={l.level} line={l.line} ts={l.ts} />
            ))
          )}
          {isSyncing && (
            <div className="flex gap-3 mt-1">
              <span className="text-base-400 select-none" style={{ minWidth: 58 }} />
              <span style={{ color: 'var(--accent)' }}><span className="blink">█</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Start sync controls */}
      <div className="p-5 space-y-4" style={{ border: '1px solid var(--border)' }}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-base-400">Start New Sync</p>
        <div className="flex gap-6 flex-wrap">
          <div className="space-y-1.5">
            <p className="text-[10px] tracking-wider uppercase text-base-400">Days back</p>
            <div className="flex gap-1">
              {[30, 90, 365, null].map((d) => (
                <button
                  key={d ?? 'all'}
                  onClick={() => setSyncReq((r) => ({ ...r, days_ago: d }))}
                  className="px-3 py-1.5 text-[11px] tracking-wider uppercase transition-all duration-100"
                  style={{
                    border: `1px solid ${syncReq.days_ago === d ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}`,
                    color:  syncReq.days_ago === d ? 'var(--accent)' : '#aaa',
                    background: syncReq.days_ago === d ? 'rgba(0,200,240,0.07)' : 'transparent',
                  }}
                >
                  {d ? `${d}d` : 'All'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] tracking-wider uppercase text-base-400">Max emails</p>
            <div className="flex gap-1">
              {[10000, 50000, 100000].map((n) => (
                <button
                  key={n}
                  onClick={() => setSyncReq((r) => ({ ...r, max_emails: n }))}
                  className="px-3 py-1.5 text-[11px] tracking-wider uppercase transition-all duration-100"
                  style={{
                    border: `1px solid ${syncReq.max_emails === n ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}`,
                    color:  syncReq.max_emails === n ? 'var(--accent)' : '#aaa',
                    background: syncReq.max_emails === n ? 'rgba(0,200,240,0.07)' : 'transparent',
                  }}
                >
                  {(n / 1000).toFixed(0)}k
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={startSync}
            disabled={isSyncing}
            className="px-6 py-2.5 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-40"
            style={{ color: 'var(--accent)', border: '1px solid rgba(0,200,240,0.4)', background: 'rgba(0,200,240,0.06)' }}
            onMouseEnter={(e) => { if (!isSyncing) e.currentTarget.style.background = 'rgba(0,200,240,0.12)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,200,240,0.06)' }}
          >
            {isSyncing ? 'Sync Running…' : 'Start Sync'}
          </button>
          <button
            onClick={startIncremental}
            disabled={isSyncing || !status?.has_history_id}
            title={!status?.has_history_id ? 'Run a full sync first to enable incremental' : 'Sync only changes since last sync'}
            className="px-6 py-2.5 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-30"
            style={{ color: 'var(--ok)', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)' }}
            onMouseEnter={(e) => { if (!isSyncing && status?.has_history_id) e.currentTarget.style.background = 'rgba(34,197,94,0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.06)' }}
          >
            Incremental Sync
          </button>
          {!status?.has_history_id && (
            <span className="text-[10px] text-base-400">run a full sync first to enable</span>
          )}
        </div>
      </div>

      {/* Categorize emails */}
      <div className="p-5 space-y-4" style={{ border: '1px solid var(--border)' }}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-base-400">Email Categorization</p>
        <p className="text-[11px] text-base-400">
          Assign local categories (Finance, Jobs, AI &amp; Tech, etc.) to all emails using rule-based matching.
          Run after each sync to categorize newly ingested emails.
        </p>
        <button
          onClick={runCategorize}
          disabled={categorizing || isSyncing}
          className="px-6 py-2.5 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-40"
          style={{ color: 'var(--ok)', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)' }}
          onMouseEnter={(e) => { if (!categorizing) e.currentTarget.style.background = 'rgba(34,197,94,0.1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.06)' }}
        >
          {categorizing ? 'Categorizing…' : 'Categorize Emails'}
        </button>

        {catResult && (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] text-base-400">
              Categorized <span className="text-base-200 tabular-nums">{catResult.updated?.toLocaleString()}</span> emails
            </p>
            <div className="space-y-1.5">
              {Object.entries(catResult.categories || {})
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => {
                  const color = CATEGORY_COLORS[cat] || '#aaa'
                  const max = Math.max(...Object.values(catResult.categories))
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-[10px] w-40 truncate" style={{ color }}>{cat}</span>
                      <div className="flex-1 h-px relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div
                          className="absolute inset-y-0 left-0 h-full"
                          style={{ width: `${(count / max) * 100}%`, background: `${color}44` }}
                        />
                      </div>
                      <span className="text-[10px] text-base-400 tabular-nums w-12 text-right">{count.toLocaleString()}</span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
