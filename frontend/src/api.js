const get = (path) => fetch(`/api${path}`).then((r) => r.json())
const post = (path, body) =>
  fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())
const put = (path, body) =>
  fetch(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

export const api = {
  auth: {
    me: () => get('/auth/me'),
    logout: () => post('/auth/logout', {}),
  },
  sync: {
    status: () => get('/sync/status'),
    start: (body) => post('/sync/start', body),
    progress: () => get('/sync/progress'),
    events: (after) => get(`/sync/events${after ? `?after=${encodeURIComponent(after)}` : ''}`),
    liveCount: () => get('/sync/live-count'),
    logs: (after) => get(`/sync/logs${after ? `?after=${encodeURIComponent(after)}` : ''}`),
    incremental: () => post('/sync/incremental', {}),
    categorize: () => post('/sync/categorize', {}),
    autoSync: () => get('/sync/auto'),
    setAutoSync: (enabled) => post('/sync/auto', { enabled }),
  },
  analytics: {
    overview: () => get('/analytics/overview'),
    senders: (limit = 200) => get(`/analytics/senders?limit=${limit}`),
    subscriptions: () => get('/analytics/subscriptions'),
    labels: () => get('/analytics/labels'),
    categories: () => get('/analytics/categories'),
    alerts: (limit = 100) => get(`/analytics/alerts?limit=${limit}`),
    eda: () => get('/analytics/eda'),
  },
  expenses: {
    overview: () => get('/expenses/overview'),
    transactions: (params) => get(`/expenses/transactions?${new URLSearchParams(params)}`),
    getRules: () => get('/expenses/rules'),
    setRules: (rules) => post('/expenses/rules', rules),
    reprocess: () => post('/expenses/reprocess', {}),
    override: (payload) => post('/expenses/override', payload),
  },
  rules: {
    get: () => get('/rules'),
    set: (rules) => post('/rules', rules),
    run: (dry_run = true) => post('/rules/run', { dry_run }),
  },
  emails: {
    list: (params) => get(`/emails?${new URLSearchParams(params)}`),
    get: (id) => get(`/emails/${id}`),
  },
  categories: {
    list: () => get('/categories'),
    assign: (sender, category) => post('/categories/assign', { sender, category }),
  },
  alerts: {
    getRules: () => get('/alerts/rules'),
    setRules: (rules) => put('/alerts/rules', rules),
    feed: (limit = 500) => get(`/analytics/alerts?limit=${limit}`),
  },
  actions: {
    preview: {
      trash: (ids) => post('/actions/trash', { ids, confirm: false }),
      trashSender: (sender) => post('/actions/trash-sender', { sender, confirm: false }),
    },
    trash: (ids) => post('/actions/trash', { ids, confirm: true }),
    markRead: (ids) => post('/actions/mark-read', { ids, confirm: true }),
    label: (ids, label_name) => post('/actions/label', { ids, label_name, confirm: true }),
    trashSender: (sender) => post('/actions/trash-sender', { sender, confirm: true }),
  },
}
