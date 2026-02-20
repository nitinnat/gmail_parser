export default function BulkActionBar({ selectedIds, onTrash, onMarkRead, onClear }) {
  if (!selectedIds.length) return null

  return (
    <div
      className="slide-up flex items-center gap-3 px-4 py-2.5 mb-4 rounded-sm text-[11px]"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <span className="text-base-400 tabular-nums">
        <span className="text-base-50 font-semibold">{selectedIds.length}</span> selected
      </span>

      <span className="text-base-700 mx-1">|</span>

      <button
        onClick={onTrash}
        className="px-3 py-1 tracking-wider uppercase text-[10px] transition-colors duration-100"
        style={{ color: 'var(--danger)', border: '1px solid rgba(255,59,59,0.3)' }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,59,59,0.08)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        Trash
      </button>

      <button
        onClick={onMarkRead}
        className="px-3 py-1 tracking-wider uppercase text-[10px] text-base-300 border border-subtle transition-colors duration-100"
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        Mark Read
      </button>

      <button
        onClick={onClear}
        className="ml-auto text-[10px] text-base-400 hover:text-base-100 tracking-wider uppercase transition-colors duration-100"
      >
        Clear
      </button>
    </div>
  )
}
