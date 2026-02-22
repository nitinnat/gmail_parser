import { CATEGORY_COLORS } from '../categories'

export default function EmailRow({ email, checked, onCheck, onOpen }) {
  const meta = email.metadata || {}
  const unread = !meta.is_read
  const catColor = meta.category && meta.category !== 'Other' ? CATEGORY_COLORS[meta.category] : null

  return (
    <div
      className={`flex items-start gap-4 px-4 py-3 transition-colors duration-100 ${onOpen ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        borderLeft: unread ? '2px solid var(--accent)' : '2px solid transparent',
        background: checked ? 'rgba(0,200,240,0.04)' : 'transparent',
      }}
      onClick={onOpen ? () => onOpen(email.id) : undefined}
      onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
      onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent' }}
    >
      {onCheck && (
        <input
          type="checkbox"
          checked={checked || false}
          onChange={() => onCheck(email.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 flex-shrink-0"
        />
      )}

      <div className="flex-1 min-w-0 grid gap-0.5">
        <div className="flex items-baseline gap-3">
          <span
            className="text-[12px] truncate"
            style={{ color: unread ? '#f0f0f0' : '#c0c0c0', fontWeight: unread ? 500 : 400 }}
          >
            {meta.sender || '—'}
          </span>
          {meta.is_starred && (
            <span className="flex-shrink-0 text-warn text-[10px]">★</span>
          )}
        </div>

        <span
          className="text-[12px] truncate"
          style={{ color: unread ? '#e0e0e0' : '#aaaaaa' }}
        >
          {meta.subject || '(no subject)'}
        </span>

        {meta.snippet && (
          <span className="text-[11px] truncate text-base-400">{meta.snippet}</span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {catColor && (
          <span
            className="text-[9px] px-1.5 py-0.5 tracking-wide flex-shrink-0 hidden sm:inline-block"
            style={{
              color: catColor,
              border: `1px solid ${catColor}33`,
              background: `${catColor}11`,
            }}
          >
            {meta.category}
          </span>
        )}
        <span className="text-[11px] text-base-400 tabular-nums">
          {meta.date_iso ? new Date(meta.date_iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
        </span>
      </div>
    </div>
  )
}
