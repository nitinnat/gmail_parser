import { useEffect, useState } from 'react'
import { api } from '../api'

// Only strip HTML if the content actually looks like HTML — plain text emails
// with angle brackets (e.g. <user@example.com>) must not be run through DOMParser.
function processBody(text) {
  if (!text) return ''
  if (!/<(html|body|div|p|br|span|table|td|tr|font|a|img)\b/i.test(text)) return text
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return doc.body.innerText || doc.body.textContent || ''
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function EmailPanel({ emailId, onClose }) {
  const [email, setEmail] = useState(null)
  const [error, setError] = useState(false)
  const [attachments, setAttachments] = useState(null)

  useEffect(() => {
    setEmail(null)
    setError(false)
    setAttachments(null)
    api.emails.get(emailId)
      .then((data) => {
        if (!data || data.detail) { setError(true); return }
        setEmail(data)
        api.actions.markRead([emailId]).catch(() => {})
        if (data.metadata?.has_attachments) {
          api.emails.attachments(emailId).then((r) => setAttachments(r.attachments)).catch(() => {})
        }
      })
      .catch(() => setError(true))
  }, [emailId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const meta = email?.metadata || {}

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col font-mono"
        style={{
          width: 'min(520px, 100vw)',
          background: '#0a0a0a',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
          animation: 'slideInRight 0.18s ease-out',
        }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-[13px] text-base-50 font-600 leading-snug">
              {meta.subject || (email ? '(no subject)' : '')}
            </h2>
            <button
              onClick={onClose}
              className="flex-shrink-0 text-[18px] leading-none text-base-400 hover:text-base-100 transition-colors"
            >
              ×
            </button>
          </div>

          {email && !error && (
            <div className="space-y-1">
              <p className="text-[11px] truncate">
                <span className="text-[9px] text-base-600 tracking-wider uppercase mr-2">From</span>
                <span className="text-base-200">{meta.sender}</span>
              </p>
              {meta.recipients_to && (
                <p className="text-[11px] truncate">
                  <span className="text-[9px] text-base-600 tracking-wider uppercase mr-2">To</span>
                  <span className="text-base-300">{meta.recipients_to}</span>
                </p>
              )}
              {meta.recipients_cc && (
                <p className="text-[11px] truncate">
                  <span className="text-[9px] text-base-600 tracking-wider uppercase mr-2">CC</span>
                  <span className="text-base-300">{meta.recipients_cc}</span>
                </p>
              )}
              <p className="text-[10px] text-base-500 tabular-nums">
                {meta.date_iso ? new Date(meta.date_iso).toLocaleString() : ''}
              </p>
            </div>
          )}
        </div>

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div
            className="flex-shrink-0 px-5 py-3 flex flex-wrap gap-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            {attachments.map((a) => (
              <a
                key={a.gmail_attachment_id}
                href={api.emails.downloadAttachmentUrl(emailId, a.gmail_attachment_id, a.filename, a.mime_type)}
                download={a.filename}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] transition-all duration-100"
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--base-200)',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
              >
                <span>⬇</span>
                <span className="truncate max-w-[160px]" title={a.filename}>{a.filename}</span>
                <span className="text-base-500 flex-shrink-0">{formatBytes(a.size)}</span>
              </a>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-[12px] text-base-400">Failed to load email.</p>
          ) : !email ? (
            <p className="text-[12px] text-base-400">Loading<span className="blink">_</span></p>
          ) : (
            <pre className="text-[12px] text-base-300 whitespace-pre-wrap leading-relaxed break-words">
              {processBody(email.document) || '(no body)'}
            </pre>
          )}
        </div>
      </div>
    </>
  )
}
