import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Email row ─────────────────────────────────────────────────────────────────

function EmailLine({ email, onMarkRead }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className="flex items-center gap-3 pl-8 pr-4 py-2 text-[11px] transition-colors duration-75"
      style={{
        borderTop: '1px solid rgba(255,255,255,0.03)',
        background: hover ? 'rgba(255,255,255,0.015)' : 'transparent',
        opacity: email.is_read ? 0.5 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: 'var(--accent)', opacity: email.is_read ? 0 : 1 }}
      />
      <a
        href={`https://mail.google.com/mail/#all/${email.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 truncate hover:underline"
        style={{ color: email.is_read ? 'var(--base-300)' : 'var(--base-100)' }}
        title={email.subject}
      >
        {email.subject || '(no subject)'}
      </a>
      <span className="text-base-300 text-[10px] flex-shrink-0 tabular-nums">{fmtDate(email.date)}</span>
      <span className={`flex-shrink-0 w-8 flex justify-end transition-opacity ${hover && !email.is_read ? 'opacity-100' : 'opacity-0'}`}>
        <button
          onClick={() => onMarkRead(email.id)}
          className="text-[10px] tracking-wider uppercase"
          style={{ color: 'var(--accent)' }}
        >
          ✓
        </button>
      </span>
    </div>
  )
}

// ── Sender group ──────────────────────────────────────────────────────────────

function SenderGroup({ rule, emails, onUpdateNote, onRemove, onMarkRead }) {
  const [note, setNote] = useState(rule.note || '')
  const [collapsed, setCollapsed] = useState(false)

  const saveNote = () => {
    if (note !== (rule.note || '')) onUpdateNote(rule.sender, note)
  }

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      {/* Sender header */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-[10px] text-base-400 flex-shrink-0 w-3"
        >
          {collapsed ? '▶' : '▼'}
        </button>

        <span className="font-mono text-[11px] text-base-100 flex-shrink-0">{rule.sender}</span>

        <span className="text-base-400 text-[10px] flex-shrink-0 tabular-nums">
          {emails.length} {emails.length === 1 ? 'email' : 'emails'}
        </span>

        {/* Note input */}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="add note…"
          className="flex-1 min-w-0 bg-transparent text-[10px] text-base-300 placeholder-base-600
                     focus:outline-none italic"
          style={{ borderBottom: '1px solid transparent' }}
          onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.15)' }}
          onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; saveNote() }}
        />

        <button
          onClick={() => onRemove(rule.sender)}
          className="text-base-400 hover:text-base-100 flex-shrink-0 text-[13px] leading-none ml-1"
          title="Remove from watchlist"
        >
          ×
        </button>
      </div>

      {/* Emails */}
      {!collapsed && emails.map((e) => (
        <EmailLine key={e.id} email={e} onMarkRead={onMarkRead} />
      ))}
    </div>
  )
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({ category, senderRules, emailsBySender, onUpdateNote, onRemove, onMarkRead }) {
  const color = CATEGORY_COLORS[category] || '#aaa'
  const [collapsed, setCollapsed] = useState(false)

  const totalEmails = senderRules.reduce((sum, r) => sum + (emailsBySender[r.sender]?.length ?? 0), 0)
  const unread = senderRules.reduce(
    (sum, r) => sum + (emailsBySender[r.sender] ?? []).filter((e) => !e.is_read).length,
    0,
  )

  return (
    <div style={{ border: '1px solid var(--border)', marginBottom: 0 }}>
      {/* Category header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors duration-100"
        style={{ background: collapsed ? 'transparent' : `${color}08` }}
        onClick={() => setCollapsed((c) => !c)}
        onMouseEnter={(e) => { if (collapsed) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
        onMouseLeave={(e) => { if (collapsed) e.currentTarget.style.background = 'transparent' }}
      >
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[11px] tracking-[0.15em] uppercase font-600 flex-1" style={{ color }}>
          {category}
        </span>
        <span className="text-[10px] text-base-400 tabular-nums">
          {totalEmails} emails
          {unread > 0 && (
            <span className="ml-2" style={{ color: 'var(--accent)' }}>{unread} unread</span>
          )}
        </span>
        <span className="text-[10px] text-base-400 ml-2">{collapsed ? '▶' : '▼'}</span>
      </div>

      {/* Sender groups */}
      {!collapsed && senderRules.map((rule) => (
        <SenderGroup
          key={rule.sender}
          rule={rule}
          emails={emailsBySender[rule.sender] ?? []}
          onUpdateNote={onUpdateNote}
          onRemove={onRemove}
          onMarkRead={onMarkRead}
        />
      ))}
    </div>
  )
}

// ── Add sender ────────────────────────────────────────────────────────────────

function AddSender({ allSenders, pinned, onAdd }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const suggestions = query.trim()
    ? allSenders.filter((s) => s.toLowerCase().includes(query.toLowerCase()) && !pinned.includes(s)).slice(0, 10)
    : []

  const select = (sender) => { onAdd(sender); setQuery(''); setOpen(false) }

  return (
    <div ref={ref} className="relative">
      <div
        className="flex items-center gap-2"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <span className="px-3 text-[12px] text-base-400">+</span>
        <input
          type="text"
          placeholder="Add sender to watchlist…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) select(query.trim())
            if (e.key === 'Escape') setOpen(false)
          }}
          className="flex-1 bg-transparent py-2.5 text-[12px] text-base-100 placeholder-base-500 focus:outline-none pr-3"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-50 left-0 right-0 top-full mt-px max-h-52 overflow-y-auto"
          style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              onMouseDown={() => select(s)}
              className="block w-full text-left px-3 py-2 text-[11px] font-mono text-base-200 hover:bg-white/5 truncate"
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

export default function Alerts() {
  const [rules, setRules] = useState({ senders: [] })
  const [feed, setFeed] = useState([])
  const [allSenders, setAllSenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadAll = (rulesData) =>
    api.alerts.feed().then((f) => { setFeed(f); if (rulesData) setRules(rulesData) })

  useEffect(() => {
    Promise.all([api.alerts.getRules(), api.alerts.feed(), api.analytics.senders(1000)]).then(
      ([r, f, s]) => {
        setRules(r)
        setFeed(f)
        setAllSenders(s.map((x) => x.sender))
        setLoading(false)
      },
    )
  }, [])

  const saveRules = async (next, refetchFeed = false) => {
    setSaving(true)
    const saved = await api.alerts.setRules(next)
    setRules(saved)
    if (refetchFeed) {
      const fresh = await api.alerts.feed()
      setFeed(fresh)
    }
    setSaving(false)
  }

  const addSender = (sender) => {
    if (rules.senders.some((s) => s.sender === sender)) return
    saveRules({ senders: [...rules.senders, { sender, note: '' }] }, true)
  }

  const removeSender = (sender) =>
    saveRules({ senders: rules.senders.filter((s) => s.sender !== sender) }, true)

  const updateNote = (sender, note) =>
    saveRules({ senders: rules.senders.map((s) => (s.sender === sender ? { ...s, note } : s)) })

  const markRead = async (id) => {
    await api.actions.markRead([id])
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, is_read: true } : e)))
  }

  // Group feed: category → sender → emails
  const grouped = useMemo(() => {
    const bySender = {}
    for (const email of feed) {
      const cat = email.category || 'Other'
      const s = email.sender
      if (!bySender[cat]) bySender[cat] = {}
      if (!bySender[cat][s]) bySender[cat][s] = []
      bySender[cat][s].push(email)
    }
    return bySender
  }, [feed])

  // Build per-category sender lists from active rules
  const categorySections = useMemo(() => {
    const sections = {}
    for (const rule of rules.senders) {
      for (const [cat, senderMap] of Object.entries(grouped)) {
        if (senderMap[rule.sender]) {
          if (!sections[cat]) sections[cat] = []
          if (!sections[cat].find((r) => r.sender === rule.sender)) sections[cat].push(rule)
        }
      }
    }
    return sections
  }, [rules.senders, grouped])

  // Watched senders with no emails in the current feed
  const sendersWithEmails = useMemo(() => new Set(feed.map((e) => e.sender)), [feed])
  const watchedNoEmails = rules.senders.filter((r) => !sendersWithEmails.has(r.sender))

  const pinnedSenders = rules.senders.map((r) => r.sender)
  const totalUnread = feed.filter((e) => !e.is_read).length

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-7">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Curated Feed</p>
        <div className="flex items-baseline gap-4">
          <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Alerts</h2>
          {!loading && rules.senders.length > 0 && (
            <span className="text-base-300 text-[13px] tabular-nums">
              {feed.length} emails · {totalUnread} unread · {rules.senders.length} senders watched
              {saving && <span className="ml-3 text-base-400">saving…</span>}
            </span>
          )}
        </div>
      </div>

      {/* Add sender */}
      <div className="mb-6">
        <AddSender allSenders={allSenders} pinned={pinnedSenders} onAdd={addSender} />
      </div>

      {loading ? (
        <p className="text-[12px] text-base-400">Loading<span className="blink">_</span></p>
      ) : rules.senders.length === 0 ? (
        <div className="py-16 text-center" style={{ border: '1px solid var(--border)' }}>
          <p className="text-base-200 text-[12px] tracking-wider uppercase mb-2">Watchlist is empty</p>
          <p className="text-base-400 text-[11px]">
            Type a sender address above to add them to your alerts feed.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Category sections */}
          {Object.keys(categorySections)
            .sort()
            .map((cat) => (
              <CategorySection
                key={cat}
                category={cat}
                senderRules={categorySections[cat]}
                emailsBySender={grouped[cat] ?? {}}
                onUpdateNote={updateNote}
                onRemove={removeSender}
                onMarkRead={markRead}
              />
            ))}

          {/* Watched senders with no emails */}
          {watchedNoEmails.length > 0 && (
            <div style={{ border: '1px solid var(--border)' }}>
              <div className="px-4 py-3">
                <p className="text-[9px] tracking-[0.2em] uppercase text-base-400 mb-2">
                  Watching · No emails found
                </p>
                <div className="space-y-1">
                  {watchedNoEmails.map((rule) => (
                    <div key={rule.sender} className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-base-300 flex-1">{rule.sender}</span>
                      {rule.note && (
                        <span className="text-[10px] text-base-400 italic">{rule.note}</span>
                      )}
                      <button
                        onClick={() => removeSender(rule.sender)}
                        className="text-base-400 hover:text-base-100 text-[13px] leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
