# Implementation Log -- gmail-parser

## 2026-02-20: Cloudflare Tunnel Deployment, Google OAuth (Web App), Mobile UX, Triage View

### Deployment: Cloudflare Tunnel + Public HTTPS

Set up public access via Cloudflare Tunnel (`cloudflared`) at `https://emailcollie.nitinnataraj.com`.

- **`start.sh`**: Added `--proxy-headers --forwarded-allow-ips="*"` to uvicorn so it trusts `X-Forwarded-Proto: https` from Cloudflare; sets `OAUTHLIB_RELAX_TOKEN_SCOPE=1` globally.
- **`api/settings.py`**: Added `DASHBOARD_HTTPS_ONLY` env var (default `false`); cookie `https_only` flag respects this.
- **`.env`**: Configures Web App OAuth client, redirect URI, allowed email, HTTPS-only flag.

### Auth: Migrate to Web App Client + OAuth Fixes

Previous setup used a Desktop-type OAuth client which doesn't support web redirect URIs.

**Root causes debugged and fixed:**
1. **`redirect_uri_mismatch` (cause 1)**: `DASHBOARD_GOOGLE_CLIENT_ID` was empty, code fell back to `credentials.json` (Desktop app) which has different redirect URIs. Fix: user populated `.env` with Web App credentials.
2. **`redirect_uri_mismatch` (cause 2)**: Stale process still using old credentials after `.env` update; required restart.
3. **`invalid_grant`**: `include_granted_scopes=true` caused Gmail scopes to appear in the authorization response; `requests_oauthlib` included them in token exchange which Google rejected. Fix: removed `include_granted_scopes`, moved `OAUTHLIB_RELAX_TOKEN_SCOPE=1` outside localhost-only block.

**`api/routers/auth.py`** changes:
- Belt-and-suspenders `http://` → `https://` rewrite for `authorization_response` (handles Cloudflare stripping HTTPS).
- Removed `include_granted_scopes="true"` from `authorization_url()`.
- Changed `prompt="consent"` → `prompt="select_account"`.
- Moved `OAUTHLIB_RELAX_TOKEN_SCOPE=1` to top-level (not inside localhost branch).

### Mobile UX Overhaul

**`frontend/src/App.jsx`**:
- Added `sidebarOpen` state and `logout` function.
- Mobile top bar (`md:hidden`): hamburger button → opens sidebar drawer, app name, logout button.
- Content padding: `p-7` → `p-4 md:p-7`.

**`frontend/src/components/Sidebar.jsx`**:
- Accepts `open` / `onClose` props.
- Desktop: `hidden md:flex w-52` static sidebar.
- Mobile: `md:hidden fixed inset-0 z-50` overlay drawer with backdrop; nav links call `onClose` to auto-close.

**`frontend/src/components/SyncBar.jsx`**:
- Hides non-essential info on mobile (email count, last sync date, separators, auto-sync countdown) with `hidden md:inline`.
- Compact gap/padding: `gap-2 md:gap-5 px-4 md:px-7`.

**`frontend/src/views/Subscriptions.jsx`** and **`frontend/src/views/Senders.jsx`**:
- Wrapped table in `overflow-x-auto` div + inner `min-width` div so tables scroll horizontally on narrow screens instead of collapsing.

**`frontend/src/views/Triage.jsx`** (new view):
- Category badge: `hidden md:inline`.
- Action buttons (Mark Read, Open ↗): `hidden md:flex`.
- Mobile-only compact ↗ link: `md:hidden`.
- Bucket description text: `hidden md:inline`.

**`frontend/src/views/Overview.jsx`**:
- Stat cards: `grid-cols-2 md:grid-cols-4`.
- Insight chips: `grid-cols-2 md:grid-cols-4`.

### Inbox Triage View (`/triage`)

New `frontend/src/views/Triage.jsx`:
- Three priority buckets: **Reply** (people waiting on you), **Do** (deadlines/confirmations), **Read** (unread non-subscription).
- Day filter: 3d / 7d / 14d / 30d.
- Per-email: subject, sender, category badge (desktop), date, Mark Read action, Gmail deep-link.
- Mark-read updates local state optimistically.
- Backed by `GET /api/analytics/triage?days=N` (new endpoint in `api/routers/analytics.py`).

### Email Digest Endpoint

New `api/routers/digest.py`:
- `GET /api/digest/daily` — returns a structured daily digest: unread count, action items (reply/do buckets from triage), recent newsletters, subscription senders.
- Mounted in `api/main.py`.

### Auto-Sync Defaults

**`api/routers/sync.py`**:
- Changed default: `enabled=True`, `interval_hours=0.25` (15 min), `next_run = time.time() + 0.25 * 3600`.
- Previously: disabled, 2-hour interval.

---

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

## 2026-02-19: Secure Dashboard Auth + Spending + Rules

### Changes

