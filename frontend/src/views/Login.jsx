export default function Login() {
  const login = () => {
    const next = window.location.origin + window.location.pathname + window.location.search
    const isDev = window.location.port === '5173'
    const apiBase = isDev
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ''
    window.location.href = `${apiBase}/api/auth/login?next=${encodeURIComponent(next)}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-950 font-mono">
      <div className="p-8 max-w-md w-full" style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
        <p className="text-[10px] tracking-[0.3em] uppercase text-base-400 mb-2">Secure Access</p>
        <h2 className="font-display font-700 text-4xl text-base-50 leading-none">EmailCollie</h2>
        <p className="mt-4 text-[12px] text-base-400">
          Sign in with Google to access your personal dashboard.
        </p>

        <button
          onClick={login}
          className="mt-6 w-full px-5 py-3 text-[11px] tracking-widest uppercase transition-all duration-150"
          style={{
            color: 'var(--accent)',
            border: '1px solid rgba(0,200,240,0.4)',
            background: 'rgba(0,200,240,0.06)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,200,240,0.12)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,200,240,0.06)' }}
        >
          Continue with Google
        </button>
      </div>
    </div>
  )
}
