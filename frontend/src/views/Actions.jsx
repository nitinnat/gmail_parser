import { useState, useEffect } from 'react'
import { api } from '../api'

const URGENCY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toIso(d) { return d.toISOString().slice(0, 10) }
function todayIso() { return toIso(new Date()) }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }

function weekStart(d) {
  const r = new Date(d)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  r.setHours(0, 0, 0, 0)
  return r
}

function getWeekDays(anchor) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i))
}

function getMonthWeeks(anchor) {
  const s = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const endSun = addDays(
    weekStart(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    6,
  )
  const weeks = []
  let cur = s
  while (cur <= endSun) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)))
    cur = addDays(cur, 7)
  }
  return weeks
}

function ActionChip({ action, onOpenEmail, onDismiss }) {
  const [open, setOpen] = useState(false)
  const color = URGENCY_COLOR[action.urgency] || URGENCY_COLOR.medium

  return (
    <div style={{ marginBottom: 3 }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 9, letterSpacing: '0.04em', padding: '2px 6px',
          border: `1px solid ${color}55`, color, background: `${color}15`,
          cursor: 'pointer', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {action.is_overdue && <span style={{ color: '#ef4444', fontWeight: 700 }}>!</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {action.action}
        </span>
      </div>
      {open && (
        <div style={{
          marginTop: 2, padding: '8px 10px', background: '#0d0d0d',
          border: `1px solid ${color}44`, borderRadius: 2, zIndex: 10, position: 'relative',
        }}>
          <div style={{ fontSize: 10, color: '#e0e0e0', marginBottom: 4, lineHeight: 1.4 }}>{action.action}</div>
          <div style={{ fontSize: 9, color: '#666', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.subject}</div>
          <div style={{ fontSize: 9, color: '#555', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.sender}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenEmail(action.gmail_id) }}
              style={chipBtn(color)}
            >
              Open Email
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(action.dismiss_key) }}
              style={chipBtn('#555')}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DayCell({ date, actions, onOpenEmail, onDismiss, compact, inMonth }) {
  const today = todayIso()
  const dateStr = toIso(date)
  const isToday = dateStr === today
  const hasOverdue = actions.some(a => a.is_overdue)
  const dimmed = inMonth && date.getMonth() !== new Date(date).getMonth()

  return (
    <div style={{
      flex: 1, minWidth: 0,
      borderRight: '1px solid var(--border)',
      padding: compact ? '4px 5px' : '8px 10px',
      minHeight: compact ? 72 : 110,
      background: isToday ? 'rgba(0,200,240,0.03)' : 'transparent',
      opacity: dimmed ? 0.35 : 1,
    }}>
      <div style={{
        fontSize: compact ? 9 : 11,
        fontWeight: isToday ? 700 : 400,
        color: isToday ? 'var(--accent)' : hasOverdue ? '#ef4444' : 'var(--base-500)',
        textAlign: 'right',
        marginBottom: compact ? 3 : 6,
      }}>
        {date.getDate()}
      </div>
      {actions.map((a, i) => (
        <ActionChip key={i} action={a} onOpenEmail={onOpenEmail} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

const chipBtn = (color) => ({
  fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase',
  padding: '3px 8px', border: `1px solid ${color}66`, color,
  background: 'transparent', cursor: 'pointer', borderRadius: 2,
})

const navBtn = {
  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
  padding: '4px 9px', border: '1px solid var(--border)',
  background: 'transparent', cursor: 'pointer', color: 'var(--base-400)', borderRadius: 2,
}

export default function Actions({ onOpenEmail }) {
  const [view, setView] = useState('week')
  const [anchor, setAnchor] = useState(new Date())
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.alerts.list()
      .then(r => setActions(r.actions || []))
      .finally(() => setLoading(false))
  }, [])

  const byDate = actions.reduce((acc, a) => {
    acc[a.deadline] = acc[a.deadline] || []
    acc[a.deadline].push(a)
    return acc
  }, {})

  const dismiss = async (key) => {
    await api.alerts.dismiss(key)
    setActions(prev => prev.filter(a => a.dismiss_key !== key))
  }

  const prev = () => view === 'week'
    ? setAnchor(d => addDays(d, -7))
    : setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))

  const next = () => view === 'week'
    ? setAnchor(d => addDays(d, 7))
    : setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  const weekDays = getWeekDays(anchor)
  const monthWeeks = getMonthWeeks(anchor)

  const title = view === 'week'
    ? `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--base-50)', margin: 0 }}>
          Actions
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setAnchor(new Date())} style={navBtn}>Today</button>
          <button onClick={prev} style={navBtn}>‹</button>
          <span style={{ fontSize: 11, color: 'var(--base-300)', minWidth: 170, textAlign: 'center' }}>{title}</span>
          <button onClick={next} style={navBtn}>›</button>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            {['week', 'month'].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  ...navBtn, borderRadius: 0, border: 'none',
                  background: view === v ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: view === v ? 'var(--base-50)' : 'var(--base-500)',
                }}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--base-500)', fontSize: 11, textAlign: 'center', paddingTop: 60 }}>
          Loading actions…
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          {/* Day headers */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: '#080808' }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{
                flex: 1, padding: '5px 10px', fontSize: 9, letterSpacing: '0.15em',
                textTransform: 'uppercase', color: 'var(--base-500)',
                borderRight: '1px solid var(--border)', textAlign: 'right',
              }}>
                {d}
              </div>
            ))}
          </div>

          {view === 'week' ? (
            <div style={{ display: 'flex' }}>
              {weekDays.map((day, i) => (
                <DayCell
                  key={i} date={day}
                  actions={byDate[toIso(day)] || []}
                  onOpenEmail={onOpenEmail} onDismiss={dismiss}
                  compact={false}
                />
              ))}
            </div>
          ) : (
            monthWeeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', borderBottom: wi < monthWeeks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                {week.map((day, di) => (
                  <DayCell
                    key={di} date={day}
                    actions={byDate[toIso(day)] || []}
                    onOpenEmail={onOpenEmail} onDismiss={dismiss}
                    compact={true}
                    inMonth={day.getMonth() !== anchor.getMonth()}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {!loading && actions.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--base-500)', fontSize: 11 }}>
          No action items found — sync emails to extract them.
        </div>
      )}
    </div>
  )
}
