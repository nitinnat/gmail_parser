import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

const GRID = '32px 1fr 80px 64px 90px 80px 150px 120px'

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
  const [senders, setSenders] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.analytics.senders(200).then((d) => { setSenders(d); setLoading(false) })
  }, [])

  const trashSender = async (sender) => {
    const preview = await api.actions.preview.trashSender(sender)
    if (!confirm(`Trash ${preview.would_trash} email(s) from:\n${sender}\n\nThis cannot be undone.`)) return
    await api.actions.trashSender(sender)
    setSenders((prev) => prev.filter((s) => s.sender !== sender))
  }

  const updateCategory = (sender, category) => {
    setSenders((prev) => prev.map((s) => s.sender === sender ? { ...s, category } : s))
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Inbox Analysis</p>
        <div className="flex items-baseline gap-4">
          <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Senders</h2>
          {!loading && (
            <span className="text-base-400 text-[13px] tabular-nums">
              {senders.length.toLocaleString()} unique
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>
      ) : (
        <div style={{ border: '1px solid var(--border)' }} className="overflow-x-auto">
          <div style={{ minWidth: '680px' }}>
            <div
              className="grid text-[10px] tracking-[0.2em] uppercase text-base-400 px-4 py-2.5"
              style={{
                gridTemplateColumns: GRID,
                borderBottom: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)',
              }}
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
      )}
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
