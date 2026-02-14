"""
Filter emails by sender, date, read status, attachments, etc.

Usage:
    poetry run python examples/05_filter.py --sender "alice"
    poetry run python examples/05_filter.py --unread
    poetry run python examples/05_filter.py --attachments
    poetry run python examples/05_filter.py --starred --limit 5
    poetry run python examples/05_filter.py --sender "bob" --unread --attachments

Requires: emails to have been ingested first (see 02_ingest.py).
"""
import argparse

from gmail_parser import EmailSearch, SearchFilters

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Filter ingested emails")
    parser.add_argument("--sender", type=str, help="Filter by sender (partial match)")
    parser.add_argument("--subject", type=str, help="Filter by subject (partial match)")
    parser.add_argument("--unread", action="store_true", help="Only unread emails")
    parser.add_argument("--starred", action="store_true", help="Only starred emails")
    parser.add_argument("--attachments", action="store_true", help="Only emails with attachments")
    parser.add_argument("--limit", type=int, default=20, help="Max results (default: 20)")
    args = parser.parse_args()

    filters = SearchFilters(
        sender=args.sender,
        subject_contains=args.subject,
        is_read=False if args.unread else None,
        is_starred=True if args.starred else None,
        has_attachments=True if args.attachments else None,
    )

    search = EmailSearch()
    emails = search.filter_emails(filters, limit=args.limit)

    if not emails:
        print("No emails match the filters.")
    else:
        print(f"Found {len(emails)} emails:\n")
        for i, email in enumerate(emails, 1):
            meta = email["metadata"]
            date_str = meta.get("date_iso", "no date")[:16]
            flags = ""
            if not meta.get("is_read", True):
                flags += " [unread]"
            if meta.get("is_starred", False):
                flags += " [starred]"
            if meta.get("has_attachments", False):
                flags += " [att]"
            print(f"{i:>2}. {date_str}  {meta.get('sender', '')}{flags}")
            print(f"    {meta.get('subject', '')}")
