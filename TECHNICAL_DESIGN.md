# Technical Design — gmail-parser

## Overview

EmailCollie is a personal Gmail management dashboard. It ingests Gmail messages via OAuth2, stores embeddings and metadata in an embedded ChromaDB, and exposes analytics, search, and actions through a JSON API consumed by a React UI. It is deployed publicly via Cloudflare Tunnel with Google OAuth login gated to a single allowed email address.

Key goals:
- Zero external infrastructure (embedded storage, local processes)
- Fast analytics (single-pass scans + short-lived caches)
- Safe operations (preview-first destructive actions)
- Mobile-friendly, responsive UI

## Architecture

```
┌────────────┐     OAuth2      ┌───────────────┐
│  Gmail API │<───────────────>│ gmail_parser  │
└────────────┘                 │ (library)     │
                               └─────┬─────────┘
                                     │
                                     │ ChromaDB (embedded)
                                     ▼
                               ┌───────────────┐
                               │  EmailStore   │
                               └─────┬─────────┘
                                     │
                       FastAPI JSON  │
                                     ▼
                               ┌───────────────┐
                               │   API Server  │◄── uvicorn (127.0.0.1:8000)
                               └─────┬─────────┘    --proxy-headers
                                     │
                          Cloudflare Tunnel (HTTPS)
                                     ▼
                               ┌───────────────┐
                               │   React UI    │◄── Vite (dev) or served
                               └───────────────┘    via Cloudflare
```

## Deployment

The application runs on a local machine exposed publicly via Cloudflare Tunnel:

- `cloudflared tunnel run emailcollie` forwards `https://emailcollie.nitinnataraj.com` → `localhost:8000` for the API, and the React build is served by nginx or Vite dev server behind the same tunnel.
- `start.sh` starts both services; `stop.sh` stops them.
- uvicorn runs with `--proxy-headers --forwarded-allow-ips="*"` to trust Cloudflare's `X-Forwarded-Proto: https`, which is required for secure session cookies and OAuth callback URL construction.
- `OAUTHLIB_RELAX_TOKEN_SCOPE=1` is set at process startup to suppress oauth scope-mismatch warnings.

## Components

### Library (`gmail_parser/`)

- `GmailClient`: Gmail API access (list, get, modify, label, history)
- `IngestionPipeline`: full and incremental sync; embeds content and writes to store
- `EmailStore`: ChromaDB persistence and query/update helpers
- `EmailSearch`: semantic/fulltext/hybrid search + analytics helpers
- `categorizer`: rule-based category assignment for metadata

### API (`api/`)

- `api/main.py`: FastAPI app, CORS, router registration
- `api/cache.py`: simple in-memory TTL cache for analytics results
- `api/routers/`:
  - `auth`: Google OAuth Web App login + signed session cookies + single-email allowlist
  - `sync`: sync status, full sync, incremental sync, logs, categorize, auto-sync schedule
  - `analytics`: overview, senders, subscriptions, alerts feed, EDA, triage
  - `emails`: list/search/get emails
  - `actions`: trash, mark-read, label, trash-sender (preview-first)
  - `categories`: list categories, assign sender override
  - `alert_rules`: manage pinned sender watchlist
  - `expenses`: expense rules, extraction, analytics
  - `rules`: inbox automation rules
  - `digest`: daily digest endpoint (unread count, action items, newsletters)

### Frontend (`frontend/`)

- Vite + React + TailwindCSS + Recharts
- Fully responsive: mobile hamburger drawer, horizontally-scrollable tables, responsive grid layouts
- Views: Overview, Senders, Subscriptions, Browse, Search, Sync, Categories, Alerts, Triage, Spending, Rules
- `frontend/src/api.js` provides API bindings to the FastAPI backend

## Data Model

ChromaDB collections:
- `emails`: document body + metadata for each Gmail message
- `labels`: Gmail labels with display metadata
- `sync_state`: single document storing last sync state
- `expenses`: extracted transactions with metadata

Key email metadata fields (not exhaustive):
- `gmail_id`, `thread_id`
- `subject`, `sender`, `recipients_to`, `recipients_cc`
- `date_iso`, `date_timestamp`
- `labels` (pipe-delimited), `is_read`, `is_starred`
- `has_attachments`, `snippet`, `size_estimate`
- `list_unsubscribe`
- `category` (rule-based)

Alert rules are stored as JSON at:
- `<chroma_persist_dir>/alert_rules.json`

Expense rules are stored as JSON at:
- `<chroma_persist_dir>/expense_rules.json`

Inbox automation rules are stored as JSON at:
- `<chroma_persist_dir>/inbox_rules.json`

## Core Flows

### Full Sync

1) Fetch message IDs via Gmail list endpoint (time-scoped or full).
2) Filter out IDs already in local store.
3) Batch fetch new messages, parse content/headers, embed, upsert.
4) Detect deletions (IDs missing from Gmail list within range) and remove.
5) Store last `historyId` for incremental syncs.

### Incremental Sync

