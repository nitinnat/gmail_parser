# LLM Integration Design

**Date:** 2026-02-22

## Overview

Replace heuristics-based email categorization with LLM batch inference routed through the local `opencode-fastapi` server at `localhost:8001`. Introduce LLM-powered action item extraction from emails, replacing the existing sender-rule Alerts system with a calendar UI that surfaces deadlines and to-dos.

---

## Section 1 — opencode-fastapi concurrency fix

The current `/run` endpoint uses `subprocess.run()` (blocking), which serialises all requests on the FastAPI event loop.

**Changes to `Projects/opencode-fastapi/main.py`:**
- Make `/run` `async def`
- Replace `subprocess.run()` with `asyncio.create_subprocess_exec()`
- Add a `asyncio.Semaphore` (default 8, configurable via `MAX_CONCURRENT` env var) to bound simultaneous subprocesses
- Strip ANSI escape codes from stderr before returning

---

## Section 2 — LLM categorization pipeline

### New files in `gmail_parser/`

**`llm_client.py`**
- Thin synchronous HTTP wrapper using `httpx` (sync)
- Posts to `http://localhost:8001/run` with a prompt string
- Returns the `stdout` string from the response
- Configurable via `LLM_API_URL` env var (default `http://localhost:8001/run`)
- Raises `LLMError` on non-2xx or timeout

**`llm_categorizer.py`**
- `categorize_batch(emails: list[dict]) -> dict[str, str]` — maps `gmail_id` → `category`
- Batches 40 emails per LLM call (id + subject + sender + snippet)
- Prompt asks for a JSON array: `[{"id": "...", "category": "..."}]` using the existing category list
- Falls back to regex `categorize()` per-email if LLM response is not valid JSON or a category is unrecognised
- Logs fallback count for observability

### Changes to `gmail_parser/ingestion.py`

- `_build_metadata()` continues to use regex heuristics for the initial category (keeps ingestion fast)
- After each `upsert_emails_batch()` call for new emails, call `llm_categorizer.categorize_batch()` on those IDs and update ChromaDB metadata with:
  - `category` — LLM-assigned value
  - `llm_categorized: true`
- On resync, `_build_metadata()` checks `llm_categorized` in existing metadata and skips LLM for already-processed emails

### Changes to `api/routers/sync.py`

- `/sync/categorize` endpoint gains an `uncategorized_only: bool = False` query param — when `true`, skips emails where `llm_categorized=true`

---

## Section 3 — Sync window

No changes required. The auto-sync loop already calls `incremental_sync()`, which uses Gmail's History API and naturally only fetches emails added or changed since the last sync. The 30s cadence + history API together form the rolling window the user described.

---

## Section 4 — Alerts revamp: action item extraction + calendar UI

### LLM extraction

After each incremental sync, for each newly added email, an LLM call extracts:

```json
{
  "action_items": [
    { "action": "Submit tax documents", "deadline": "2026-03-15", "urgency": "high" },
    { "action": "Reply to interview invite", "deadline": null, "urgency": "medium" }
  ]
}
```

Urgency values: `high`, `medium`, `low`.

Three new fields added to ChromaDB email metadata:
- `has_action_items: bool` — fast filter without deserialising JSON
- `action_items_json: str` — serialised JSON array of action item objects
- `actions_extracted: bool` — prevents re-processing on resync

Extraction runs in the same ingestion thread after categorization, batched 20 emails per LLM call.

### New file: `gmail_parser/action_extractor.py`

- `extract_actions_batch(emails: list[dict]) -> dict[str, list[dict]]` — maps `gmail_id` → list of action items
- Prompt includes subject + body snippet (first 500 chars), asks for the JSON schema above
- Emails with no action items return `{"action_items": []}`
- Falls back to empty list on parse failure

### Backend changes

- `api/routers/alert_rules.py` replaced by `api/routers/actions.py`
- `GET /api/actions` — returns all emails where `has_action_items=true`, action items parsed and grouped by deadline date; no-deadline items reported with `deadline: <today>`
- `POST /api/actions/{gmail_id}/dismiss` — appends item to `dismissed_actions.json` in the chroma persist dir; dismissed items are filtered out of `GET /api/actions`
- `App.jsx` route `/alerts` points to new `Actions` view; old `AlertRules` view removed

### Frontend: Actions view (replaces Alerts)

- **Weekly calendar grid** by default, toggle to monthly
- Each day cell lists action item chips, colour-coded by urgency: high = red, medium = amber, low = muted teal
- No-deadline items appear in today's cell
- Clicking a chip expands inline: full action text + "Open Email" button that fires `onOpenEmail` to the EmailPanel
- Past-due items remain visible with an overdue style (striped border) until dismissed
- Dismiss button (×) on each chip writes to `POST /api/actions/{gmail_id}/dismiss`

### Digest update

- `api/routers/digest.py` updated to call `localhost:8001/run` via `LLMClient` instead of calling the Anthropic API directly
- Removes the `DASHBOARD_LLM_API_KEY` dependency for digest summarization

---

## Rollout order

1. Fix opencode-fastapi concurrency
2. Add `llm_client.py` + `llm_categorizer.py`, wire into ingestion
3. Add `action_extractor.py`, wire into incremental sync
4. Replace `alert_rules.py` with `actions.py`
5. Build Actions calendar view
6. Update digest to use LLMClient
