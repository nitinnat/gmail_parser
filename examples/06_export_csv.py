"""
Export ingested emails to CSV.

Usage:
    poetry run python examples/06_export_csv.py                        # export all to emails.csv
    poetry run python examples/06_export_csv.py -o my_emails.csv       # custom output file
    poetry run python examples/06_export_csv.py --sender "alice"       # only from alice
    poetry run python examples/06_export_csv.py --unread               # only unread
    poetry run python examples/06_export_csv.py --attachments          # only with attachments

Requires: emails to have been ingested first (see 02_ingest.py).
"""
import argparse

from gmail_parser import EmailSearch, SearchFilters

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export emails to CSV")
    parser.add_argument("-o", "--output", type=str, default="emails.csv", help="Output CSV path (default: emails.csv)")
    parser.add_argument("--sender", type=str, help="Filter by sender")
    parser.add_argument("--subject", type=str, help="Filter by subject")
    parser.add_argument("--unread", action="store_true", help="Only unread")
    parser.add_argument("--starred", action="store_true", help="Only starred")
    parser.add_argument("--attachments", action="store_true", help="Only with attachments")
    args = parser.parse_args()

    filters = None
    if any([args.sender, args.subject, args.unread, args.starred, args.attachments]):
        filters = SearchFilters(
            sender=args.sender,
            subject_contains=args.subject,
            is_read=False if args.unread else None,
            is_starred=True if args.starred else None,
            has_attachments=True if args.attachments else None,
        )

    search = EmailSearch()
    count = search.export_csv(args.output, filters=filters)
    print(f"Exported {count} emails to {args.output}")
