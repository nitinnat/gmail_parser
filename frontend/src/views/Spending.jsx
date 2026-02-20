import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtPeriod(p) {
  const [y, m] = p.split('-')
  return `${MONTH_ABBR[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtAmount(amount, currency) {
  if (amount == null) return '—'
  const sym = currency === 'INR' ? '₹' : '$'
  return `${sym}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 text-[11px]" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}>
      <p className="text-base-300 mb-1">{label}</p>
      <p style={{ color: 'var(--accent)' }}>{fmtAmount(payload[0].value, payload[0].dataKey)}</p>
    </div>
  )
}

// ── Sender autocomplete ───────────────────────────────────────────────────────

function SenderInput({ allSenders, pinned, onAdd }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const suggestions = query.trim()
    ? allSenders.filter((s) => s.toLowerCase().includes(query.toLowerCase()) && !pinned.includes(s)).slice(0, 8)
    : []

  const select = (s) => { onAdd(s); setQuery(''); setOpen(false) }

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) select(query.trim()) }}
        placeholder="Add sender…"
        className="bg-transparent text-[11px] text-base-100 placeholder-base-500 px-2 py-1 focus:outline-none w-44"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-50 left-0 top-full mt-px max-h-48 overflow-y-auto w-64"
          style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              onMouseDown={() => select(s)}
              className="block w-full text-left px-3 py-1.5 text-[10px] font-mono text-base-200 hover:bg-white/5 truncate"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Spending() {
  const [loading, setLoading] = useState(true)
  const [reprocessing, setReprocessing] = useState(false)
  const [allSenders, setAllSenders] = useState([])
  const [transactions, setTransactions] = useState([])
  const [rules, setRules] = useState([])
  const [customSenders, setCustomSenders] = useState([])
  const [categoryFilter, setCategoryFilter] = useState([])
  const [periodFilter, setPeriodFilter] = useState(null)
  const [sort, setSort] = useState({ key: 'date_timestamp', dir: 'desc' })
  const [status, setStatus] = useState(null)

  const loadTransactions = async () => {
    const tx = await api.expenses.transactions({ limit: 500, page: 1 })
    setTransactions(tx.items ?? [])
  }

  useEffect(() => {
    Promise.all([
      api.expenses.getRules(),
      api.expenses.transactions({ limit: 500, page: 1 }),
      api.analytics.senders(1000),
    ]).then(([r, tx, s]) => {
      const loaded = r.rules ?? []
      setRules(loaded)
      const custom = loaded.find((rule) => rule.name === 'Custom Senders')
      setCustomSenders(custom?.senders ?? [])
      setTransactions(tx.items ?? [])
      setAllSenders(s.map((x) => x.sender))
      setLoading(false)
    })
  }, [])

  const reprocess = async () => {
    setReprocessing(true)
    setStatus(null)
    // Always fetch fresh rules from server so system rules are never overwritten by stale state
    const current = await api.expenses.getRules()
    const freshSystemRules = (current.rules ?? []).filter((r) => r.system)
    const updatedRules = [
      ...freshSystemRules,
      {
        name: 'Custom Senders',
        senders: customSenders,
        keywords: [],
        labels: [],
        match_categories: [],
        category: 'Uncategorized',
        system: false,
      },
    ]
    await api.expenses.setRules({ rules: updatedRules, include_ids: [] })
    setRules(updatedRules)
    const res = await api.expenses.reprocess()
    await loadTransactions()
    setStatus(res)
    setReprocessing(false)
  }

  const displayTransactions = useMemo(() => {
    const filtered = transactions.filter((t) =>
      (!categoryFilter.length || categoryFilter.includes(t.category)) &&
      (!periodFilter || t.date_iso?.startsWith(periodFilter)),
    )
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = key === 'amount' ? Number(a[key] ?? 0) : key === 'date_timestamp' ? Number(a[key] ?? 0) : (a[key] ?? '').toString().toLowerCase()
      const bv = key === 'amount' ? Number(b[key] ?? 0) : key === 'date_timestamp' ? Number(b[key] ?? 0) : (b[key] ?? '').toString().toLowerCase()
      return av < bv ? -mul : av > bv ? mul : 0
    })
  }, [transactions, categoryFilter, periodFilter, sort])

  const totals = useMemo(() => {
    const byCurrency = {}
    for (const t of displayTransactions) {
      const cur = t.currency || 'USD'
      byCurrency[cur] = (byCurrency[cur] || 0) + (Number(t.amount) || 0)
    }
    return byCurrency
  }, [displayTransactions])

  const monthly = useMemo(() => {
    const buckets = {}
    for (const t of displayTransactions) {
      if (!t.date_iso) continue
      const period = t.date_iso.slice(0, 7)
      const cur = t.currency || 'USD'
      if (!buckets[period]) buckets[period] = {}
      buckets[period][cur] = (buckets[period][cur] || 0) + (Number(t.amount) || 0)
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, vals]) => ({ period: fmtPeriod(period), rawPeriod: period, ...vals }))
  }, [displayTransactions])

  const primaryCurrency = Object.keys(totals)[0] ?? 'USD'
  const systemRules = rules.filter((r) => r.system)

  if (loading) {
    return <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Money</p>
        <div className="flex items-baseline gap-4">
          <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Spending</h2>
          {displayTransactions.length > 0 && (
            <span className="text-base-300 text-[13px] tabular-nums">
              {displayTransactions.length} transactions ·{' '}
              {Object.entries(totals).map(([cur, amt]) => fmtAmount(amt, cur)).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Configuration */}
      <div style={{ border: '1px solid var(--border)' }}>
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
        >
          <p className="text-[9px] tracking-[0.25em] uppercase text-base-400">Sources</p>
          <button
            onClick={reprocess}
            disabled={reprocessing}
            className="text-[10px] tracking-widest uppercase transition-opacity"
            style={{ color: 'var(--accent)', opacity: reprocessing ? 0.5 : 1 }}
          >
            {reprocessing ? 'Processing…' : 'Reprocess ▶'}
          </button>
        </div>

        <div className="px-4 py-4 flex gap-8 flex-wrap">
          {/* System rules (read-only) */}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] tracking-[0.2em] uppercase text-base-400 mb-2">Detected</p>
            <div className="flex flex-wrap gap-1.5">
              {systemRules.map((rule) => (
                <span
                  key={rule.name}
                  className="px-2 py-0.5 text-[10px]"
                  style={{
                    border: '1px solid rgba(0,200,240,0.25)',
                    color: 'var(--accent)',
                    background: 'rgba(0,200,240,0.05)',
                  }}
                >
                  {rule.name}
                </span>
              ))}
              {systemRules.length === 0 && (
                <span className="text-base-500 text-[10px]">No auto-detected rules</span>
              )}
            </div>
          </div>

          {/* Custom senders (editable) */}
          <div className="flex-shrink-0 w-64">
            <p className="text-[9px] tracking-[0.2em] uppercase text-base-400 mb-2">Custom Senders</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {customSenders.map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 font-mono text-base-200"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <span className="truncate max-w-[140px]" title={s}>{s}</span>
                  <button
                    onClick={() => setCustomSenders((p) => p.filter((x) => x !== s))}
                    className="text-base-400 hover:text-base-100 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <SenderInput
              allSenders={allSenders}
              pinned={customSenders}
              onAdd={(s) => setCustomSenders((p) => [...p, s])}
            />
          </div>
        </div>
      </div>

      {/* Reprocess status */}
      {status && (
        <div
          className="px-4 py-3 text-[11px] space-y-1"
          style={{ border: `1px solid ${status.extracted > 0 ? 'rgba(0,200,240,0.2)' : 'rgba(255,100,80,0.2)'}` }}
        >
          <p className="text-base-200">
            Scanned <span className="text-base-50">{status.processed.toLocaleString()}</span> emails ·
            matched <span className="text-base-50">{status.matched.toLocaleString()}</span> ·
            extracted <span style={{ color: status.extracted > 0 ? 'var(--accent)' : '#f87171' }}>
              {status.extracted}
            </span> transactions ·
            <span className="text-base-400"> {status.missing_amount} no amount found</span>
          </p>

          {status.extracted === 0 && status.matched_samples?.length > 0 && (
            <div className="mt-2">
              <p className="text-[9px] tracking-[0.2em] uppercase text-base-400 mb-1.5">
                Sample matched emails (no amount extracted)
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {status.matched_samples.map((s, i) => (
                  <div key={i} className="flex gap-3 text-[10px]">
                    <span className="text-base-400 flex-shrink-0 tabular-nums w-20">{fmtDate(s.date)}</span>
                    <span className="text-base-300 truncate flex-1" title={s.subject}>{s.subject || '(no subject)'}</span>
                    <span className="text-base-400 truncate w-40 flex-shrink-0 font-mono" title={s.sender}>{s.sender}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {displayTransactions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(totals).map(([cur, amt]) => (
            <div key={cur} className="p-5" style={{ border: '1px solid var(--border)' }}>
              <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Total {cur}</p>
              <p className="font-display font-700 text-3xl text-base-50 tabular-nums">
                {fmtAmount(amt, cur)}
              </p>
            </div>
          ))}
          <div className="p-5" style={{ border: '1px solid var(--border)' }}>
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Transactions</p>
            <p className="font-display font-700 text-3xl text-base-50 tabular-nums">
              {displayTransactions.length}
            </p>
          </div>
          {displayTransactions.length > 0 && (
            <div className="p-5" style={{ border: '1px solid var(--border)' }}>
              <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Avg</p>
              <p className="font-display font-700 text-3xl text-base-50 tabular-nums">
                {fmtAmount((totals[primaryCurrency] || 0) / displayTransactions.length, primaryCurrency)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Monthly chart */}
      {monthly.length > 0 && (
        <div className="p-5" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-5">
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400">Monthly Spend</p>
            {periodFilter && (
              <button
                onClick={() => setPeriodFilter(null)}
                className="text-[10px] text-base-300 hover:text-base-100 flex items-center gap-1.5 transition-colors"
              >
                {fmtPeriod(periodFilter)} <span className="opacity-60">× clear</span>
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={monthly}
              barCategoryGap="35%"
              onClick={(data) => {
                const raw = data?.activePayload?.[0]?.payload?.rawPeriod
                if (raw) setPeriodFilter((p) => (p === raw ? null : raw))
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey={primaryCurrency} radius={[2, 2, 0, 0]}>
                {monthly.map((entry) => (
                  <Cell
                    key={entry.rawPeriod}
                    fill="var(--accent)"
                    opacity={!periodFilter || entry.rawPeriod === periodFilter ? 0.75 : 0.2}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Transactions table */}
      <div style={{ border: '1px solid var(--border)' }}>
        {/* Category filter */}
        {transactions.length > 0 && (
          <div
            className="px-4 py-2.5 flex flex-wrap gap-1.5 items-center"
            style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
          >
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 mr-1">Filter</span>
            {ALL_CATEGORIES.map((cat) => {
              const active = categoryFilter.includes(cat)
              const color = CATEGORY_COLORS[cat] || '#aaa'
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter((prev) =>
                    prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
                  )}
                  className="px-2 py-0.5 text-[10px] transition-all duration-100"
                  style={{
                    border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
                    color: active ? color : 'var(--base-300)',
                    background: active ? `${color}18` : 'transparent',
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        )}

        <div
          className="grid px-4 py-2 text-[9px] tracking-[0.2em] uppercase text-base-400"
          style={{
            gridTemplateColumns: '100px 1fr 140px 110px 160px',
            background: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {[
            { label: 'Date', key: 'date_timestamp' },
            { label: 'Description', key: 'merchant' },
            { label: 'Sender', key: 'source_sender' },
            { label: 'Amount', key: 'amount' },
            { label: 'Category', key: 'category' },
          ].map(({ label, key }) => (
            <button
              key={key}
              onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
              className="flex items-center gap-1 text-left hover:text-base-200 transition-colors duration-75"
              style={{ color: sort.key === key ? 'var(--base-200)' : undefined }}
            >
              {label}
              <span className="opacity-60">
                {sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
              </span>
            </button>
          ))}
        </div>

        {displayTransactions.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-base-300 text-[11px] tracking-wider uppercase mb-1">No transactions</p>
            <p className="text-base-400 text-[10px]">
              Click Reprocess to extract transactions from your emails.
            </p>
          </div>
        ) : (
          displayTransactions.map((t) => (
            <div
              key={t.id}
              className="grid px-4 py-2.5 text-[11px] hover:bg-white/[0.015] transition-colors duration-75"
              style={{
                gridTemplateColumns: '100px 1fr 140px 110px 160px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <span className="text-base-400 tabular-nums">{fmtDate(t.date_iso)}</span>
              <span className="text-base-100 truncate pr-3" title={t.merchant || t.subject || ''}>
                {t.merchant || t.subject || '—'}
              </span>
              <span className="text-base-300 truncate pr-3 font-mono text-[10px]" title={t.source_sender}>
                {t.source_sender || '—'}
              </span>
              <span className="text-base-100 tabular-nums">{fmtAmount(t.amount, t.currency)}</span>
              <span className="text-base-400">{t.category || 'Uncategorized'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
