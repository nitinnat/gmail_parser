import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtPeriod(p) {
  const [y, m] = p.split('-')
  return `${MONTH_ABBR[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtAmount(amount, currency) {
  if (amount == null) return '—'
  const sym = { USD: '$', INR: '₹', EUR: '€', GBP: '£' }[currency] ?? currency + ' '
  return `${sym}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 text-[11px]" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}>
      <p className="text-base-300 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: 'var(--accent)' }}>{fmtAmount(p.value, p.dataKey)}</p>
      ))}
    </div>
  )
}

const TX_TYPE_COLORS = {
  purchase: 'var(--accent)',
  subscription: '#a78bfa',
  bill: '#fb923c',
  refund: '#4ade80',
  transfer: '#60a5fa',
  fee: '#f87171',
  atm: '#fbbf24',
  other: '#6b7280',
}

const PILL_BASE = { fontSize: 10, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 2, cursor: 'pointer', transition: 'all 0.1s', border: '1px solid' }

function FilterPill({ label, active, color = 'var(--accent)', onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...PILL_BASE,
        borderColor: active ? color : 'rgba(255,255,255,0.1)',
        color: active ? color : 'var(--base-300)',
        background: active ? `${color}18` : 'transparent',
      }}
    >
      {label}
    </button>
  )
}

