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
    llmProcess: (force = false) => post('/sync/llm-process', { force }),
    llmProcessStatus: () => get('/sync/llm-process'),
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
    triage: (days = 7) => get(`/analytics/triage?days=${days}`),
  },
  digest: {
    summarize: (emails) => post('/digest/summarize', { emails }),
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
    body: (id) => get(`/emails/${id}/body`),
    attachments: (id) => get(`/emails/${id}/attachments`),
    downloadAttachmentUrl: (id, attachmentId, filename, mimeType) =>
      `/api/emails/${id}/attachments/${attachmentId}/download?filename=${encodeURIComponent(filename)}&mime_type=${encodeURIComponent(mimeType)}`,
  },
  categories: {
    list: () => get('/categories'),
    custom: () => get('/categories/custom'),
    assign: (sender, category) => post('/categories/assign', { sender, category }),
    assignSubject: (subject, category) => post('/categories/assign', { subject, category }),
    removeOverride: (sender, subject) => post('/categories/remove-override', sender ? { sender } : { subject }),
    create: (name, color) => post('/categories/create', { name, color }),
    rename: (old_name, new_name) => put('/categories/rename', { old_name, new_name }),
    delete: (name) => fetch(`/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => r.json()),
  },
  alerts: {
    list: () => get('/alerts'),
    dismiss: (dismissKey) => post('/alerts/dismiss', { dismiss_key: dismissKey }),
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
