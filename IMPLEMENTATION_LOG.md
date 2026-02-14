# Implementation Log -- gmail-parser

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
