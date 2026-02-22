import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

const BUCKET_META = {
  reply:  { label: 'Reply',  color: 'var(--accent)', desc: 'Emails from people likely waiting on you' },
  do:     { label: 'Do',     color: 'var(--warn)',   desc: 'Deadlines, confirmations, action required' },
  read:   { label: 'Read',   color: 'var(--base-400)', desc: 'Unread, non-subscription emails' },
}

const DAYS_OPTIONS = [3, 7, 14, 30]

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function senderName(sender) {
  const m = sender.match(/^([^<]+)</)
  return m ? m[1].trim() : sender.split('@')[0]
}

function EmailRow({ email, onMarkRead, onOpen }) {
  const [hover, setHover] = useState(false)
  const catColor = CATEGORY_COLORS[email.category] || '#aaa'
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.id}`

  return (
    <div
      className={`flex items-center gap-4 px-5 py-3 transition-colors duration-100 ${onOpen ? 'cursor-pointer' : ''}`}
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: hover ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}
      onClick={onOpen ? () => onOpen(email.id) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {!email.is_read && (
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      )}
      {email.is_read && <div className="w-1.5 flex-shrink-0" />}

      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-base-100 truncate">{email.subject || '(no subject)'}</p>
        <p className="text-[10px] text-base-500 truncate mt-0.5">{senderName(email.sender)}</p>
      </div>

      <span
        className="hidden md:inline text-[9px] tracking-wider uppercase px-1.5 py-0.5 flex-shrink-0"
        style={{ color: catColor, border: `1px solid ${catColor}40` }}
      >
        {email.category}
      </span>

      <span className="text-[10px] text-base-500 tabular-nums flex-shrink-0 w-12 text-right">
        {fmtDate(email.date)}
      </span>

      <div className={`hidden md:flex gap-3 transition-opacity duration-100 flex-shrink-0 ${hover ? 'opacity-100' : 'opacity-0'}`}>
        {!email.is_read && (
          <button
            onClick={() => onMarkRead(email.id)}
            className="text-[10px] tracking-wider uppercase"
            style={{ color: 'var(--base-400)' }}
          >
            Mark read
          </button>
        )}
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] tracking-wider uppercase"
          style={{ color: 'var(--accent)' }}
        >
          Open ↗
        </a>
      </div>
      <a
        href={gmailUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="md:hidden text-[10px] flex-shrink-0"
        style={{ color: 'var(--accent)' }}
      >
        ↗
      </a>
    </div>
  )
}

function BucketSection({ bucket, emails, onMarkRead, onOpen }) {
  const meta = BUCKET_META[bucket]
  if (!emails.length) return null

  return (
    <div style={{ border: '1px solid var(--border)' }}>
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] tracking-widest uppercase font-600" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="hidden md:inline text-[10px] text-base-500">{meta.desc}</span>
        </div>
        <span className="text-[11px] tabular-nums text-base-400">{emails.length}</span>
      </div>
      {emails.map((e) => (
        <EmailRow key={e.id} email={e} onMarkRead={onMarkRead} onOpen={onOpen} />
      ))}
    </div>
  )
}

export default function Triage({ onOpenEmail }) {
  const [days, setDays] = useState(7)
  const [triage, setTriage] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async (d) => {
    setLoading(true)
    try {
      const data = await api.analytics.triage(d)
      setTriage(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(days) }, [days])

  const handleMarkRead = async (id) => {
    try {
      await api.actions.markRead([id])
      setTriage((prev) => ({
        reply: prev.reply.map((e) => e.id === id ? { ...e, is_read: true } : e),
        do:    prev.do.map((e)    => e.id === id ? { ...e, is_read: true } : e),
        read:  prev.read.map((e)  => e.id === id ? { ...e, is_read: true } : e),
      }))
    } catch (_) {
      // silent — stale UI state is preferable to a crash
    }
  }

  const total = triage ? triage.reply.length + triage.do.length + triage.read.length : 0

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Inbox Triage</p>
        <div className="flex items-end justify-between">
          <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Triage</h2>
          <div className="flex items-center gap-1 mb-1">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="px-3 py-1.5 text-[10px] tracking-wider uppercase transition-all duration-150"
                style={{
                  border: `1px solid ${days === d ? 'rgba(0,200,240,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  color: days === d ? 'var(--accent)' : 'var(--base-400)',
                  background: days === d ? 'rgba(0,200,240,0.06)' : 'transparent',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[12px] text-base-400">Loading<span className="blink">_</span></p>
      ) : total === 0 ? (
        <div className="py-16 text-center" style={{ border: '1px solid var(--border)' }}>
          <p className="text-[11px] tracking-[0.2em] uppercase text-base-400">
            No emails need attention in the last {days} days
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <BucketSection bucket="reply" emails={triage.reply} onMarkRead={handleMarkRead} onOpen={onOpenEmail} />
          <BucketSection bucket="do"    emails={triage.do}    onMarkRead={handleMarkRead} onOpen={onOpenEmail} />
          <BucketSection bucket="read"  emails={triage.read}  onMarkRead={handleMarkRead} onOpen={onOpenEmail} />
        </div>
      )}
    </div>
  )
}