1) Fetch history since `last_history_id`.
2) Collect added, deleted, and label-changed message IDs.
3) Delete removed emails from local store.
4) Refresh metadata for label-changed IDs via Gmail metadata fetch.
5) Fetch + store newly added messages.

### Search

- Semantic: embedding similarity (cosine distance).
- Fulltext: substring match over subject + body.
- Hybrid: Reciprocal Rank Fusion of semantic + fulltext results.

### Analytics

Overview and EDA are computed via single-pass scans over metadata:
- Monthly volume, totals, and category breakdown
- Day-of-week and hour-of-day distributions
- Domain distribution, top senders, category trends

### Alerts

- Alerts feed is derived from pinned senders stored in `alert_rules.json`.
- The UI groups alerts by category and sender, with optional notes.

### Authentication

- Backend uses a Google OAuth **Web Application** client (not Desktop type).
- `GET /api/auth/login` builds Google consent URL with `state` CSRF token.
- `GET /api/auth/callback` exchanges code for token, validates email against allowlist, writes signed session cookie.
- Session cookie: `HttpOnly`, `SameSite=lax`, `Secure` when `DASHBOARD_HTTPS_ONLY=true`.
- `OAUTHLIB_RELAX_TOKEN_SCOPE=1` set globally to avoid scope-mismatch errors on token exchange.
- `authorization_response` URL gets `http://` → `https://` rewrite in callback when behind reverse proxy (Cloudflare).
- All `/api/*` routes are protected by a `get_current_user` session dependency.
- Access is limited to `DASHBOARD_ALLOWED_EMAIL`.

### Triage

- `GET /api/analytics/triage?days=N` classifies emails into three buckets:
  - **reply**: unread, from real people (not subscriptions), likely awaiting response
  - **do**: subject matches action keywords (deadline, confirm, invoice, etc.)
  - **read**: unread, non-subscription, not in reply/do
- Frontend `/triage` view shows these buckets with per-email Gmail deep-links and Mark Read action.

### Expenses

- Expense rules match emails by sender/keyword/label and extract amounts via regex.
- Transactions are stored in the `expenses` collection for analytics.

### Actions (Destructive)

All destructive endpoints support preview-first requests; actual actions require `confirm: true`:
- Trash emails or all from a sender
- Mark read
- Apply labels (auto-creates label if needed)

## Caching

The API layer uses an in-memory TTL cache for hot analytics endpoints:
- `overview`, `senders`, `categories`, `alerts`, `eda`

Caches are invalidated on:
- Full sync start/end
- Incremental sync start/end
- Categorization runs
- Category reassignment
- Alert rules update

## Concurrency and Background Work

- Full/incremental sync runs in background threads
- Auto-sync loop wakes every minute to check schedule
- Shared state guarded by a thread lock
- Log aggregation combines API logs and optional script log file

## API Surface (selected)

- `GET /api/analytics/overview`
- `GET /api/analytics/eda`
- `GET /api/analytics/senders`
- `GET /api/analytics/alerts`
- `GET /api/emails` (filters + search)
- `POST /api/actions/trash`, `/api/actions/mark-read`, `/api/actions/label`
- `POST /api/sync/start`, `/api/sync/incremental`, `/api/sync/categorize`

## Configuration

Library env vars use `EMAIL_PARSER_` prefix:
- `EMAIL_PARSER_CHROMA_PERSIST_DIR`
- `EMAIL_PARSER_GOOGLE_CREDENTIALS_PATH`
- `EMAIL_PARSER_GOOGLE_TOKEN_PATH`
- `EMAIL_PARSER_EMBEDDING_MODEL`
- `EMAIL_PARSER_SYNC_BATCH_SIZE`

Dashboard-specific env vars (no prefix):
- `DASHBOARD_AUTH_ENABLED` — enable/disable auth gate
- `DASHBOARD_GOOGLE_CLIENT_ID` — Web App OAuth client ID
- `DASHBOARD_GOOGLE_CLIENT_SECRET` — Web App OAuth client secret
- `DASHBOARD_GOOGLE_REDIRECT_URI` — e.g. `https://emailcollie.yourdomain.com/api/auth/callback`
- `DASHBOARD_ALLOWED_EMAIL` — single email address allowed to log in
- `DASHBOARD_HTTPS_ONLY` — set `true` in production for secure cookies
- `GOOGLE_API_KEY` — for any generative API calls (digest, etc.)

## Security and Privacy

- Dashboard protected by Google OAuth; only `DASHBOARD_ALLOWED_EMAIL` can log in.
- Session cookie is signed with a randomly-generated secret persisted in `<chroma_persist_dir>/dashboard_session_secret.txt`.
- OAuth tokens and credentials remain local (`token.json`, `.env`).
- No external database or telemetry (ChromaDB telemetry disabled).
- Destructive actions require explicit confirmation (`preview → confirm`).
- `.env`, `client_secret_*.json`, and `*.pem` files must never be committed (covered by `.gitignore`).

## Known Limitations / Considerations

- Full sync over very large inboxes can be slow; batch sizes are configurable
- Incremental sync depends on Gmail history retention; too-old history requires a full sync
- Embedded store is single-user, local-only by design
