import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import EmailRow from '../components/EmailRow'
import BulkActionBar from '../components/BulkActionBar'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

const MODES = [
  { id: 'hybrid',   label: 'Hybrid',   desc: 'Semantic + fulltext (recommended)' },
  { id: 'semantic', label: 'Semantic',  desc: 'Vector similarity search' },
  { id: 'fulltext', label: 'Fulltext',  desc: 'Substring match' },
]

function FilterInput({ placeholder, value, onChange }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent text-[12px] text-base-100 placeholder-base-500 px-3 py-2 transition-colors duration-100"
      style={{ border: '1px solid rgba(255,255,255,0.08)', minWidth: 0 }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
    />
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-base-400 hover:text-base-200 transition-colors duration-100">
      <span
        className="w-7 h-4 relative flex-shrink-0 transition-colors duration-150"
        style={{ background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.1)', borderRadius: 999 }}
        onClick={() => onChange(!checked)}
      >
        <span
          className="absolute top-0.5 transition-all duration-150"
          style={{
            left: checked ? 'calc(100% - 14px)' : 2,
            width: 12, height: 12, borderRadius: '50%',
            background: checked ? '#000' : '#aaa',
          }}
        />
      </span>
      <span className="tracking-wider uppercase">{label}</span>
    </label>
  )
}

export default function Browse() {
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [emails, setEmails] = useState([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [filters, setFilters] = useState({
    sender: searchParams.get('sender') || '',
    label: '',
    category: searchParams.get('category') || '',
    unread: false,
    starred: false,
  })
  const [applied, setApplied] = useState(filters)

  const isSearchMode = searchQuery.trim().length > 0

  const fetchEmails = useCallback(async () => {
    setLoading(true)
    let params
    if (isSearchMode) {
      params = { search: searchQuery, mode, limit: 50 }
      if (applied.category) params.category = applied.category
    } else {
      params = { page, limit: 50 }
      if (applied.sender)   params.sender   = applied.sender
      if (applied.label)    params.label    = applied.label
      if (applied.category) params.category = applied.category
      if (applied.unread)   params.unread   = true
      if (applied.starred)  params.starred  = true
    }
    const data = await api.emails.list(params)
    setEmails(data.emails || [])
    setLoading(false)
  }, [page, applied, searchQuery, mode, isSearchMode])

  useEffect(() => { fetchEmails() }, [fetchEmails])

  const runSearch = () => {
    setApplied({ ...filters })
    setSelected(new Set())
    setSearchQuery(query.trim())
  }

  const clearSearch = () => {
    setQuery('')
    setSearchQuery('')
    setSelected(new Set())
  }

  const apply = () => { setPage(1); setApplied({ ...filters }); setSelected(new Set()) }
  const clear = () => {
    const empty = { sender: '', label: '', category: '', unread: false, starred: false }
    setFilters(empty)
    setPage(1)
    setApplied(empty)
    setSelected(new Set())
  }

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const handleTrash = async () => {
    await api.actions.trash([...selected])
    setEmails((prev) => prev.filter((e) => !selected.has(e.id)))
    setSelected(new Set())
  }

  const handleNoise = async (email, by) => {
    if (by === 'sender') {
      await api.categories.assign(email.metadata?.sender, 'Noise')
    } else {
      await api.categories.assignSubject(email.metadata?.subject, 'Noise')
    }
    setEmails((prev) => prev.filter((e) => e.id !== email.id))
  }

  const handleMarkRead = async () => {
    await api.actions.markRead([...selected])
    setEmails((prev) =>
      prev.map((e) => selected.has(e.id) ? { ...e, metadata: { ...e.metadata, is_read: true } } : e),
    )
    setSelected(new Set())
  }

  const hasFilters = isSearchMode
    ? !!applied.category
    : applied.sender || applied.label || applied.category || applied.unread || applied.starred

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Email Explorer</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Browse</h2>
      </div>

      {/* Search bar */}
      <div className="flex items-stretch mb-4" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
        <span
          className="flex items-center px-4 text-[13px] text-base-400"
          style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}
        >
          ›_
        </span>
        <input
          type="text"
          placeholder="Search your inbox… (Enter to run)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          className="flex-1 bg-transparent px-4 py-3 text-[13px] text-base-50 placeholder-base-400 focus:outline-none"
        />
        {isSearchMode && (
          <button
            onClick={clearSearch}
            className="px-4 text-[13px] text-base-400 hover:text-base-200 transition-colors"
            style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}
          >
            ×
          </button>
        )}
        <button
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="px-6 text-[11px] tracking-widest uppercase transition-colors duration-150 disabled:opacity-40"
          style={{
            color: 'var(--accent)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(0,200,240,0.06)',
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'rgba(0,200,240,0.1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,200,240,0.06)' }}
        >
          {loading && isSearchMode ? '…' : 'Search'}
        </button>
      </div>

      {/* Mode selector — search mode only */}
      {isSearchMode && (
        <div className="flex gap-2 mb-4">
          {MODES.map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              title={desc}
              className="px-4 py-2 text-[11px] tracking-wider uppercase transition-all duration-150"
              style={{
                border: `1px solid ${mode === id ? 'rgba(0,200,240,0.5)' : 'rgba(255,255,255,0.07)'}`,
                color: mode === id ? 'var(--accent)' : '#aaa',
                background: mode === id ? 'rgba(0,200,240,0.07)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div
        className="flex items-center gap-3 flex-wrap p-3 mb-4"
        style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}
      >
        {!isSearchMode && (
          <FilterInput
            placeholder="Sender…"
            value={filters.sender}
            onChange={(v) => setFilters((f) => ({ ...f, sender: v }))}
          />
        )}
        <select
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
          className="bg-transparent text-[12px] px-3 py-2 transition-colors duration-100 cursor-pointer"
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            color: filters.category ? (CATEGORY_COLORS[filters.category] || 'var(--accent)') : '#aaaaaa',
          }}
        >
          <option value="" style={{ background: '#111', color: '#aaaaaa' }}>All categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c} style={{ background: '#111', color: CATEGORY_COLORS[c] || '#dddddd' }}>{c}</option>
          ))}
        </select>
        {!isSearchMode && (
          <>
            <FilterInput
              placeholder="Label…"
              value={filters.label}
              onChange={(v) => setFilters((f) => ({ ...f, label: v }))}
            />
            <div className="flex items-center gap-5 px-2">
              <Toggle label="Unread"  checked={filters.unread}  onChange={(v) => setFilters((f) => ({ ...f, unread: v }))} />
              <Toggle label="Starred" checked={filters.starred} onChange={(v) => setFilters((f) => ({ ...f, starred: v }))} />
            </div>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {hasFilters && (
            <button
              onClick={clear}
              className="px-3 py-2 text-[11px] tracking-wider uppercase text-base-400 hover:text-base-200 transition-colors"
            >
              Clear
            </button>
          )}
          {!isSearchMode && (
            <button
              onClick={apply}
              className="px-4 py-2 text-[11px] tracking-widest uppercase transition-all duration-150"
              style={{ color: 'var(--accent)', border: '1px solid rgba(0,200,240,0.3)', background: 'rgba(0,200,240,0.06)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,200,240,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,200,240,0.06)'}
            >
              Apply
            </button>
          )}
        </div>
      </div>

      <BulkActionBar
        selectedIds={[...selected]}
        onTrash={handleTrash}
        onMarkRead={handleMarkRead}
        onClear={() => setSelected(new Set())}
      />

      {/* Email list */}
      {loading ? (
        <p className="py-8 text-[12px] text-base-400">
          {isSearchMode ? 'Searching' : 'Loading'}<span className="blink">_</span>
        </p>
      ) : (
        <div>
          {isSearchMode && (
            <p className="text-[10px] tracking-[0.2em] uppercase text-base-400 mb-3">
              {emails.length} {emails.length === 1 ? 'result' : 'results'}
            </p>
          )}
          <div style={{ border: '1px solid var(--border)' }}>
            {emails.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[11px] tracking-[0.2em] uppercase text-base-400">
                  {isSearchMode ? 'No results found' : 'No emails found'}
                </p>
              </div>
            ) : (
              emails.map((email) => (
                <div key={email.id} className="relative group" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <EmailRow email={email} checked={selected.has(email.id)} onCheck={toggleSelect} />
                  {isSearchMode && email.score !== undefined && (
                    <span
                      className="absolute right-3 top-3 text-[10px] tabular-nums"
                      style={{ color: 'rgba(0,200,240,0.5)' }}
                    >
                      {email.score.toFixed(3)}
                    </span>
                  )}
                  {/* Noise quick-actions */}
                  <div className="absolute right-3 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity duration-100 flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleNoise(email, 'sender') }}
                      title="Mark sender as Noise"
                      className="px-2 py-0.5 text-[9px] tracking-wider uppercase transition-colors duration-100"
                      style={{ border: '1px solid rgba(71,85,105,0.4)', color: '#64748b', background: 'rgba(71,85,105,0.08)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = 'rgba(71,85,105,0.7)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(71,85,105,0.4)' }}
                    >
                      ⊘ Sender
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleNoise(email, 'subject') }}
                      title="Mark this subject as Noise"
                      className="px-2 py-0.5 text-[9px] tracking-wider uppercase transition-colors duration-100"
                      style={{ border: '1px solid rgba(71,85,105,0.4)', color: '#64748b', background: 'rgba(71,85,105,0.08)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = 'rgba(71,85,105,0.7)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(71,85,105,0.4)' }}
                    >
                      ⊘ Subject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pagination — browse mode only */}
      {!isSearchMode && !loading && emails.length > 0 && (
        <div className="flex items-center justify-between mt-4 text-[11px] text-base-400">
          <span className="tabular-nums">Page {page}</span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => { setPage((p) => p - 1); setSelected(new Set()) }}
              className="px-4 py-2 tracking-wider uppercase transition-colors duration-100 disabled:opacity-30"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={(e) => { if (page > 1) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              ← Prev
            </button>
            <button
              disabled={emails.length < 50}
              onClick={() => { setPage((p) => p + 1); setSelected(new Set()) }}
              className="px-4 py-2 tracking-wider uppercase transition-colors duration-100 disabled:opacity-30"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={(e) => { if (emails.length >= 50) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
