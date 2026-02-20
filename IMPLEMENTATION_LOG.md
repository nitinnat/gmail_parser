# Implementation Log -- gmail-parser

## 2026-02-19: Analytics Explorer (EDA Charts)

### Changes

**`api/routers/analytics.py`** — Extended `GET /analytics/eda` with three new data structures, all computed in the same single-pass loop (no extra ChromaDB queries):
- `heatmap`: 7×24 nested list (`heatmap[weekday][hour] = count`) for the day-of-week × hour-of-day heatmap
- `domain_distribution`: top 15 sending domains extracted from sender strings via regex, sorted by count
- `monthly_by_category`: last 12 months × top 6 categories (by total volume) for the trends line chart; sibling key `category_trend_keys` lists the 6 categories in order
- Added `_EMAIL_DOMAIN_RE` regex and `_extract_domain()` helper

**`frontend/src/views/Overview.jsx`** — Added a tabbed "Explorer" panel at the bottom of the page (visible when EDA data is loaded). Three tabs:
- **Domains** — horizontal bar chart (Recharts, `layout="vertical"`) of top 15 sending domains
- **Category Trends** — multi-line chart (Recharts LineChart) of monthly volume for top 6 categories, each line colored with `CATEGORY_COLORS`
- **Heatmap** — pure CSS grid (7 rows × 24 cols) colored by email count intensity, with hover tooltips and a color-scale legend

Added `LineChart`, `Line`, `Legend` imports from recharts. Removed duplicate `fmtPeriodShort` (used `fmtPeriod` for both).

### Notes
- EDA cache invalidated by sync/categorize runs (same as before); new fields come for free on next cache miss

---


## 2026-02-19: Senders Category Column + Reduced Categories + Alerts Tab

### Changes

**`gmail_parser/categorizer.py`** — Reduced from 19 → 14 categories. Removed: `Real Estate`, `Promotions & Deals`, `Social & Community`, `Entertainment`, `Education`. Folded rent/lease patterns into `Finance & Banking`'s subject regex. Merged all four removed categories' sender/subject/label patterns into a single expanded `Newsletters` rule.

**`frontend/src/categories.js`** — Removed the 5 deleted category color entries. `ALL_CATEGORIES` derives from keys automatically (14 entries now).

**`gmail_parser/search.py`** — `get_sender_analytics()` now tracks a `cat_counter: Counter` per sender and adds `"category": most_common_category` to each result.

**`api/routers/analytics.py`** — Added `_ACTION_RE` (heuristic regex for action-required subjects), `_ALERT_CATEGORIES` (8 high-importance categories), and `GET /analytics/alerts` endpoint. Scores each email within 90 days: +5 subject match, +3 important category, +3/2/1 age tiers, +2 unread. Returns emails with score ≥ 5, sorted by score desc then date desc. Result cached as "alerts".

**`api/routers/categories.py`** — `assign_category()` now invalidates "senders" and "alerts" in addition to "overview" and "categories".

**`api/routers/sync.py`** — All `cache.invalidate()` calls now include "alerts". `categorize_emails()` also invalidates "senders".

**`frontend/src/api.js`** — Added `api.analytics.alerts(limit=100)`.

**`frontend/src/views/Senders.jsx`** — Grid expanded to 8 columns. Added "Category" column with an inline `<select>` per sender row, styled with `CATEGORY_COLORS`. On change: optimistic local update + `api.categories.assign()` call.

**`frontend/src/views/Alerts.jsx`** (new) — Alerts view with score dots (critical ≥10 red, high ≥7 orange, medium ≥5 yellow), category badges, clickable subjects (Gmail deep-link), filter chips (All / Unread / per-category), and "Mark Read" action.

**`frontend/src/App.jsx`** + **`frontend/src/components/Sidebar.jsx`** — Added `/alerts` route and nav entry (`08`).

### Notes
- Run "Categorize Emails" from Sync page after deploy to re-bucket emails from old Promotions/Social/Entertainment/Education/Real Estate categories into Newsletters/Finance.

---

## 2026-02-19: Performance + Smart Sync

### Root cause
Overview page triggered 6 full ChromaDB scans per load (15k emails, ~2–5MB/scan): 2× in `/overview` (main loop + `count_by_date`), 1× `/subscriptions`, 1× `/analytics/categories`, and 2× `/categories` if visited.

### Changes

**`api/cache.py`** (new) — module-level TTL cache with `get(key, ttl=60)`, `set(key, val)`, `invalidate(*keys)`.

**`api/routers/analytics.py`** — Rewrote `overview()` to do **1 full scan** computing total/unread/starred/monthly_volume/custom-categories and `subscription_count` (via inline sender aggregation using same subscription logic as `get_sender_analytics`). Result cached 60s. Both `/senders` and `/subscriptions` now share a single "senders" cache. Overview now returns `subscription_count` (int) and `categories` (custom category list) so the frontend needs only one call.

**`api/routers/categories.py`** — `list_categories()` now checks/sets "categories" cache (60s). `assign_category()` invalidates "overview" + "categories" after mutation.

