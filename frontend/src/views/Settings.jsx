import { useState } from 'react'
import SyncPage from './Sync'
import Categories from './Categories'
import Rules from './Rules'

const TABS = [
  { id: 'sync', label: 'Sync' },
  { id: 'categories', label: 'Categories' },
  { id: 'rules', label: 'Rules' },
]

export default function Settings() {
  const [tab, setTab] = useState('sync')

  return (
    <div>
      <div className="flex gap-1 mb-7 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase transition-colors"
            style={{
              color: tab === id ? 'var(--base-50)' : 'var(--base-400)',
              borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sync' && <SyncPage />}
      {tab === 'categories' && <Categories />}
      {tab === 'rules' && <Rules />}
    </div>
  )
}
