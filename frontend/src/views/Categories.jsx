import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

function SenderRow({ sender, count, lastDate, currentCategory, onAssign, saving }) {
  const [open, setOpen] = useState(false)
  const color = CATEGORY_COLORS[currentCategory] || '#aaa'

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-[11px] transition-colors duration-100"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span className="flex-1 truncate text-base-300 font-mono">{sender}</span>
      <span className="text-base-400 tabular-nums w-10 text-right flex-shrink-0">{count.toLocaleString()}</span>
      <span className="text-base-400 tabular-nums w-20 text-right flex-shrink-0 hidden md:block">
        {lastDate ? new Date(lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
      </span>
      <div className="flex-shrink-0 relative">
        {saving ? (
          <span className="text-[10px] text-base-400 px-2">saving…</span>
        ) : (
          <select
            value={currentCategory}
            onChange={(e) => { onAssign(sender, e.target.value); setOpen(false) }}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent text-[10px] px-2 py-1 cursor-pointer tracking-wide"
            style={{
              border: `1px solid ${color}33`,
              color,
              background: `${color}0d`,
            }}
          >
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c} style={{ background: '#111', color: CATEGORY_COLORS[c] || '#ccc' }}>{c}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function CategorySection({ category, count, senders, onAssign, saving, search, expanded, onToggle }) {
  const color = CATEGORY_COLORS[category] || '#aaa'

  const filtered = useMemo(() => {
    if (!search) return senders
    const q = search.toLowerCase()
    return senders.filter((s) => s.sender.toLowerCase().includes(q))
  }, [senders, search])

  if (search && filtered.length === 0) return null

  return (
    <div style={{ border: '1px solid var(--border)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-4 px-5 py-3.5 cursor-pointer select-none transition-colors duration-100"
        style={{ background: expanded ? `${color}08` : 'transparent' }}
        onClick={onToggle}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[11px] tracking-[0.15em] uppercase font-600 flex-1" style={{ color }}>{category}</span>
        <span className="text-[11px] text-base-400 tabular-nums">{count.toLocaleString()} emails</span>
        <span className="text-[10px] text-base-400 tabular-nums">{senders.length} senders</span>
        <span className="text-base-400 text-[10px] ml-1">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Senders */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Column headers */}
          <div
            className="flex items-center gap-3 px-4 py-1.5"
            style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <span className="flex-1 text-[9px] tracking-[0.2em] uppercase text-base-400">Sender</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-10 text-right">Emails</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-20 text-right hidden md:block">Last Seen</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-28 flex-shrink-0">Category</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-4 text-[11px] text-base-400">No senders match filter</p>
          ) : (
            filtered.map((s) => (
              <SenderRow
                key={s.sender}
                sender={s.sender}
                count={s.count}
                lastDate={s.last_date}
                currentCategory={category}
                onAssign={onAssign}
                saving={saving === s.sender}
              />
            ))
          )}
          {senders.length > filtered.length && !search && (
            <p className="px-4 py-2 text-[10px] text-base-400">
              Showing top {filtered.length} senders
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function Categories() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const [saving, setSaving] = useState(null)  // sender string being saved
  const navigate = useNavigate()

  const load = () => {
    setLoading(true)
    api.categories.list().then((d) => { setData(d); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const toggle = (cat) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  const handleAssign = async (sender, newCategory) => {
    setSaving(sender)
    await api.categories.assign(sender, newCategory)
    // Re-fetch so counts and groupings are accurate
    const fresh = await api.categories.list()
    setData(fresh)
    setExpanded((prev) => new Set([...prev, newCategory]))
    setSaving(null)
  }

  const totalEmails = data.reduce((sum, c) => sum + c.count, 0)
  const searchActive = search.trim().length > 0

  return (
    <div className="max-w-4xl space-y-7">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Local Labels</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Categories</h2>
      </div>

      {/* Stats + search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1">
          <p className="text-[11px] text-base-400">
            <span className="text-base-200 tabular-nums">{totalEmails.toLocaleString()}</span> emails across{' '}
            <span className="text-base-200 tabular-nums">{data.length}</span> categories
            {' · '}
            <span className="text-base-400">click a category to expand senders</span>
          </p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Filter senders…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (e.target.value) setExpanded(new Set(ALL_CATEGORIES))
            }}
            className="bg-transparent text-[12px] text-base-100 placeholder-base-600 px-3 py-2"
            style={{ border: '1px solid rgba(255,255,255,0.08)', minWidth: 220 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setExpanded(new Set()) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-base-400 hover:text-base-200 text-[12px]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category list */}
      {loading ? (
        <p className="text-[12px] text-base-400 py-8">Loading<span className="blink">_</span></p>
      ) : (
        <div className="space-y-2">
          {data.map(({ category, count, senders }) => (
            <CategorySection
              key={category}
              category={category}
              count={count}
              senders={senders}
              onAssign={handleAssign}
              saving={saving}
              search={searchActive ? search : ''}
              expanded={expanded.has(category)}
              onToggle={() => toggle(category)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
