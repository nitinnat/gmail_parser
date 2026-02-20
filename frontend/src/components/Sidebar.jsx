import { NavLink } from 'react-router-dom'

const links = [
  { to: '/overview',       label: 'Overview',       num: '01' },
  { to: '/senders',        label: 'Senders',        num: '02' },
  { to: '/subscriptions',  label: 'Subscriptions',  num: '03' },
  { to: '/browse',         label: 'Browse',         num: '04' },
  { to: '/search',         label: 'Search',         num: '05' },
  { to: '/sync',           label: 'Sync',           num: '06' },
  { to: '/categories',     label: 'Categories',     num: '07' },
  { to: '/alerts',         label: 'Alerts',         num: '08' },
]

export default function Sidebar() {
  return (
    <div
      className="w-52 flex flex-col flex-shrink-0 border-r"
      style={{ background: '#080808', borderColor: 'var(--border)' }}
    >
      {/* Logo */}
      <div className="px-6 pt-8 pb-9">
        <div className="flex items-center gap-2.5 mb-1">
          <img src="/emailcollie-logo.svg" alt="" className="w-9 h-9 object-contain" />
          <h1 className="font-display font-700 text-[22px] leading-none text-base-50 tracking-tight">
            EmailCollie
          </h1>
        </div>
        <div className="mt-4 h-px w-6" style={{ background: 'var(--accent)' }} />
      </div>

      {/* Nav */}
      <nav className="flex flex-col px-3 gap-px">
        {links.map(({ to, label, num }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-sm text-[11px] tracking-[0.12em] uppercase',
                'transition-all duration-150 border-l-2',
                isActive
                  ? 'border-accent bg-white/[0.04]'
                  : 'border-transparent hover:bg-white/[0.025]',
              ].join(' ')
            }
            style={({ isActive }) => ({ color: isActive ? 'var(--base-50)' : 'var(--base-200)' })}
          >
            <span className="text-[10px] w-4 flex-shrink-0" style={{ color: 'var(--base-500)' }}>{num}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-6 pb-6">
        <p className="text-[10px] text-base-600">v0.2.0</p>
      </div>
    </div>
  )
}
