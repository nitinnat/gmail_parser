# Technical Design — gmail-parser

## Overview

gmail-parser is a local-first Gmail processing library with a FastAPI backend and React dashboard. It ingests Gmail messages via OAuth2, stores embeddings and metadata in an embedded ChromaDB, and exposes analytics, search, and actions through a JSON API consumed by the UI.

Key goals:
- Zero external infrastructure (embedded storage, local processes)
- Fast analytics (single-pass scans + short-lived caches)
- Safe operations (preview-first destructive actions)

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
                               │   API Server  │
                               └─────┬─────────┘
                                     │
                          HTTP (Vite proxy)
                                     ▼
                               ┌───────────────┐
                               │   React UI    │
                               └───────────────┘
```

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
  - `auth`: Google OAuth login + session endpoints
  - `sync`: sync status, full sync, incremental sync, logs, categorize
  - `analytics`: overview, senders, subscriptions, alerts feed, EDA
  - `emails`: list/search/get emails
  - `actions`: trash, mark-read, label, trash-sender (preview-first)
  - `categories`: list categories, assign sender override
  - `alert_rules`: manage pinned sender watchlist
  - `expenses`: expense rules, extraction, analytics
  - `rules`: inbox automation rules

### Frontend (`frontend/`)

- Vite + React + TailwindCSS + Recharts
- Views: Overview, Senders, Subscriptions, Browse, Search, Sync, Categories, Alerts
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

- Backend performs Google OAuth and stores a signed session cookie.
- All `/api/*` routes are protected by a session dependency.
- Access is limited to a single allowed email.

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

Environment variables use `EMAIL_PARSER_` prefix:
- `EMAIL_PARSER_CHROMA_PERSIST_DIR`
- `EMAIL_PARSER_GOOGLE_CREDENTIALS_PATH`
- `EMAIL_PARSER_GOOGLE_TOKEN_PATH`
- `EMAIL_PARSER_EMBEDDING_MODEL`
- `EMAIL_PARSER_SYNC_BATCH_SIZE`

## Security and Privacy

- OAuth tokens and credentials remain local (`token.json`, `credentials.json`)
- No external database or telemetry (ChromaDB telemetry disabled)
- Destructive actions require explicit confirmation

## Known Limitations / Considerations

- Full sync over very large inboxes can be slow; batch sizes are configurable
- Incremental sync depends on Gmail history retention; too-old history requires a full sync
- Embedded store is single-user, local-only by design