**`api/routers/sync.py`** — `cache.invalidate("overview", "senders", "categories")` called at start and end of `_run_sync()` and `_run_incremental()`. Also called in `categorize_emails()` (invalidates "overview" + "categories" only).

**`frontend/src/views/Overview.jsx`** — Removed `api.analytics.subscriptions()` and `api.analytics.categories()` calls. Derives `subCount = data?.subscription_count` and `categories = data?.categories ?? []` from the single overview response.

**`frontend/src/views/Sync.jsx`** — Added `useEffect` watching `status?.has_history_id`: sets `days_ago: null` ("All" pre-selected) when no history ID exists (first-ever sync), keeps `days_ago: 90` otherwise.

### Result
- Overview page: 6 full scans → **1 scan** (first load), **0 scans** (cache hit, <100ms)
- Senders/Subscriptions pages: **1 scan** (first load), **0 scans** (cache hit)
- Categories page: **1 scan** (first load), **0 scans** (cache hit)
- Caches invalidated automatically on every sync and categorization run
- Smart sync default: "All mail" pre-selected for first-time users, "90d" for returning users

---

## 2026-02-18: Gmail Dashboard (FastAPI + React)

Full local web dashboard built on top of the existing `gmail_parser` library.

### Library changes
- **`auth.py`**: Upgraded scope from `gmail.readonly` → `gmail.modify` (required for write actions). User must delete `token.json` and re-run `01_setup.py` to get new OAuth consent.
- **`ingestion.py`**: Added `list_unsubscribe` to `_build_metadata()` (stores `List-Unsubscribe` header from newly ingested emails). Raised `full_sync` default `max_emails` 500 → 100000.
- **`client.py`**: Raised `list_messages` default `max_results` 100 → 10000.
- **`examples/02_ingest.py`**: Raised `--max` default 5000 → 100000.
- **`search.py`**: Added `get_sender_analytics(limit=200)` — groups all emails by sender, computes per-sender count/unread/last_date/has_list_unsubscribe, flags `is_subscription` via 4 signals: confirmed List-Unsubscribe header, sender address pattern match (`noreply|newsletter|marketing|...`), Gmail category labels (`CATEGORY_PROMOTIONS/SOCIAL/UPDATES`), or volume ≥5.
- **`store.py`**: Added `delete_emails(ids)` to remove emails from ChromaDB after trash actions.

### FastAPI backend (`api/`)
- `api/main.py` — FastAPI app with CORS for `localhost:5173`, mounts 4 routers under `/api/`
- `api/routers/sync.py` — sync status/start/progress; runs `IngestionPipeline.full_sync()` in a background `threading.Thread`, tracks progress via module-level state dict
- `api/routers/analytics.py` — overview (total/unread/starred/categories/monthly_volume), senders, subscriptions (filtered senders), labels
- `api/routers/emails.py` — paginated email list with sender/label/unread/starred filters, search with hybrid/semantic/fulltext modes, single email fetch
- `api/routers/actions.py` — trash, mark-read, label (create if missing), trash-sender (fetches all from ChromaDB, trashes via Gmail API, removes from ChromaDB)

### React frontend (`frontend/`)
- Stack: Vite + React 18 + TailwindCSS v3 + React Router v6 + Recharts
- Vite proxy: `/api` → `http://localhost:8000`
- Views: Overview (stat cards + monthly bar chart + categories), Senders (table with subscription badge + actions), Subscriptions (filtered view + bulk Trash All), Browse (paginated with filter bar + checkbox multi-select + bulk actions), Search (query input + mode selector + scored results)
- Components: Sidebar (nav), SyncBar (status + sync button + spinner), EmailRow (shared list row), BulkActionBar (contextual trash/mark-read)

### How to run
```
# Terminal 1 — Backend (re-auth first if token.json exists)
rm token.json  # if upgrading from readonly scope
poetry run python examples/01_setup.py
poetry run uvicorn api.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend && npm run dev
# Open: http://localhost:5173

# Ingest emails (run in background while building)
poetry run python examples/02_ingest.py --days 90 --max 100000
```

### Current file structure
```
gmail_parser/   auth.py, client.py, ingestion.py, search.py, store.py (all modified)
api/            main.py, routers/{sync,analytics,emails,actions}.py
frontend/       package.json, vite.config.js, tailwind.config.js, postcss.config.js, index.html
                src/{main,App,api}.jsx + views/{Overview,Senders,Subscriptions,Browse,Search}.jsx
                src/components/{Sidebar,SyncBar,EmailRow,BulkActionBar}.jsx
```

---


## 2026-02-14: Further Rate Limit Mitigation + Failure Tracking

User was only seeing 200 emails for 90 days — caused by two issues:

1. **`--max 200` default was capping results**: The `02_ingest.py` script had a default limit of 200. Increased to 5000.
2. **Rate limiting still too aggressive**: Despite v0.2.1 fixes, 429 errors were still frequent.

