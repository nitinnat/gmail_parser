import { useState, useEffect, useMemo } from 'react'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

const SYSTEM_COLORS = CATEGORY_COLORS

const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#eab308',
  '#f97316', '#06b6d4', '#ec4899', '#10b981', '#f59e0b',
  '#8b5cf6', '#14b8a6', '#f43f5e', '#84cc16', '#6366f1',
]

function useAllColors(customDefs) {
  return useMemo(
    () => ({ ...SYSTEM_COLORS, ...Object.fromEntries(customDefs.map((c) => [c.name, c.color])) }),
    [customDefs],
  )
}

function SenderRow({ sender, count, lastDate, currentCategory, allColors, allCategoryNames, onAssign, saving }) {
  const color = allColors[currentCategory] || '#aaa'
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
      <div className="flex-shrink-0">
        {saving ? (
          <span className="text-[10px] text-base-400 px-2">saving…</span>
        ) : (
          <select
            value={currentCategory}
            onChange={(e) => onAssign(sender, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent text-[10px] px-2 py-1 cursor-pointer tracking-wide"
            style={{ border: `1px solid ${color}33`, color, background: `${color}0d` }}
          >
            {allCategoryNames.map((c) => (
              <option key={c} value={c} style={{ background: '#111', color: allColors[c] || '#ccc' }}>{c}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function CategorySection({
  category, count, senders, subjectOverrides = [], isSystem, isNoise,
  allColors, allCategoryNames, onAssign, onRemoveOverride, onRename, onDelete,
  saving, search, expanded, onToggle,
}) {
  const color = allColors[category] || '#aaa'
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(category)

  const filteredSenders = useMemo(() => {
    if (!search) return senders
    const q = search.toLowerCase()
    return senders.filter((s) => s.sender.toLowerCase().includes(q))
  }, [senders, search])

  const filteredSubjects = useMemo(() => {
    if (!search) return subjectOverrides
    const q = search.toLowerCase()
    return subjectOverrides.filter((s) => s.toLowerCase().includes(q))
  }, [subjectOverrides, search])

  if (search && filteredSenders.length === 0 && filteredSubjects.length === 0) return null

  const submitRename = () => {
    if (newName.trim() && newName.trim() !== category) onRename(category, newName.trim())
    setRenaming(false)
  }

  return (
    <div style={{ border: `1px solid ${isNoise ? 'rgba(71,85,105,0.4)' : 'var(--border)'}` }}>
      {/* Header */}
      <div
        className="flex items-center gap-4 px-5 py-3.5 cursor-pointer select-none transition-colors duration-100"
        style={{ background: expanded ? `${color}08` : 'transparent' }}
        onClick={onToggle}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />

        {renaming ? (
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false) }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent text-[11px] tracking-[0.15em] uppercase font-600 focus:outline-none"
            style={{ color, borderBottom: `1px solid ${color}66` }}
          />
        ) : (
          <span className="text-[11px] tracking-[0.15em] uppercase font-600 flex-1" style={{ color }}>
            {category}
          </span>
        )}

        {isNoise && (
          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5" style={{ color: '#475569', border: '1px solid #47556933' }}>
            excluded from analytics
          </span>
        )}

        <span className="text-[11px] text-base-400 tabular-nums">{count.toLocaleString()} emails</span>
        <span className="text-[11px] text-base-400 tabular-nums">{senders.length} senders</span>
        {isNoise && subjectOverrides.length > 0 && (
          <span className="text-[11px] text-base-400 tabular-nums">{subjectOverrides.length} subjects</span>
        )}

        {!isSystem && !renaming && (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { setNewName(category); setRenaming(true) }}
              className="text-[10px] text-base-500 hover:text-base-300 transition-colors px-1"
              title="Rename"
            >
              ✎
            </button>
            <button
              onClick={() => onDelete(category)}
              className="text-[10px] text-base-500 hover:text-red-400 transition-colors px-1"
              title="Delete (emails → Other)"
            >
              ✕
            </button>
          </div>
        )}

        <span className="text-base-400 text-[10px] ml-1">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Subject overrides panel — Noise only */}
          {isNoise && filteredSubjects.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                className="px-4 py-1.5"
                style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <span className="text-[9px] tracking-[0.2em] uppercase text-base-400">Subject Overrides</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {filteredSubjects.map((subject) => (
                  <div
                    key={subject}
                    className="flex items-center gap-2 text-[10px] text-base-300 px-2 py-1"
                    style={{ border: '1px solid rgba(71,85,105,0.3)', background: 'rgba(71,85,105,0.08)' }}
                  >
                    <span className="truncate max-w-xs">{subject}</span>
                    <button
                      onClick={() => onRemoveOverride(null, subject)}
                      className="text-base-500 hover:text-base-200 transition-colors flex-shrink-0"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sender column headers */}
          <div
            className="flex items-center gap-3 px-4 py-1.5"
            style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <span className="flex-1 text-[9px] tracking-[0.2em] uppercase text-base-400">Sender</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-10 text-right">Emails</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-20 text-right hidden md:block">Last Seen</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-base-400 w-28 flex-shrink-0">Category</span>
          </div>
          {filteredSenders.length === 0 ? (
            <p className="px-4 py-4 text-[11px] text-base-400">No senders in this category</p>
          ) : (
            filteredSenders.map((s) => (
              <SenderRow
                key={s.sender}
                sender={s.sender}
                count={s.count}
                lastDate={s.last_date}
                currentCategory={category}
                allColors={allColors}
                allCategoryNames={allCategoryNames}
                onAssign={onAssign}
                saving={saving === s.sender}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function NewCategoryForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PALETTE[0])
  return (
    <div className="p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
      <p className="text-[10px] tracking-[0.2em] uppercase text-base-400">New Category</p>
      <div className="flex gap-3 flex-wrap items-center">
        <input
          autoFocus
          type="text"
          placeholder="Category name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), color)
            if (e.key === 'Escape') onCancel()
          }}
          className="bg-transparent text-[12px] text-base-100 placeholder-base-500 px-3 py-2 focus:outline-none"
          style={{ border: '1px solid rgba(255,255,255,0.12)', minWidth: 180 }}
        />
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-5 h-5 rounded-full transition-transform"
              style={{
                background: c,
                outline: color === c ? `2px solid ${c}` : 'none',
                outlineOffset: 2,
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-[11px] tracking-wider uppercase text-base-400 hover:text-base-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onSubmit(name.trim(), color)}
            disabled={!name.trim()}
            className="px-4 py-2 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-40"
            style={{ color: 'var(--accent)', border: '1px solid rgba(0,200,240,0.3)', background: 'rgba(0,200,240,0.06)' }}
          >
            Create
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <div className="w-3 h-3 rounded-full" style={{ background: color }} />
        <span style={{ color }}>{name || 'Preview'}</span>
      </div>
    </div>
  )
}

export default function Categories() {
  const [data, setData] = useState([])
  const [customDefs, setCustomDefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const [saving, setSaving] = useState(null)
  const [creating, setCreating] = useState(false)

  const allColors = useAllColors(customDefs)
  const allCategoryNames = useMemo(
    () => [...Object.keys(SYSTEM_COLORS), ...customDefs.map((c) => c.name)],
    [customDefs],
  )

  const load = async () => {
    setLoading(true)
    const [listData, customData] = await Promise.all([api.categories.list(), api.categories.custom()])
    setData(listData)
    setCustomDefs(customData)
    setLoading(false)
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
    const [fresh, customData] = await Promise.all([api.categories.list(), api.categories.custom()])
    setData(fresh)
    setCustomDefs(customData)
    setExpanded((prev) => new Set([...prev, newCategory]))
    setSaving(null)
  }

  const handleRemoveOverride = async (sender, subject) => {
    await api.categories.removeOverride(sender, subject)
    setData(await api.categories.list())
  }

  const handleCreate = async (name, color) => {
    await api.categories.create(name, color)
    setCreating(false)
    await load()
  }

  const handleRename = async (oldName, newName) => {
    await api.categories.rename(oldName, newName)
    await load()
  }

  const handleDelete = async (name) => {
    await api.categories.delete(name)
    await load()
  }

  const totalEmails = data.reduce((sum, c) => sum + c.count, 0)
  const searchActive = search.trim().length > 0

  return (
    <div className="max-w-4xl space-y-7">
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Local Labels</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Categories</h2>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1">
          <p className="text-[11px] text-base-400">
            <span className="text-base-200 tabular-nums">{totalEmails.toLocaleString()}</span> emails across{' '}
            <span className="text-base-200 tabular-nums">{data.length}</span> categories
            {' · '}
            <span className="text-base-400">click a category to expand senders</span>
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <input
              type="text"
              placeholder="Filter senders…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); if (e.target.value) setExpanded(new Set(allCategoryNames)) }}
              className="bg-transparent text-[12px] text-base-100 placeholder-base-600 px-3 py-2"
              style={{ border: '1px solid rgba(255,255,255,0.08)', minWidth: 200 }}
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
          <button
            onClick={() => setCreating((v) => !v)}
            className="px-4 py-2 text-[11px] tracking-widest uppercase transition-all duration-150"
            style={{
              color: creating ? '#000' : 'var(--accent)',
              border: '1px solid rgba(0,200,240,0.3)',
              background: creating ? 'var(--accent)' : 'rgba(0,200,240,0.06)',
            }}
            onMouseEnter={(e) => { if (!creating) e.currentTarget.style.background = 'rgba(0,200,240,0.1)' }}
            onMouseLeave={(e) => { if (!creating) e.currentTarget.style.background = 'rgba(0,200,240,0.06)' }}
          >
            + New
          </button>
        </div>
      </div>

      {creating && <NewCategoryForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />}

      {loading ? (
        <p className="text-[12px] text-base-400 py-8">Loading<span className="blink">_</span></p>
      ) : (
        <div className="space-y-2">
          {data.map(({ category, count, senders, subject_overrides, is_system, is_noise }) => (
            <CategorySection
              key={category}
              category={category}
              count={count}
              senders={senders}
              subjectOverrides={subject_overrides || []}
              isSystem={is_system}
              isNoise={is_noise}
              allColors={allColors}
              allCategoryNames={allCategoryNames}
              onAssign={handleAssign}
              onRemoveOverride={handleRemoveOverride}
              onRename={handleRename}
              onDelete={handleDelete}
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
