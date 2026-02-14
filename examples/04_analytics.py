"""
Show analytics on ingested emails: top senders, label distribution, daily volume.

Usage:
    poetry run python examples/04_analytics.py

Requires: emails to have been ingested first (see 02_ingest.py).
"""
from gmail_parser import EmailSearch

if __name__ == "__main__":
    search = EmailSearch()

    total = search.email_count()
    print(f"Total emails in database: {total}\n")

    print("--- Top 10 Senders ---")
    for s in search.count_by_sender(limit=10):
        print(f"  {s['count']:>4}  {s['sender']}")

    print("\n--- Emails per Label ---")
    for l in search.count_by_label():
        print(f"  {l['count']:>4}  {l['label']}")

    print("\n--- Daily Volume (last 14 entries) ---")
    for d in search.count_by_date(granularity="day")[-14:]:
        bar = "#" * min(d["count"], 50)
        print(f"  {d['period']}  {d['count']:>3}  {bar}")
