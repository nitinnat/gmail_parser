"""
Search ingested emails using semantic, fulltext, or hybrid search.

Usage:
    poetry run python examples/03_search.py "meeting notes"
    poetry run python examples/03_search.py "quarterly report" --mode fulltext
    poetry run python examples/03_search.py "project deadline" --mode hybrid
    poetry run python examples/03_search.py "invoice" --limit 5

Requires: emails to have been ingested first (see 02_ingest.py).
"""
import argparse

from gmail_parser import EmailSearch

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Search ingested emails")
    parser.add_argument("query", help="Search query text")
    parser.add_argument("--mode", choices=["semantic", "fulltext", "hybrid"], default="hybrid", help="Search mode (default: hybrid)")
    parser.add_argument("--limit", type=int, default=10, help="Number of results (default: 10)")
    args = parser.parse_args()

    search = EmailSearch()

    print(f"Searching ({args.mode}): '{args.query}'\n")

    if args.mode == "semantic":
        results = search.semantic_search(args.query, limit=args.limit)
    elif args.mode == "fulltext":
        results = search.fulltext_search(args.query, limit=args.limit)
    else:
        results = search.hybrid_search(args.query, limit=args.limit)

    if not results:
        print("No results found.")
    else:
        for i, r in enumerate(results, 1):
            meta = r["metadata"]
            date_str = meta.get("date_iso", "no date")[:16]
            print(f"{i:>2}. [{r['score']:.3f}] {date_str}  {meta.get('sender', '')}")
            print(f"    {meta.get('subject', '')}")
            snippet = meta.get("snippet", "")
            if snippet:
                print(f"    {snippet[:120]}...")
            print()