**Auth (FastAPI + React)**
- Added Google OAuth login with signed session cookies and single-email allowlist.
- New auth router: `api/routers/auth.py` (`/api/auth/login`, `/callback`, `/me`, `/logout`).
- Session middleware configured in `api/main.py`; frontend guarded via `frontend/src/AuthGate.jsx` and `frontend/src/views/Login.jsx`.
- Local dev support for HTTP callbacks (`OAUTHLIB_INSECURE_TRANSPORT=1`) and relaxed scope mismatch handling.
- Auto-generates session secret on first run and persists under `<chroma_persist_dir>/dashboard_session_secret.txt`.

**Spending dashboard**
- Added expense extraction module `gmail_parser/expenses.py` (regex-based amounts + merchant hints).
- New `expenses` ChromaDB collection via `gmail_parser/store.py` with CRUD helpers.
- New API router `api/routers/expenses.py` with rules, reprocess, overrides, transactions, and overview analytics.
- New UI at `/spending` with totals, trends, top categories/merchants, and rules editor (`frontend/src/views/Spending.jsx`).
- Rules stored at `<chroma_persist_dir>/expense_rules.json`.

**Inbox automation rules**
- Added `api/routers/rules.py` with sender/keyword/label triggers and actions (mark-read, trash, label).
- Rules UI at `/rules` (`frontend/src/views/Rules.jsx`) with preview and run.
- Rules stored at `<chroma_persist_dir>/inbox_rules.json`.

**Sync + cleanup integration**
- Deleting emails now deletes corresponding expenses (trash actions and sync deletions).
- Sync cache invalidation expanded to include expense analytics.

### Notes
- OAuth callbacks expect redirect URIs that match the host you use (`localhost` vs `127.0.0.1`).
- For production, set explicit OAuth env vars and use HTTPS-only cookies.

---

## 2026-02-20: Spending — Merchant Extraction, UX Polish & Bug Fixes

### Changes

**`gmail_parser/expenses.py`** — Replaced single `_MERCHANT_RE` with `_MERCHANT_PATTERNS`, an ordered list of 4 sender-specific patterns (first match wins):
1. **WF** — `\bMerchant detail\s+([A-Z][A-Z0-9 *&.'\-]{2,}?)` with case-sensitive lookahead to stop at lowercase "in <CITY>" or Title-cased words. Handles processor-prefixed names like `DD *MERCHANT` (asterisk in char class).
2. **Chase** — `\btransaction with\s+(?:(?:TST|SQ|SQU|PMT)\*\s*)?...` strips known processor prefixes, lookahead handles trailing " -" and bare newline in email subjects.
3. **Amex** — `([A-Z][A-Z0-9 &.'\-]{4,}?)\s+(?:\$|INR\s*)[0-9,]+\.[0-9]{2}\*` matches all-caps merchant name before starred amount in USD or INR format (e.g. `SOME MERCHANT $X.XX*`, `INTL MERCHANT INR X,XXX.XX*`).
4. **Privacy.com / generic** — `\b(?:authorized at|purchased at|at)\s+([A-Za-z0-9][\w *&.'\-]{1,}?)` with `{1,}` minimum to handle short names like "WL *Steam".

Root causes that were fixed: old `_MERCHANT_RE` used "at|from|merchant|store" as prepositions without context → captured "detail" (WF), single word only (Chase), "directly." (Amex boilerplate "contacting the merchant directly"), or None (Privacy.com). New patterns are sender-context-aware and non-overlapping.

**`email_data/expense_rules.json`** — Updated Privacy.com rule from `senders: ["support@privacy.com"]` to `keywords: ["was authorized at"]`. Reason: sender-based rule matched ALL emails from that address including promotional "Upgrade your Privacy plan" emails that contained $4,500 plan pricing which was extracted as a spurious transaction.

**`api/routers/expenses.py`** — Raised transactions endpoint `limit` cap from `le=200` to `le=1000` (frontend was requesting 500, getting 422 validation errors).

**`frontend/src/views/Spending.jsx`**
- **Column sorting**: `sort` state `{key, dir}`, all column headers are clickable buttons with ↑↓↕ indicators, applied in `displayTransactions` useMemo via generic comparator.
- **Bar chart period filter**: clicking any bar on the monthly spending chart sets `periodFilter` (YYYY-MM string); dims other bars via Recharts `Cell` components; "×" clear button in chart header; `displayTransactions` filters transactions by `date_iso.startsWith(periodFilter)`.
- **Reprocess stale-rules bug fix**: `reprocess()` now fetches fresh rules from the server (`api.expenses.getRules()`) before writing, so system rules in the JSON file are never overwritten by stale component state loaded at mount time. This was the root cause of the Privacy.com keyword fix being silently reverted on every Reprocess click.

