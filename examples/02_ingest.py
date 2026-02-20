"""
Ingest emails with time-based filters.

Usage:
    poetry run python examples/02_ingest.py                  # last 7 days (default)
    poetry run python examples/02_ingest.py --all            # all emails (no date filter)
    poetry run python examples/02_ingest.py --days 30        # last 30 days
    poetry run python examples/02_ingest.py --days 90        # last 3 months
    poetry run python examples/02_ingest.py --days 365       # last year
    poetry run python examples/02_ingest.py --newer 6m       # last 6 months (Gmail syntax)
    poetry run python examples/02_ingest.py --max 50         # limit to 50 emails
    poetry run python examples/02_ingest.py --query "from:boss@company.com" --days 60

Requires: 01_setup.py to have been run first.
"""
import argparse
import logging

from gmail_parser import IngestionPipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest Gmail emails")
    parser.add_argument("--all", action="store_true", help="Ingest all emails with no date filter")
    parser.add_argument("--days", type=int, default=7, help="Ingest emails from the last N days (default: 7)")
    parser.add_argument("--newer", type=str, help="Gmail relative time, e.g. '30d', '2m', '1y'")
    parser.add_argument("--max", type=int, default=100000, help="Max emails to ingest (default: 100000)")
    parser.add_argument("--query", type=str, default="", help="Additional Gmail search query")
    args = parser.parse_args()

    pipeline = IngestionPipeline()

    print("Syncing labels...")
    pipeline.sync_labels()

    kwargs = {"query": args.query, "max_emails": args.max}
    if getattr(args, "all"):
        print("Ingesting ALL emails (no date filter)...")
    elif args.newer:
        kwargs["newer_than"] = args.newer
        print(f"Ingesting emails from the last {args.newer}...")
    else:
        kwargs["days_ago"] = args.days
        print(f"Ingesting emails from the last {args.days} days...")

    count = pipeline.full_sync(**kwargs)
    print(f"Done — synced {count} emails")
