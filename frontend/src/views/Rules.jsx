import { useEffect, useState } from 'react'
import { api } from '../api'

export default function Rules() {
  const [rules, setRules] = useState({ rules: [] })
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newRule, setNewRule] = useState({
    name: '',
    senders: '',
    keywords: '',
    labels: '',
    mark_read: false,
    trash: false,
    label: '',
  })

  useEffect(() => {
    api.rules.get().then(setRules)
  }, [])

  const saveRules = async (next) => {
    setSaving(true)
    const saved = await api.rules.set(next)
    setRules(saved)
    setSaving(false)
  }

  const addRule = () => {
    if (!newRule.name.trim()) return
    const rule = {
      name: newRule.name.trim(),
      senders: newRule.senders.split(',').map((s) => s.trim()).filter(Boolean),
      keywords: newRule.keywords.split(',').map((s) => s.trim()).filter(Boolean),
      labels: newRule.labels.split(',').map((s) => s.trim()).filter(Boolean),
      actions: {
        mark_read: newRule.mark_read,
        trash: newRule.trash,
        label: newRule.label.trim() || null,
      },
    }
    saveRules({ rules: [...rules.rules, rule] })
    setNewRule({ name: '', senders: '', keywords: '', labels: '', mark_read: false, trash: false, label: '' })
  }

  const removeRule = (name) => {
    saveRules({ rules: rules.rules.filter((r) => r.name !== name) })
  }

  const runPreview = async () => {
    const res = await api.rules.run(true)
    setPreview(res.matches)
  }

  const runExecute = async () => {
    const res = await api.rules.run(false)
    setPreview(res.matches)
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Automation</p>
        <h2 className="font-display font-700 text-5xl text-base-50 leading-none">Rules</h2>
      </div>

      <div className="p-6" style={{ border: '1px solid var(--border)' }}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-base-400 mb-4">Create Rule</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <input
            value={newRule.name}
            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
            placeholder="Rule name"
            className="bg-transparent text-[11px] px-2 py-2"
            style={{ border: '1px solid var(--border)' }}
          />
          <input
            value={newRule.senders}
            onChange={(e) => setNewRule({ ...newRule, senders: e.target.value })}
            placeholder="Senders (comma)"
            className="bg-transparent text-[11px] px-2 py-2"
            style={{ border: '1px solid var(--border)' }}
          />
          <input
            value={newRule.keywords}
            onChange={(e) => setNewRule({ ...newRule, keywords: e.target.value })}
            placeholder="Keywords (comma)"
            className="bg-transparent text-[11px] px-2 py-2"
            style={{ border: '1px solid var(--border)' }}
          />
          <input
            value={newRule.labels}
            onChange={(e) => setNewRule({ ...newRule, labels: e.target.value })}
            placeholder="Labels (comma)"
            className="bg-transparent text-[11px] px-2 py-2"
            style={{ border: '1px solid var(--border)' }}
          />
        </div>

        <div className="mt-3 flex items-center gap-4">
          <label className="text-[11px] text-base-300">
            <input type="checkbox" checked={newRule.mark_read} onChange={(e) => setNewRule({ ...newRule, mark_read: e.target.checked })} /> Mark read
          </label>
          <label className="text-[11px] text-base-300">
            <input type="checkbox" checked={newRule.trash} onChange={(e) => setNewRule({ ...newRule, trash: e.target.checked })} /> Trash
          </label>
          <input
            value={newRule.label}
            onChange={(e) => setNewRule({ ...newRule, label: e.target.value })}
            placeholder="Apply label"
            className="bg-transparent text-[11px] px-2 py-2"
            style={{ border: '1px solid var(--border)' }}
          />
          <button onClick={addRule} className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--accent)' }}>Add</button>
        </div>
      </div>

      <div className="p-6" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] tracking-[0.25em] uppercase text-base-400">Rules List</p>
          <div className="flex items-center gap-3">
            <button onClick={runPreview} className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--accent)' }}>Preview</button>
            <button onClick={runExecute} disabled={saving} className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--danger)' }}>Run</button>
          </div>
        </div>

        {rules.rules.length === 0 ? (
          <p className="text-[11px] text-base-400">No rules yet</p>
        ) : (
          <div className="space-y-2">
            {rules.rules.map((r) => (
              <div key={r.name} className="flex items-center justify-between text-[11px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                <div>
                  <span className="text-base-100">{r.name}</span>
                  {r.senders?.length > 0 && <span className="text-base-500 ml-3">senders: {r.senders.join(', ')}</span>}
                  {r.keywords?.length > 0 && <span className="text-base-500 ml-3">keywords: {r.keywords.join(', ')}</span>}
                  {r.labels?.length > 0 && <span className="text-base-500 ml-3">labels: {r.labels.join(', ')}</span>}
                  <span className="text-base-400 ml-3">actions: {r.actions?.trash ? 'trash ' : ''}{r.actions?.mark_read ? 'mark_read ' : ''}{r.actions?.label ? `label:${r.actions.label}` : ''}</span>
                </div>
                <button onClick={() => removeRule(r.name)} className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--danger)' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {preview && (
          <div className="mt-4">
            <p className="text-[10px] tracking-[0.2em] uppercase text-base-400 mb-2">Preview Results</p>
            {Object.entries(preview).map(([name, count]) => (
              <div key={name} className="text-[11px] text-base-300">{name}: {count}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