### Bug Root Causes Fixed
- **"detail" as merchant (WF)**: `_MERCHANT_RE` matched "merchant" as preposition, grabbed next word "detail"; fixed with `Merchant detail` exact-phrase pattern.
- **Single-word merchant (Chase)**: no spaces in old char class; fixed with space-inclusive class + processor-prefix stripper.
- **"directly." as merchant (Amex)**: old regex matched "merchant" in footer boilerplate "contacting the merchant directly"; fixed by removing generic "merchant" preposition and using Amex's starred-amount anchor.
- **Privacy.com $4,500 false positive**: sender-based rule matched promo emails; switched to keyword `"was authorized at"` which only appears in actual authorization emails.
- **Rules JSON silently reverted on Reprocess**: React component read rules from state (populated at mount), so clicking Reprocess would overwrite the JSON with old values every time; fixed by fetching current server state first.
- **INR transactions extracted as USD**: Amex pattern only matched `\$` prefix, missing international purchases with `MERCHANT INR X,XXX.00*` format; extended to `(?:\$|INR\s*)`.

---

## 2026-02-20: Spending — Keyword-Based Charge Detection + Extraction Fixes

### Analysis
Analyzed Money-category emails across all senders to identify which actually contain per-transaction charge data:
- **`no.reply.alerts@chase.com`**: sends both balance alerts ("Your Amazon Visa balance is $X") and transaction alerts ("You made a $X.XX transaction with MERCHANT"). Amount is in the SUBJECT for transaction alerts.
- **`AmericanExpress@welcome.americanexpress.com`**: "Large Purchase Approved" emails have format "MERCHANT $X.XX*" after a threshold notice "more than $1.00". Weekly snapshots ("Here's your weekly account snapshot") are NOT charges.
- **`alerts@notify.wellsfargo.com`**: sends balance updates, statements, Zelle transfers, AND "You made a credit card purchase of $X" alerts. Only the credit card purchase subjects are charges.
- **`support@privacy.com`**: ALL emails are charge authorizations ("$X.XX was authorized at MERCHANT"). Most reliable sender.
- **`nerdwallet@mail.nerdwallet.com`**, **`venmo@email.venmo.com`**, **`americanexpress@member.americanexpress.com`**, **`no_reply@mcmap.chase.com`**: marketing/rewards, NOT charges.

### Changes

**`gmail_parser/expenses.py`**
- Added `_THRESHOLD_CONTEXT_RE` to strip "more than $X" / "over $X" phrases before amount extraction, fixing Amex emails where the threshold notification amount ($1.00) appeared before the actual purchase amount.

**`email_data/expense_rules.json`**
- Replaced single category-based rule with 5 targeted rules:
  - *Chase Transactions* (keyword: "you made a $") — matches transaction alerts, excludes balance alerts
  - *Privacy.com* (sender: support@privacy.com) — all emails are charges
  - *Amex Large Purchases* (keyword: "large purchase approved") — matches purchase alerts, excludes weekly snapshots
  - *WF Credit Card* (keyword: "credit card purchase of") — matches credit card purchase emails, excludes balance/statement/Zelle
  - *Custom Senders* (empty, user-managed) — for adding new card alert senders
- System rules marked with `"system": true` so UI can distinguish them from user-managed senders.

**`api/routers/expenses.py`**
- Added `system: bool = False` field to `ExpenseRule` model.
- Updated `_load_rules()` default to the new 5-rule structure.

**`frontend/src/views/Spending.jsx`**
- Replaced category chip + sender UI with two-section Sources panel:
  - *Detected*: read-only chips showing system rule names (auto-configured based on email analysis)
  - *Custom Senders*: editable tags + autocomplete for adding new card alert senders
- Reprocess now preserves system rules and only updates the "Custom Senders" rule (no longer overwrites all rules with a single category-based rule).
- Category chips moved to a display-only filter bar above the transactions table (no effect on reprocess).

### Validation
All 8 rule-matching test cases pass (charge emails match rules, balance/statement/snapshot emails produce no match). Amex extraction correctly returns the purchase amount instead of the $1.00 notification threshold.

---

## 2026-02-20: Spending UX Rework + Auth Debugging (Incomplete)

### Changes

**Spending UX rework**
- Simplified the Spending page to focus on a single flow: choose categories + senders → Apply & Reprocess → view totals/transactions.
- Removed extra inputs (labels/keywords/advanced filters) and restructured layout.
- Added sender search and filtering by selected categories.
- Totals and charts now computed from filtered transactions, not global totals.

**Spending extraction diagnostics**
- Reprocess now returns counts: matched emails, extracted amounts, missing amounts.
- Status line shows those counts after reprocess to explain failures.

**Category matching fix**
- Reprocess now computes category via categorizer when metadata is missing, so “Money” matches work on older data.

### Failures / Known Issues

- **OAuth flow instability (localhost)**: multiple iterations were needed to align redirect URI/cookie origins and allow HTTP in dev. The flow remains fragile across `localhost` vs `127.0.0.1` and required special-casing.
- **Spending extraction accuracy**: regex extraction did not reliably parse amounts for the user’s email formats; resulted in 0 extracted transactions after reprocess. Requires new parsing rules and real email samples for tuning.
- **Spending UX iterations**: multiple UI rewrites introduced confusion and inconsistency before settling on a simpler flow; user feedback indicated UX was still unacceptable at time of handoff.

### Files Touched

- `frontend/src/views/Spending.jsx`
- `api/routers/expenses.py`
- `api/routers/auth.py`
- `api/settings.py`
- `credentials.json`

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
