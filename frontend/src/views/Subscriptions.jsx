import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Subscriptions() {
  const [senders, setSenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [trashingAll, setTrashingAll] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.analytics.subscriptions().then((d) => { setSenders(d); setLoading(false) })
  }, [])

  const trashSender = async (sender) => {
    const preview = await api.actions.preview.trashSender(sender)
    if (!confirm(`Trash ${preview.would_trash} email(s) from:\n${sender}\n\nThis cannot be undone.`)) return
    await api.actions.trashSender(sender)
    setSenders((prev) => prev.filter((s) => s.sender !== sender))
  }

  const trashAll = async () => {
    if (!confirm(`Permanently trash emails from all ${senders.length} subscription senders?\n\n${totalEmails.toLocaleString()} emails total.\n\nThis cannot be undone.`)) return
    setTrashingAll(true)
    for (const s of senders) {
      await api.actions.trashSender(s.sender)
    }
    setSenders([])
    setTrashingAll(false)
  }

  const totalEmails = senders.reduce((acc, s) => acc + s.count, 0)

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Inbox Cleanup</p>
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Subscriptions</h2>
            {!loading && senders.length > 0 && (
              <p className="mt-2 text-[12px] text-base-400 tabular-nums">
                <span style={{ color: 'var(--warn)' }}>{senders.length}</span> senders ·{' '}
                <span style={{ color: 'var(--warn)' }}>{totalEmails.toLocaleString()}</span> emails
              </p>
            )}
          </div>

          {senders.length > 0 && (
            <button
              onClick={trashAll}
              disabled={trashingAll}
              className="px-5 py-2.5 text-[11px] tracking-widest uppercase transition-all duration-150 disabled:opacity-50"
              style={{
                color: 'var(--danger)',
                border: '1px solid rgba(255,59,59,0.4)',
                background: 'rgba(255,59,59,0.06)',
              }}
              onMouseEnter={(e) => { if (!trashingAll) e.currentTarget.style.background = 'rgba(255,59,59,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,59,59,0.06)' }}
            >
              {trashingAll ? 'Trashing…' : `Trash All ${senders.length} Senders`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-base-400 text-[12px]">Loading<span className="blink">_</span></p>
      ) : senders.length === 0 ? (
        <div className="py-16 text-center" style={{ border: '1px solid var(--border)' }}>
          <p className="text-[11px] tracking-[0.2em] uppercase text-base-400">No subscriptions detected</p>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }} className="overflow-x-auto">
          <div style={{ minWidth: '580px' }}>
            {/* Head */}
            <div
              className="grid text-[10px] tracking-[0.2em] uppercase text-base-400 px-4 py-2.5"
              style={{
                gridTemplateColumns: '32px 1fr 80px 64px 90px 80px 120px',
                borderBottom: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <span>#</span>
              <span>Sender</span>
              <span className="text-right">Emails</span>
              <span className="text-right">Unread</span>
              <span className="pl-3">Last Seen</span>
              <span>Confirmed</span>
              <span />
            </div>

            {senders.map((s, i) => (
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
        gridTemplateColumns: '32px 1fr 80px 64px 90px 80px 120px',
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
