import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { CATEGORY_COLORS } from '../categories'

const ACCENT = '#00c8f0'
const FONT = '"Courier New", monospace'

function rnd(a, b) { return a + Math.random() * (b - a) }

function makeCluster() {
  const digits = Array.from({ length: 10 + Math.floor(Math.random() * 8) }, () =>
    Math.floor(Math.random() * 10)
  )
  const parts = []
  let i = 0
  while (i < digits.length) {
    const len = 3 + Math.floor(Math.random() * 2)
    parts.push(digits.slice(i, i + len).join('\u2009'))
    i += len
  }
  return parts.join('   ')
}

function binId(cat) {
  return `mdr-bin-${cat.replace(/[^a-z0-9]/gi, '_')}`
}

function fmtTime(s) {
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(n => String(n).padStart(2, '0')).join(':')
}

export default function MDR() {
  const canvasRef = useRef(null)
  const dataRef = useRef({ items: [], animId: null })
  const [cats, setCats] = useState([])
  const [popup, setPopup] = useState(null)
  const [secs, setSecs] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const loadCats = () =>
    api.categories.list().then(data => {
      const top = data.filter(c => !c.is_noise).sort((a, b) => b.count - a.count).slice(0, 8)
      setCats(top)
      return top
    })

  useEffect(() => {
    Promise.all([loadCats(), api.emails.list({ limit: 50 })]).then(([, emailResp]) => {
      const canvas = canvasRef.current
      if (!canvas) return
      dataRef.current.items = (emailResp.emails || []).map(email => ({
        id: email.id,
        email,
        cluster: makeCluster(),
        color: CATEGORY_COLORS[email.metadata?.category] || ACCENT,
        x: rnd(20, canvas.width - 160),
        y: rnd(20, canvas.height - 20),
        vx: (Math.random() < 0.5 ? -1 : 1) * rnd(0.1, 0.3),
        vy: (Math.random() < 0.5 ? -1 : 1) * rnd(0.08, 0.22),
        target: null,
        alpha: 1,
      }))
    })
  }, []) // eslint-disable-line

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const frame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      dataRef.current.items = dataRef.current.items.filter(it => it.alpha > 0.01)

      for (const it of dataRef.current.items) {
        if (it.target) {
          it.vy += 0.38
          it.vx += (it.target.x - it.x) * 0.005
          it.vx *= 0.92
          it.x += it.vx
          it.y += it.vy
          if (it.y >= it.target.y) it.alpha -= 0.07
        } else {
          it.x += it.vx
          it.y += it.vy
          if (it.x < 10) it.vx = Math.abs(it.vx)
          if (it.x > canvas.width - 160) it.vx = -Math.abs(it.vx)
          if (it.y < 16) it.vy = Math.abs(it.vy)
          if (it.y > canvas.height - 16) it.vy = -Math.abs(it.vy)
        }

        ctx.save()
        ctx.globalAlpha = Math.max(0, it.alpha)
        ctx.font = `12px ${FONT}`
        ctx.fillStyle = it.color
        ctx.shadowColor = it.color
        ctx.shadowBlur = 10
        ctx.fillText(it.cluster, it.x, it.y)
        ctx.restore()
      }

      dataRef.current.animId = requestAnimationFrame(frame)
    }

    dataRef.current.animId = requestAnimationFrame(frame)

    const onClick = (e) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      for (const it of dataRef.current.items) {
        if (!it.target) {
          ctx.font = `12px ${FONT}`
          const w = ctx.measureText(it.cluster).width
          if (mx >= it.x - 4 && mx <= it.x + w + 4 && my >= it.y - 14 && my <= it.y + 4) {
            setPopup({ item: it, cx: e.clientX, cy: e.clientY })
            return
          }
        }
      }
      setPopup(null)
    }

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const hovering = dataRef.current.items.some(it => {
        if (it.target) return false
        ctx.font = `12px ${FONT}`
        const w = ctx.measureText(it.cluster).width
        return mx >= it.x - 4 && mx <= it.x + w + 4 && my >= it.y - 14 && my <= it.y + 4
      })
      canvas.style.cursor = hovering ? 'pointer' : 'default'
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mousemove', onMouseMove)

    return () => {
      cancelAnimationFrame(dataRef.current.animId)
      ro.disconnect()
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMouseMove)
    }
  }, [])

  const assignTo = async (item, category) => {
    const binEl = document.getElementById(binId(category))
    if (binEl && canvasRef.current) {
      const br = binEl.getBoundingClientRect()
      const cr = canvasRef.current.getBoundingClientRect()
      item.target = { x: br.left + br.width / 2 - cr.left, y: br.top - cr.top }
      item.vx = 0
      item.vy = 0
    } else {
      item.alpha = 0
    }
    setPopup(null)
    await api.categories.assign(item.email.metadata?.sender, category)
    loadCats()
  }

  const maxCount = cats[0]?.count || 1

  return (
    <div style={{ flex: 1, overflow: 'hidden', background: '#030303', fontFamily: FONT, display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* Scanlines */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.09) 3px, rgba(0,0,0,0.09) 4px)' }} />

      {/* Vignette */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)' }} />

      {/* Header */}
      <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, padding: '10px 22px', borderBottom: '1px solid rgba(0,200,240,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.55em', color: ACCENT, opacity: 0.65, textTransform: 'uppercase', marginBottom: 3 }}>Lumon Industries</div>
          <div style={{ fontSize: 13, letterSpacing: '0.35em', color: ACCENT, textTransform: 'uppercase', textShadow: `0 0 16px ${ACCENT}99` }}>Macrodata Refinement</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', color: `${ACCENT}88`, textTransform: 'uppercase', marginBottom: 2 }}>Session</div>
            <div style={{ fontSize: 14, color: ACCENT, letterSpacing: '0.25em', textShadow: `0 0 10px ${ACCENT}` }}>{fmtTime(secs)}</div>
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{ fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: `${ACCENT}99`, border: `1px solid ${ACCENT}55`, padding: '5px 12px', background: 'transparent', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = ACCENT; e.currentTarget.style.borderColor = `${ACCENT}55` }}
            onMouseLeave={e => { e.currentTarget.style.color = `${ACCENT}55`; e.currentTarget.style.borderColor = `${ACCENT}22` }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'default' }} />
      </div>

      {/* Bins */}
      <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, borderTop: '1px solid rgba(0,200,240,0.1)', padding: '10px 12px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {cats.map(cat => {
          const color = CATEGORY_COLORS[cat.category] || ACCENT
          return (
            <div
              key={cat.category}
              id={binId(cat.category)}
              style={{ flex: '1 0 auto', minWidth: 90, maxWidth: 145, border: `1px solid ${color}66`, padding: '8px 10px', position: 'relative', overflow: 'hidden' }}
            >
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(cat.count / maxCount) * 100}%`, background: `${color}1a`, transition: 'height 0.6s ease' }} />
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color, opacity: 0.9, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.category}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color, textShadow: `0 0 14px ${color}`, lineHeight: 1 }}>{cat.count.toLocaleString()}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Popup */}
      {popup && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', left: Math.min(popup.cx + 14, window.innerWidth - 268), top: Math.max(popup.cy - 115, 70), zIndex: 100, background: '#0a0a0a', border: `1px solid ${ACCENT}66`, boxShadow: `0 0 32px ${ACCENT}22`, padding: '14px 16px', width: 252 }}
        >
          <div style={{ fontSize: 9, letterSpacing: '0.4em', color: ACCENT, opacity: 0.75, textTransform: 'uppercase', marginBottom: 9 }}>Data Set Identified</div>
          <div style={{ fontSize: 12, color: '#e0e0e0', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={popup.item.email.metadata?.subject}>
            {popup.item.email.metadata?.subject || '(no subject)'}
          </div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {popup.item.email.metadata?.sender}
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.25em', color: ACCENT, opacity: 0.75, textTransform: 'uppercase', marginBottom: 7 }}>Assign Temper</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cats.map(cat => {
              const color = CATEGORY_COLORS[cat.category] || ACCENT
              const active = cat.category === popup.item.email.metadata?.category
              return (
                <button
                  key={cat.category}
                  onClick={() => assignTo(popup.item, cat.category)}
                  style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '4px 8px', border: `1px solid ${color}${active ? 'cc' : '66'}`, color: active ? color : `${color}bb`, background: active ? `${color}20` : 'transparent', cursor: 'pointer' }}
                >
                  {cat.category}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setPopup(null)}
            style={{ marginTop: 11, fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: `${ACCENT}66`, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