Changes:
- **`client.py`**: Reduced batch size 25 → 10, increased inter-batch delay 0.5s → 2.0s, increased max retries 5 → 7, backoff formula now `min(2^(attempt+1), 64) + random(0,2)` for more aggressive backoff
- **`client.py`**: `batch_get_messages()` now returns `tuple[list[dict], list[str]]` — (results, permanently_failed_ids). Separates rate-limited (retryable) from non-retryable errors.
- **`ingestion.py`**: `full_sync()` and `incremental_sync()` now track and log failed message IDs with counts. Final summary distinguishes successful vs failed.
- **`02_ingest.py`**: Default `--max` raised from 200 to 5000.

All 19 tests pass.

## 2026-02-14: Fix Gmail API 429 Rate Limiting in Batch Requests (v0.2.1)

`batch_get_messages()` was silently dropping messages that hit Gmail's "Too many concurrent requests for user" 429 limit. Fixed with:

- **Reduced batch size**: 50 -> 25 requests per batch (Google recommends smaller batches to avoid triggering rate limits)
- **Inter-batch delay**: 0.5s pause between consecutive batch executions
- **Exponential backoff with jitter**: Failed 429 messages are collected and retried up to 5 times with `min(2^attempt, 32) + random(0,1)` second delays
- **Preserved ordering**: Results returned in original `message_ids` order using a dict keyed by message ID
- Only 429 errors trigger retries; other errors are still logged and skipped

No new dependencies -- uses stdlib `time` and `random`. All 19 tests pass.

---

## 2026-02-13: Replace PostgreSQL with ChromaDB (v0.2.0)

### What changed
Replaced the entire data layer (PostgreSQL + pgvector + SQLAlchemy + asyncpg + alembic) with ChromaDB, an embedded vector database. The library is now fully self-contained -- no database server, no migrations, no async complexity. Just `poetry install` and go.

### Removed
- `models.py` (SQLAlchemy ORM), `database.py` (async engine), `alembic/`, `alembic.ini`
- Dependencies: `sqlalchemy`, `asyncpg`, `pgvector`, `alembic`, `pytest-asyncio`

### Added
- `store.py` -- `EmailStore` wrapping ChromaDB (`PersistentClient`, 3 collections: emails, labels, sync_state)
- Dependency: `chromadb ^0.6`

### Rewritten
- `config.py` -- removed `database_url`, added `chroma_persist_dir` (default `./email_data`), all fields now have defaults (zero env vars needed)
- `ingestion.py` -- now fully sync (no async), uses `EmailStore`, labels stored as pipe-delimited metadata
- `search.py` -- now fully sync, semantic search via ChromaDB `query()`, fulltext via substring matching, analytics via Python `Counter` aggregation
- `exceptions.py` -- `DatabaseError` -> `StoreError`
- `__init__.py` -- updated exports
- All 5 examples -- removed asyncio, simplified (no Database setup)
- All tests -- added 7 ChromaDB store tests, kept existing 12 (19 total passing)
- README -- drastically simplified setup (no PostgreSQL, no migrations, 3-step quick start)

### ChromaDB data model
- **emails collection**: id=`gmail_id`, document=`body_text`, embedding=384-dim, metadata=flat dict (subject, sender, date_timestamp, is_read, labels as pipe-delimited string, etc.)
- **labels collection**: id=`gmail_label_id`, metadata=name/type/colors
- **sync_state collection**: single doc id=`"state"`, metadata=last_history_id/last_full_sync/total_emails_synced

### Current architecture
Gmail API (sync) -> IngestionPipeline (sync) -> ChromaDB (embedded) -> EmailSearch (sync)

### Current file list
```
email_parser/
  __init__.py, config.py, auth.py, client.py, embeddings.py,
  store.py, ingestion.py, search.py, exceptions.py
examples/
  01_setup.py, 02_ingest.py, 03_search.py, 04_analytics.py, 05_filter.py
tests/
  conftest.py, test_client.py, test_embeddings.py, test_ingestion.py, test_store.py
```

---

## 2026-02-13: CSV Export, Telemetry Fix, Open Source Prep

- Added `export_csv()` to `EmailSearch` with optional filters and custom column selection
- Added `examples/06_export_csv.py` with CLI flags for filtered exports
- Fixed ChromaDB telemetry errors: posthog v7 broke ChromaDB's `capture()` call signature. Pinned `posthog>=2.4.0,<4.0.0` and pass `Settings(anonymized_telemetry=False)` to `PersistentClient`
- Changed Gmail scopes to `gmail.readonly` only (removed `gmail.modify` and `gmail.labels`)
- Cleaned up for open source: added LICENSE (MIT), updated .gitignore (csv, .claude/), added GitHub install instructions to README

## 2026-02-13: Time-Based Ingestion Filters

- Added `build_time_query()` and time filter params to `full_sync()`: `after`, `before`, `newer_than`, `older_than`, `days_ago`
- All filters composable with `query`, `label_ids`, `max_emails`

## 2026-02-13: Initial Implementation (v0.1.0)

- Full library built with PostgreSQL + pgvector + SQLAlchemy (async) + alembic
- Gmail API wrapper, OAuth2 auth, ingestion pipeline, semantic/hybrid search
- Superseded by v0.2.0 ChromaDB migration above
