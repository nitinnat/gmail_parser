import { useState } from 'react'
import EmailRow from '../components/EmailRow'
import { api } from '../api'
import { ALL_CATEGORIES, CATEGORY_COLORS } from '../categories'

const MODES = [
  { id: 'hybrid',   label: 'Hybrid',   desc: 'Semantic + fulltext (recommended)' },
  { id: 'semantic', label: 'Semantic',  desc: 'Vector similarity search' },
  { id: 'fulltext', label: 'Fulltext',  desc: 'Substring match' },
]

export default function Search({ onOpenEmail }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [category, setCategory] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    const params = { search: query, mode, limit: 20 }
    if (category) params.category = category
    const data = await api.emails.list(params)
    setResults(data.emails || [])
    setSearched(true)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Semantic Search</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Search</h2>
      </div>

      {/* Query input */}
      <div
        className="flex items-stretch mb-5"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <span className="flex items-center px-4 text-[13px] text-base-400" style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          ›_
        </span>
        <input
          type="text"
          placeholder="Query your inbox…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          className="flex-1 bg-transparent px-4 py-3.5 text-[13px] text-base-50 placeholder-base-400 focus:outline-none"
        />
        <button
          onClick={search}
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
          {loading ? '…' : 'Run'}
        </button>
      </div>

      {/* Mode selector + category filter */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex gap-2">
          {MODES.map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              title={desc}
              className="px-4 py-2 text-[11px] tracking-wider uppercase transition-all duration-150"
              style={{
                border: `1px solid ${mode === id ? 'rgba(0,200,240,0.5)' : 'rgba(255,255,255,0.07)'}`,
                color:  mode === id ? 'var(--accent)' : '#aaa',
                background: mode === id ? 'rgba(0,200,240,0.07)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-transparent text-[11px] px-3 py-2 tracking-wider cursor-pointer transition-colors"
          style={{
            border: '1px solid rgba(255,255,255,0.07)',
            color: category ? (CATEGORY_COLORS[category] || 'var(--accent)') : '#aaaaaa',
          }}
        >
          <option value="" style={{ background: '#111', color: '#888' }}>All categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c} style={{ background: '#111', color: CATEGORY_COLORS[c] || '#ccc' }}>{c}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      {loading && (
        <p className="text-[12px] text-base-400">Searching<span className="blink">_</span></p>
      )}

      {searched && !loading && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-base-400 mb-3">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          <div style={{ border: '1px solid var(--border)' }}>
            {results.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[11px] tracking-[0.2em] uppercase text-base-400">No results found</p>
              </div>
            ) : (
              results.map((email) => (
                <div key={email.id} className="relative" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <EmailRow email={email} onOpen={onOpenEmail} />
                  {email.score !== undefined && (
                    <span
                      className="absolute right-3 top-3 text-[10px] tabular-nums"
                      style={{ color: 'rgba(0,200,240,0.5)' }}
                    >
                      {email.score.toFixed(3)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
