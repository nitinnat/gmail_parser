# gmail-parser

Python library for Gmail email processing with semantic search. Zero-setup -- uses ChromaDB (embedded) so no database server required.

## Features

- **Gmail API integration** -- OAuth2 auth, read/filter/label/search messages, threads, and attachments
- **ChromaDB storage** -- embedded vector database, everything stored in a local directory
- **Semantic search** -- local `all-MiniLM-L6-v2` embeddings (384-dim, ~80MB model)
- **Hybrid search** -- combines semantic similarity + text matching via Reciprocal Rank Fusion
- **Metadata filtering** -- filter by sender, date, labels, read/unread, starred, attachments
- **Time-based ingestion** -- sync emails by relative time ("last 30 days"), absolute dates, or Gmail time syntax
- **Zero config** -- works out of the box, no environment variables or database setup needed

## Prerequisites

- Python 3.11+
- Google Cloud project with Gmail API enabled (free, no billing required)

That's it. No PostgreSQL, no Docker, no database server.

## Setup

### 1. Get Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API**: APIs & Services > Library > search "Gmail API" > Enable
4. Set up **OAuth consent screen**:
   - APIs & Services > OAuth consent screen
   - Choose External, fill in app name and your email
   - Add your Gmail address as a test user
5. Create **OAuth credentials**:
   - APIs & Services > Credentials > Create Credentials > OAuth client ID
   - Application type: **Desktop app**
   - Download the JSON and save as `credentials.json` in your project root

The Gmail API is **free** -- no billing or credit card needed.

### 2. Install

**Clone and develop locally:**

```bash
git clone https://github.com/nitinnat/gmail-parser.git
cd gmail-parser
poetry install
```

**Or install into another project:**

```bash
# via poetry
poetry add git+https://github.com/nitinnat/gmail-parser.git

# via pip
pip install git+https://github.com/nitinnat/gmail-parser.git
```

### 3. Authenticate and ingest

```bash
# First time: opens browser for Google OAuth
poetry run python examples/01_setup.py

# Ingest last 30 days of email
poetry run python examples/02_ingest.py --days 30

# Search your emails
poetry run python examples/03_search.py "meeting notes"
```

## Ingesting Emails by Time

```python
from email_parser import IngestionPipeline
from datetime import datetime

pipeline = IngestionPipeline()
pipeline.sync_labels()

# Last N days (shorthand)
pipeline.full_sync(days_ago=30)
pipeline.full_sync(days_ago=7)
pipeline.full_sync(days_ago=365)

# Absolute date range
pipeline.full_sync(after=datetime(2024, 1, 1), before=datetime(2024, 6, 30))

# Gmail relative syntax (d=days, m=months, y=years)
pipeline.full_sync(newer_than="6m")
pipeline.full_sync(older_than="1y")

# Combine with query and labels
pipeline.full_sync(days_ago=60, query="from:boss@company.com", label_ids=["INBOX"], max_emails=100)
```

| Parameter | Type | Example | Description |
|---|---|---|---|
| `days_ago` | `int` | `30` | Emails from the last N days |
| `after` | `datetime` | `datetime(2024, 6, 1)` | Emails after this date |
| `before` | `datetime` | `datetime(2024, 12, 31)` | Emails before this date |
| `newer_than` | `str` | `"30d"`, `"2m"`, `"1y"` | Gmail relative time |
| `older_than` | `str` | `"60d"`, `"6m"` | Gmail relative time |

## Searching Emails

```python
from email_parser import EmailSearch, SearchFilters
from datetime import datetime

search = EmailSearch()

# Semantic search (conceptual similarity)
results = search.semantic_search("quarterly financial report", limit=10)
for r in results:
    print(f"{r['score']:.3f} | {r['metadata']['subject']} | {r['metadata']['sender']}")

# Full-text search (substring match)
results = search.fulltext_search("budget meeting")

# Hybrid search (best quality -- combines semantic + text via RRF)
results = search.hybrid_search(
    "project deadline",
    filters=SearchFilters(sender="alice", date_from=datetime(2025, 1, 1), is_read=False),
)

# Filter without search
unread = search.filter_emails(SearchFilters(is_read=False, has_attachments=True))

# Convenience queries
thread = search.get_thread_emails("thread_id_here")
from_alice = search.get_emails_by_sender("alice@example.com")
labeled = search.get_emails_by_label("INBOX", limit=50)
recent = search.get_emails_by_date_range(datetime(2025, 1, 1), datetime(2025, 2, 1))

# Analytics
top_senders = search.count_by_sender(limit=10)
label_counts = search.count_by_label()
daily_counts = search.count_by_date(granularity="day")
total = search.email_count()
```

## Examples

Runnable scripts in `examples/`:

```bash
poetry run python examples/01_setup.py                          # one-time: OAuth auth
poetry run python examples/02_ingest.py --days 30               # ingest last 30 days
poetry run python examples/03_search.py "meeting notes"         # search emails
poetry run python examples/04_analytics.py                      # top senders, label counts, volume
poetry run python examples/05_filter.py --unread --attachments  # filter by flags
poetry run python examples/06_export_csv.py -o emails.csv       # export to CSV
```

Each script has `--help` for all options.

## Export

```python
from email_parser import EmailSearch, SearchFilters

search = EmailSearch()

# Export all emails to CSV
search.export_csv("emails.csv")

# Export with filters
search.export_csv("unread.csv", filters=SearchFilters(is_read=False))
search.export_csv("from_alice.csv", filters=SearchFilters(sender="alice"))

# Custom columns
search.export_csv("minimal.csv", columns=["date", "sender", "subject"])
```

## Configuration (Optional)

Everything works with defaults. To customize, set environment variables:

```bash
EMAIL_PARSER_CHROMA_PERSIST_DIR=./email_data     # where ChromaDB stores data (default: ./email_data)
EMAIL_PARSER_GOOGLE_CREDENTIALS_PATH=creds.json  # OAuth credentials file (default: credentials.json)
EMAIL_PARSER_GOOGLE_TOKEN_PATH=token.json        # saved auth token (default: token.json)
EMAIL_PARSER_EMBEDDING_MODEL=all-MiniLM-L6-v2   # embedding model (default: all-MiniLM-L6-v2)
EMAIL_PARSER_SYNC_BATCH_SIZE=100                  # emails per batch during sync (default: 100)
```

## Architecture

| Component | Technology |
|---|---|
| Gmail access | Google Gmail API + OAuth2 |
| Storage + vector search | ChromaDB (embedded, local directory) |
| Embeddings | `all-MiniLM-L6-v2` via sentence-transformers |
| Hybrid ranking | Reciprocal Rank Fusion (RRF) |
| Config | pydantic-settings (env vars, all optional) |

## License

MIT
