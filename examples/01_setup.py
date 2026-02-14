"""
First-time setup: authenticate with Gmail.

Run this once before any other example:
    poetry run python examples/01_setup.py

Prerequisites:
    1. credentials.json in project root (from Google Cloud Console)
"""
import logging

from gmail_parser import GmailAuth

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

if __name__ == "__main__":
    auth = GmailAuth()
    auth.authenticate()
    print("Authentication successful — token.json saved")
    print("You can now run the other examples.")