export default function Spending() {
  const [overview, setOverview] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState([])
  const [typeFilter, setTypeFilter] = useState([])
  const [periodFilter, setPeriodFilter] = useState(null)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  useEffect(() => {
    Promise.all([
      api.expenses.overview(),
      api.expenses.transactions({ limit: 2000, page: 1 }),
    ]).then(([ov, tx]) => {
      setOverview(ov)
      setTransactions(tx.items ?? [])
      setLoading(false)
    })
  }, [])

  const allMerchantCats = useMemo(() =>
    [...new Set(transactions.map(t => t.merchant_category).filter(Boolean))].sort(),
    [transactions],
  )

  const allTxTypes = useMemo(() =>
    [...new Set(transactions.map(t => t.transaction_type).filter(Boolean))].sort(),
    [transactions],
  )

  const displayed = useMemo(() => {
    let filtered = transactions.filter(t =>
      (!catFilter.length || catFilter.includes(t.merchant_category)) &&
      (!typeFilter.length || typeFilter.includes(t.transaction_type)) &&
      (!periodFilter || (t.date || '').startsWith(periodFilter)),
    )
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = key === 'amount' ? Number(a[key] ?? 0) : (a[key] ?? '').toString().toLowerCase()
      const bv = key === 'amount' ? Number(b[key] ?? 0) : (b[key] ?? '').toString().toLowerCase()
      return av < bv ? -mul : av > bv ? mul : 0
    })
  }, [transactions, catFilter, typeFilter, periodFilter, sort])

  const displayTotals = useMemo(() => {
    const byCurrency = {}
    for (const t of displayed) {
      if ((t.transaction_type || '') === 'refund') continue
      const cur = t.currency || 'USD'
      byCurrency[cur] = (byCurrency[cur] || 0) + (Number(t.amount) || 0)
    }
    return byCurrency
  }, [displayed])

  const monthly = useMemo(() => {
    const buckets = {}
    for (const t of displayed) {
      if (!t.date || (t.transaction_type || '') === 'refund') continue
      const period = t.date.slice(0, 7)
      const cur = t.currency || 'USD'
      if (!buckets[period]) buckets[period] = {}
      buckets[period][cur] = (buckets[period][cur] || 0) + (Number(t.amount) || 0)
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, vals]) => ({ period: fmtPeriod(period), rawPeriod: period, ...vals }))
  }, [displayed])

  const primaryCurrency = Object.keys(displayTotals)[0] ?? 'USD'

  const toggleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
  const toggleCat = (c) => setCatFilter(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])
  const toggleType = (t) => setTypeFilter(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])

  if (loading) return <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>

  const totalsUSD = overview?.totals?.by_currency?.USD ?? 0
  const recurringUSD = overview?.recurring_monthly?.by_currency?.USD ?? 0

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Money</p>
        <div className="flex items-baseline gap-4 flex-wrap">
          <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Spending</h2>
          {displayed.length > 0 && (
            <span className="text-base-300 text-[13px] tabular-nums">
              {displayed.length} transactions ·{' '}
              {Object.entries(displayTotals).map(([cur, amt]) => fmtAmount(amt, cur)).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(overview.totals?.by_currency ?? {}).map(([cur, amt]) => (
            <div key={cur} className="p-5" style={{ border: '1px solid var(--border)' }}>
              <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Total {cur}</p>
              <p className="font-display font-700 text-3xl text-base-50 tabular-nums">{fmtAmount(amt, cur)}</p>
            </div>
          ))}
          <div className="p-5" style={{ border: '1px solid var(--border)' }}>
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Transactions</p>
            <p className="font-display font-700 text-3xl text-base-50 tabular-nums">{overview.count}</p>
          </div>
          {recurringUSD > 0 && (
            <div className="p-5" style={{ border: '1px solid var(--border)' }}>
              <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Recurring / mo</p>
              <p className="font-display font-700 text-3xl tabular-nums" style={{ color: '#a78bfa' }}>
                {fmtAmount(recurringUSD, 'USD')}
              </p>
            </div>
          )}
          {Object.entries(overview.refunds?.by_currency ?? {}).filter(([, v]) => v > 0).map(([cur, amt]) => (
            <div key={`ref-${cur}`} className="p-5" style={{ border: '1px solid var(--border)' }}>
              <p className="text-[9px] tracking-[0.25em] uppercase text-base-400 mb-2">Refunds {cur}</p>
              <p className="font-display font-700 text-3xl tabular-nums" style={{ color: '#4ade80' }}>
                {fmtAmount(amt, cur)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Monthly chart */}
      {monthly.length > 0 && (
        <div className="p-5" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-5">
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400">Monthly Spend</p>
            {periodFilter && (
              <button onClick={() => setPeriodFilter(null)} className="text-[10px] text-base-300 hover:text-base-100 transition-colors">
                {fmtPeriod(periodFilter)} <span className="opacity-60">× clear</span>
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthly} barCategoryGap="35%" onClick={(d) => {
              const raw = d?.activePayload?.[0]?.payload?.rawPeriod
              if (raw) setPeriodFilter(p => p === raw ? null : raw)
            }} style={{ cursor: 'pointer' }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey={primaryCurrency} radius={[2,2,0,0]}>
                {monthly.map(e => (
                  <Cell key={e.rawPeriod} fill="var(--accent)" opacity={!periodFilter || e.rawPeriod === periodFilter ? 0.75 : 0.2} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Breakdowns */}
      {overview && (
        <div className="grid md:grid-cols-2 gap-3">
          {/* By merchant category */}
          <div className="p-5 space-y-3" style={{ border: '1px solid var(--border)' }}>
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400">By Category</p>
            <div className="space-y-1.5">
              {(overview.by_merchant_category ?? []).slice(0, 10).map(({ category, amount }) => {
                const max = overview.by_merchant_category[0]?.amount || 1
                return (
                  <div key={category} className="flex items-center gap-3">
                    <span className="text-[10px] w-36 truncate text-base-300">{category}</span>
                    <div className="flex-1 h-px relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="absolute inset-y-0 left-0 h-full" style={{ width: `${(amount / max) * 100}%`, background: 'rgba(0,200,240,0.4)' }} />
                    </div>
                    <span className="text-[10px] text-base-400 tabular-nums w-16 text-right">{fmtAmount(amount, 'USD')}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* By transaction type */}
          <div className="p-5 space-y-3" style={{ border: '1px solid var(--border)' }}>
            <p className="text-[9px] tracking-[0.25em] uppercase text-base-400">By Type</p>
            <div className="space-y-1.5">
              {(overview.by_transaction_type ?? []).map(({ type, amount }) => {
                const max = overview.by_transaction_type[0]?.amount || 1
                const color = TX_TYPE_COLORS[type] || TX_TYPE_COLORS.other
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-[10px] w-28 truncate capitalize" style={{ color }}>{type}</span>
                    <div className="flex-1 h-px relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="absolute inset-y-0 left-0 h-full" style={{ width: `${(amount / max) * 100}%`, background: `${color}44` }} />
                    </div>
                    <span className="text-[10px] text-base-400 tabular-nums w-16 text-right">{fmtAmount(amount, 'USD')}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Transaction table */}
      <div style={{ border: '1px solid var(--border)' }}>
        {/* Filters */}
        {transactions.length > 0 && (
          <div className="px-4 py-2.5 space-y-2" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
            {allMerchantCats.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 mr-1 w-12">Cat</span>
                {allMerchantCats.map(c => (
                  <FilterPill key={c} label={c} active={catFilter.includes(c)} onClick={() => toggleCat(c)} />
                ))}
              </div>
            )}
            {allTxTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 mr-1 w-12">Type</span>
                {allTxTypes.map(t => (
                  <FilterPill key={t} label={t} active={typeFilter.includes(t)} color={TX_TYPE_COLORS[t] || TX_TYPE_COLORS.other} onClick={() => toggleType(t)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Table header */}
        <div
          className="grid px-4 py-2 text-[9px] tracking-[0.2em] uppercase text-base-400"
          style={{ gridTemplateColumns: '90px 1fr 130px 100px 120px 110px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}
        >
          {[
            { label: 'Date', key: 'date' },
            { label: 'Merchant', key: 'merchant_normalized' },
            { label: 'Category', key: 'merchant_category' },
            { label: 'Type', key: 'transaction_type' },
            { label: 'Payment', key: 'payment_method' },
            { label: 'Amount', key: 'amount' },
          ].map(({ label, key }) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className="flex items-center gap-1 text-left hover:text-base-200 transition-colors duration-75"
              style={{ color: sort.key === key ? 'var(--base-200)' : undefined }}
            >
              {label}
              <span className="opacity-60">{sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
            </button>
          ))}
        </div>

        {displayed.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-base-300 text-[11px] tracking-wider uppercase mb-1">No transactions</p>
            <p className="text-base-400 text-[10px]">Run LLM processing in Settings → Sync to extract spending data.</p>
          </div>
        ) : (
          displayed.map((t, i) => {
            const typeColor = TX_TYPE_COLORS[t.transaction_type] || TX_TYPE_COLORS.other
            const payment = [t.payment_method, t.card_last4 ? `····${t.card_last4}` : null].filter(Boolean).join(' ')
            return (
              <div
                key={`${t.gmail_id}-${i}`}
                className="grid px-4 py-2.5 text-[11px] hover:bg-white/[0.015] transition-colors duration-75"
                style={{ gridTemplateColumns: '90px 1fr 130px 100px 120px 110px', borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                <span className="text-base-400 tabular-nums">{fmtDate(t.date)}</span>
                <span className="text-base-100 truncate pr-3" title={t.merchant_normalized || t.merchant || t.subject}>
                  {t.merchant_normalized || t.merchant || t.subject || '—'}
                </span>
                <span className="text-base-300 truncate pr-2 text-[10px]">{t.merchant_category || '—'}</span>
                <span className="capitalize text-[10px] truncate" style={{ color: typeColor }}>{t.transaction_type || '—'}</span>
                <span className="text-base-400 truncate text-[10px] font-mono">{payment || '—'}</span>
                <span className="tabular-nums" style={{ color: t.transaction_type === 'refund' ? '#4ade80' : 'var(--base-100)' }}>
                  {t.transaction_type === 'refund' ? '+' : ''}{fmtAmount(t.amount, t.currency)}
                  {t.is_international && t.foreign_amount && (
                    <span className="text-[9px] text-base-500 ml-1">({t.foreign_currency} {t.foreign_amount})</span>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
