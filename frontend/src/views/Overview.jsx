import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  LineChart, Line, Legend,
} from 'recharts'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtPeriod(p) {
  const [y, m] = p.split('-')
  return `${MONTH_ABBR[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtHour(h) {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return `${h > 12 ? h - 12 : h}${h < 12 ? 'a' : 'p'}`
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="p-6 flex flex-col gap-3" style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
      <span className="font-display font-700 leading-none tabular-nums" style={{ fontSize: 44, color: accent || '#eeeeee' }}>
        {value?.toLocaleString() ?? '—'}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] tracking-[0.25em] uppercase text-base-400">{label}</span>
        {sub && <span className="text-[10px] text-base-400">{sub}</span>}
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return <p className="text-[10px] tracking-[0.25em] uppercase text-base-400 mb-5">{children}</p>
}

const ChartTip = ({ active, payload, label, unit = 'emails' }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 text-[11px]" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}>
      <p className="text-base-300 mb-1">{label}</p>
      <p style={{ color: 'var(--accent)' }}>{payload[0].value.toLocaleString()} {unit}</p>
    </div>
  )
}

function InsightChip({ label, value }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3" style={{ border: '1px solid var(--border)' }}>
      <span className="text-[10px] tracking-[0.2em] uppercase text-base-400">{label}</span>
      <span className="text-[13px] text-base-100 tabular-nums">{value}</span>
    </div>
  )
}

const EXPLORER_TABS = ['Domains', 'Category Trends', 'Heatmap']

export default function Overview() {
  const [data, setData] = useState(null)
  const [eda, setEda] = useState(null)
  const [explorerTab, setExplorerTab] = useState('Domains')
  const navigate = useNavigate()

  useEffect(() => {
    const load = () => {
      api.analytics.overview().then(setData)
      api.analytics.eda().then(setEda)
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const chartData = data?.monthly_volume?.map((d) => ({ ...d, period: fmtPeriod(d.period) }))

  // Derived insight chips from EDA
  const peakDow = eda?.day_of_week?.reduce((a, b) => b.count > a.count ? b : a, { day: '—', count: 0 })
  const peakHour = eda?.hour_of_day?.reduce((a, b) => b.count > a.count ? b : a, { hour: 0, count: 0 })
  const peakHourLabel = eda ? `${fmtHour(peakHour.hour)}–${fmtHour((peakHour.hour + 1) % 24)}` : '—'

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Inbox Intelligence</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Overview</h2>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Emails" value={data?.total} />
        <StatCard
          label="Unread"
          value={data?.unread}
          sub={eda && data?.total ? `${(100 - eda.totals.read_rate).toFixed(1)}%` : null}
        />
        <StatCard label="Starred" value={data?.starred} />
        <StatCard label="Subscriptions" value={data?.subscription_count} accent="var(--warn)" />
      </div>

      {/* Insight chips */}
      {eda && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InsightChip label="Unique Senders" value={eda.totals.unique_senders.toLocaleString()} />
          <InsightChip label="Read Rate" value={`${eda.totals.read_rate}%`} />
          <InsightChip label="Peak Day" value={peakDow.day} />
          <InsightChip label="Peak Hour" value={peakHourLabel} />
        </div>
      )}

      {/* Volume by Month */}
      {chartData?.length > 0 && (
        <div className="p-6" style={{ border: '1px solid var(--border)' }}>
          <SectionLabel>Volume by Month</SectionLabel>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barCategoryGap="35%">
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="count" fill="var(--accent)" opacity={0.75} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Activity Patterns: Day of Week + Hour of Day */}
      {eda && (
        <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 3fr' }}>
          {/* Day of Week */}
          <div className="p-6" style={{ border: '1px solid var(--border)' }}>
            <SectionLabel>Day of Week</SectionLabel>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={eda.day_of_week} barCategoryGap="25%">
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {eda.day_of_week.map((d) => (
                    <Cell key={d.day} fill={d.day === peakDow.day ? 'var(--accent)' : 'rgba(0,200,240,0.3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Hour of Day */}
          <div className="p-6" style={{ border: '1px solid var(--border)' }}>
            <SectionLabel>Hour of Day</SectionLabel>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={eda.hour_of_day} barCategoryGap="10%">
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(h) => h % 6 === 0 ? fmtHour(h) : ''}
                />
                <YAxis hide />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="px-3 py-2 text-[11px]" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <p className="text-base-300 mb-1">{fmtHour(payload[0].payload.hour)}</p>
                        <p style={{ color: 'var(--accent)' }}>{payload[0].value.toLocaleString()} emails</p>
                      </div>
                    ) : null
                  }
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Bar dataKey="count" radius={[1, 1, 0, 0]}>
                  {eda.hour_of_day.map((d) => (
                    <Cell key={d.hour} fill={d.hour === peakHour.hour ? 'var(--accent)' : 'rgba(0,200,240,0.3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      <div className="p-6" style={{ border: '1px solid var(--border)' }}>
        <SectionLabel>Category Breakdown</SectionLabel>
        {!(eda?.category_stats?.length || data?.categories?.length) ? (
          <p className="text-[11px] text-base-400">Run categorization from the Sync page to see breakdown.</p>
        ) : (
          <div className="space-y-2.5">
            {(eda?.category_stats ?? data?.categories ?? []).map(({ category, count, unread, unread_pct, with_attachments }) => {
              const max = (eda?.category_stats ?? data?.categories ?? [])[0]?.count || 1
              const color = CATEGORY_COLORS[category] || '#aaa'
              return (
                <div
                  key={category}
                  className="grid items-center gap-4 cursor-pointer group"
                  style={{ gridTemplateColumns: '160px 1fr 70px 52px 52px' }}
                  onClick={() => navigate(`/browse?category=${encodeURIComponent(category)}`)}
                >
                  <span className="text-[11px] truncate" style={{ color }}>{category}</span>
                  <div className="h-px relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="absolute inset-y-0 left-0 h-full transition-all duration-500"
                      style={{ width: `${(count / max) * 100}%`, background: `${color}55` }}
                    />
                  </div>
                  <span className="text-[11px] text-base-400 tabular-nums text-right">{count.toLocaleString()}</span>
                  <span className="text-[10px] tabular-nums text-right" style={{ color: unread_pct > 30 ? 'var(--warn)' : 'var(--base-600)' }}>
                    {unread_pct != null ? `${unread_pct}%` : ''}
                  </span>
                  <span className="text-[10px] text-base-400 tabular-nums text-right">
                    {with_attachments > 0 ? with_attachments.toLocaleString() : ''}
                  </span>
                </div>
              )
            })}
            <div className="grid gap-4 pt-1" style={{ gridTemplateColumns: '160px 1fr 70px 52px 52px' }}>
              <span />
              <span />
              <span className="text-[10px] text-right text-base-400 tracking-wider uppercase">Total</span>
              <span className="text-[10px] text-right text-base-400 tracking-wider uppercase">Unread%</span>
              <span className="text-[10px] text-right text-base-400 tracking-wider uppercase">Attach</span>
            </div>
          </div>
        )}
      </div>

      {/* Top Senders */}
      {eda?.top_senders?.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <TopSenderList
            title="By Volume"
            senders={eda.top_senders}
            valueKey="count"
            navigate={navigate}
          />
          <TopSenderList
            title="Most Unread"
            senders={[...eda.top_senders].sort((a, b) => b.unread - a.unread).filter((s) => s.unread > 0)}
            valueKey="unread"
            navigate={navigate}
          />
        </div>
      )}

      {/* Analytics Explorer */}
      {eda && (
        <div style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-0 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] tracking-[0.25em] uppercase text-base-400 px-6 py-3 border-r" style={{ borderColor: 'var(--border)' }}>
              Explorer
            </span>
            {EXPLORER_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setExplorerTab(tab)}
                className="px-5 py-3 text-[10px] tracking-[0.2em] uppercase transition-colors border-r"
                style={{
                  borderColor: 'var(--border)',
                  color: explorerTab === tab ? 'var(--accent)' : 'var(--base-500)',
                  background: explorerTab === tab ? 'rgba(0,200,240,0.04)' : 'transparent',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="p-6">
            {explorerTab === 'Domains' && <DomainsChart data={eda.domain_distribution} />}
            {explorerTab === 'Category Trends' && (
              <CategoryTrendsChart
                data={eda.monthly_by_category}
                keys={eda.category_trend_keys}
              />
            )}
            {explorerTab === 'Heatmap' && (
              <HeatmapChart heatmap={eda.heatmap} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TopSenderList({ title, senders, valueKey, navigate }) {
  const max = senders[0]?.[valueKey] || 1
  return (
    <div className="p-6" style={{ border: '1px solid var(--border)' }}>
      <SectionLabel>{title}</SectionLabel>
      <div className="space-y-2">
        {senders.slice(0, 10).map((s, i) => (
          <div
            key={s.sender}
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => navigate(`/browse?sender=${encodeURIComponent(s.sender)}`)}
          >
            <span className="text-[10px] text-base-400 tabular-nums w-4 flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0 relative h-5 flex items-center">
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{ width: `${(s[valueKey] / max) * 100}%`, background: 'rgba(0,200,240,0.1)' }}
              />
              <span className="relative text-[11px] text-base-300 truncate group-hover:text-base-100 transition-colors px-1">
                {s.sender}
              </span>
            </div>
            <span className="text-[11px] tabular-nums text-base-400 flex-shrink-0">
              {s[valueKey].toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DomainsChart({ data }) {
  if (!data?.length) return <p className="text-[11px] text-base-400">No domain data.</p>
  return (
    <>
      <SectionLabel>Top Sending Domains</SectionLabel>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" barCategoryGap="25%">
          <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="domain" width={140} tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="count" fill="var(--accent)" opacity={0.7} radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  )
}

function CategoryTrendsChart({ data, keys }) {
  if (!data?.length || !keys?.length) return <p className="text-[11px] text-base-400">Not enough data.</p>
  const formatted = data.map((d) => ({ ...d, period: fmtPeriod(d.period) }))
  return (
    <>
      <SectionLabel>Category Volume — Monthly</SectionLabel>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={formatted}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}
            labelStyle={{ color: '#aaa' }}
            itemStyle={{ fontFamily: 'JetBrains Mono' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono', paddingTop: 12 }}
            formatter={(v) => <span style={{ color: CATEGORY_COLORS[v] || '#aaa' }}>{v}</span>}
          />
          {keys.map((cat) => (
            <Line
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={CATEGORY_COLORS[cat] || '#888'}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

function HeatmapChart({ heatmap }) {
  if (!heatmap?.length) return <p className="text-[11px] text-base-400">No data.</p>
  const max = Math.max(...heatmap.flat(), 1)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return (
    <>
      <SectionLabel>Email Arrival — Day × Hour</SectionLabel>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 560 }}>
          {/* Hour labels */}
          <div className="flex mb-1" style={{ marginLeft: 36 }}>
            {hours.map((h) => (
              <div key={h} className="text-center text-base-400" style={{ width: 20, fontSize: 8, fontFamily: 'JetBrains Mono' }}>
                {h % 6 === 0 ? fmtHour(h) : ''}
              </div>
            ))}
          </div>
          {heatmap.map((row, dowIdx) => (
            <div key={dowIdx} className="flex items-center mb-0.5">
              <span className="text-right text-base-400 mr-2 flex-shrink-0" style={{ width: 28, fontSize: 9, fontFamily: 'JetBrains Mono' }}>
                {_DOW_LABELS[dowIdx]}
              </span>
              {row.map((count, h) => {
                const intensity = count / max
                return (
                  <div
                    key={h}
                    title={`${_DOW_LABELS[dowIdx]} ${fmtHour(h)} — ${count} emails`}
                    style={{
                      width: 20,
                      height: 16,
                      background: count === 0
                        ? 'rgba(255,255,255,0.03)'
                        : `rgba(0,200,240,${0.08 + intensity * 0.82})`,
                      borderRadius: 2,
                      marginRight: 0,
                    }}
                  />
                )
              })}
            </div>
          ))}
          {/* Color scale legend */}
          <div className="flex items-center gap-2 mt-3" style={{ marginLeft: 36 }}>
            <span className="text-base-400" style={{ fontSize: 9 }}>Low</span>
            <div className="flex">
              {[0.08, 0.25, 0.42, 0.59, 0.76, 0.9].map((op) => (
                <div key={op} style={{ width: 16, height: 8, background: `rgba(0,200,240,${op})`, borderRadius: 1 }} />
              ))}
            </div>
            <span className="text-base-400" style={{ fontSize: 9 }}>High</span>
          </div>
        </div>
      </div>
    </>
  )
}

const _DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
