import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

const GRID = '32px 1fr 80px 64px 90px 80px 150px 120px'
const SUB_GRID = '32px 1fr 80px 64px 90px 80px 120px'

function SubBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider uppercase"
      style={{ color: 'var(--warn)', border: '1px solid rgba(232,160,0,0.35)', background: 'rgba(232,160,0,0.07)' }}
    >
      ◆ Sub
    </span>
  )
}

export default function Senders() {
  const [tab, setTab] = useState('all')
  const [senders, setSenders] = useState([])
  const [subs, setSubs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [subsLoading, setSubsLoading] = useState(false)
  const [trashingAll, setTrashingAll] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.analytics.senders(200).then((d) => { setSenders(d); setLoading(false) })
  }, [])

  useEffect(() => {
    if (tab === 'subs' && subs === null) {
      setSubsLoading(true)
      api.analytics.subscriptions().then((d) => { setSubs(d); setSubsLoading(false) })
    }
  }, [tab, subs])

  const trashSender = async (sender) => {
    const preview = await api.actions.preview.trashSender(sender)
    if (!confirm(`Trash ${preview.would_trash} email(s) from:\n${sender}\n\nThis cannot be undone.`)) return
    await api.actions.trashSender(sender)
    setSenders((prev) => prev.filter((s) => s.sender !== sender))
    setSubs((prev) => prev ? prev.filter((s) => s.sender !== sender) : prev)
  }

  const trashAll = async () => {
    const list = subs || []
    const total = list.reduce((acc, s) => acc + s.count, 0)
    if (!confirm(`Permanently trash emails from all ${list.length} subscription senders?\n\n${total.toLocaleString()} emails total.\n\nThis cannot be undone.`)) return
    setTrashingAll(true)
    for (const s of list) await api.actions.trashSender(s.sender)
    setSubs([])
    setTrashingAll(false)
  }

  const updateCategory = (sender, category) => {
    setSenders((prev) => prev.map((s) => s.sender === sender ? { ...s, category } : s))
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Inbox Analysis</p>
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Senders</h2>
            {!loading && tab === 'all' && (
              <span className="text-base-400 text-[13px] tabular-nums">{senders.length.toLocaleString()} unique</span>
            )}
            {tab === 'subs' && subs && (
              <span className="text-base-400 text-[13px] tabular-nums">{subs.length} senders</span>
            )}
          </div>
          {tab === 'subs' && subs && subs.length > 0 && (
            <button
              onClick={trashAll}
              disabled={trashingAll}
              className="px-5 py-2.5 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-50"
              style={{ color: 'var(--danger)', border: '1px solid rgba(255,59,59,0.4)', background: 'rgba(255,59,59,0.06)' }}
              onMouseEnter={(e) => { if (!trashingAll) e.currentTarget.style.background = 'rgba(255,59,59,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,59,59,0.06)' }}
            >
              {trashingAll ? 'Trashing…' : `Trash All ${subs.length}`}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--border)' }}>
        {['all', 'subs'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase transition-colors"
            style={{
              color: tab === t ? 'var(--base-50)' : 'var(--base-400)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'all' ? 'All Senders' : 'Subscriptions'}
          </button>
        ))}
      </div>

      {tab === 'all' && (
        loading ? (
          <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>
        ) : (
          <div style={{ border: '1px solid var(--border)' }} className="overflow-x-auto">
            <div style={{ minWidth: '680px' }}>
              <div
                className="grid text-[10px] tracking-[0.2em] uppercase text-base-400 px-4 py-2.5"
                style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
              >
                <span>#</span>
                <span>Sender</span>
                <span className="text-right">Emails</span>
                <span className="text-right">Unread</span>
                <span className="pl-3">Last Seen</span>
                <span>Type</span>
                <span>Category</span>
                <span />
              </div>
              {senders.map((s, i) => (
                <SenderRow
                  key={s.sender}
                  s={s}
                  i={i}
                  onTrash={() => trashSender(s.sender)}
                  onView={() => navigate(`/browse?sender=${encodeURIComponent(s.sender)}`)}
                  onCategoryChange={(cat) => updateCategory(s.sender, cat)}
                />
              ))}
            </div>
          </div>
        )
      )}

      {tab === 'subs' && (
        subsLoading || subs === null ? (
          <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>
        ) : subs.length === 0 ? (
          <div className="py-16 text-center" style={{ border: '1px solid var(--border)' }}>
            <p className="text-[11px] tracking-[0.2em] uppercase text-base-400">No subscriptions detected</p>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)' }} className="overflow-x-auto">
            <div style={{ minWidth: '580px' }}>
              <div
                className="grid text-[10px] tracking-[0.2em] uppercase text-base-400 px-4 py-2.5"
                style={{ gridTemplateColumns: SUB_GRID, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
              >
                <span>#</span>
                <span>Sender</span>
                <span className="text-right">Emails</span>
                <span className="text-right">Unread</span>
                <span className="pl-3">Last Seen</span>
                <span>Confirmed</span>
                <span />
              </div>
              {subs.map((s, i) => (
                <SubRow
                  key={s.sender}
                  s={s}
                  i={i}
                  onTrash={() => trashSender(s.sender)}
                  onView={() => navigate(`/browse?sender=${encodeURIComponent(s.sender)}`)}
                />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

function SubRow({ s, i, onTrash, onView }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className="grid items-center px-4 py-3 transition-colors duration-100 text-[12px]"
      style={{
        gridTemplateColumns: SUB_GRID,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: hover ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="text-[11px] text-base-400 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
      <span className="truncate pr-4 text-base-100" title={s.sender}>{s.sender}</span>
      <span className="text-right tabular-nums text-base-300">{s.count.toLocaleString()}</span>
      <span className={`text-right tabular-nums ${s.unread_count > 0 ? 'text-accent' : 'text-base-400'}`}>{s.unread_count}</span>
      <span className="text-[11px] text-base-400 pl-3">
        {s.last_date ? new Date(s.last_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
      </span>
      <span>
        {s.has_list_unsubscribe && (
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--ok)' }}>✓ header</span>
        )}
      </span>
      <span className={`flex gap-4 justify-end transition-opacity duration-100 ${hover ? 'opacity-100' : 'opacity-0'}`}>
        <button onClick={onView} className="text-[11px] tracking-wider uppercase" style={{ color: 'var(--accent)' }}>View</button>
        <button onClick={onTrash} className="text-[11px] tracking-wider uppercase" style={{ color: 'var(--danger)' }}>Trash</button>
      </span>
    </div>
  )
}

function SenderRow({ s, i, onTrash, onView, onCategoryChange }) {
  const [hover, setHover] = useState(false)
  const [category, setCategory] = useState(s.category || 'Other')
  const [saving, setSaving] = useState(false)

  const handleCategoryChange = async (e) => {
    const val = e.target.value
    setCategory(val)
    onCategoryChange(val)
    setSaving(true)
    await api.categories.assign(s.sender, val)
    setSaving(false)
  }

  const color = CATEGORY_COLORS[category] || '#aaaaaa'

  return (
    <div
      className="grid items-center px-4 py-3 transition-colors duration-100 text-[12px]"
      style={{
        gridTemplateColumns: GRID,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: hover ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="text-[11px] text-base-400 tabular-nums">{String(i + 1).padStart(2, '0')}</span>

      <span className="truncate pr-4 text-base-100" title={s.sender}>{s.sender}</span>

      <span className="text-right tabular-nums text-base-300">{s.count.toLocaleString()}</span>

      <span className={`text-right tabular-nums ${s.unread_count > 0 ? 'text-accent' : 'text-base-400'}`}>
        {s.unread_count}
      </span>

      <span className="text-[11px] text-base-400 pl-3">
        {s.last_date ? new Date(s.last_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
      </span>

      <span>{s.is_subscription && <SubBadge />}</span>

      <span>
        <select
          value={category}
          onChange={handleCategoryChange}
          disabled={saving}
          className="bg-transparent border-0 outline-none cursor-pointer text-[11px] w-full truncate"
          style={{ color, opacity: saving ? 0.5 : 1 }}
        >
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} style={{ color: CATEGORY_COLORS[cat], background: '#111' }}>
              {cat}
            </option>
          ))}
        </select>
      </span>

      <span className={`flex gap-4 justify-end transition-opacity duration-100 ${hover ? 'opacity-100' : 'opacity-0'}`}>
        <button
          onClick={onView}
          className="text-[11px] tracking-wider uppercase transition-colors duration-100"
          style={{ color: 'var(--accent)' }}
        >
          View
        </button>
        <button
          onClick={onTrash}
          className="text-[11px] tracking-wider uppercase transition-colors duration-100"
          style={{ color: 'var(--danger)' }}
        >
          Trash
        </button>
      </span>
    </div>
  )
}
