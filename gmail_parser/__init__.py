from gmail_parser.auth import GmailAuth
from gmail_parser.client import GmailClient
from gmail_parser.config import EmailParserSettings, settings
from gmail_parser.embeddings import EmbeddingModel
from gmail_parser.exceptions import (
    AuthenticationError,
    EmbeddingError,
    EmailParserError,
    GmailAPIError,
    SearchError,
    StoreError,
    SyncError,
)
from gmail_parser.ingestion import IngestionPipeline
from gmail_parser.search import EmailSearch, SearchFilters
from gmail_parser.store import EmailStore

__all__ = [
    "GmailAuth",
    "GmailClient",
    "EmailParserSettings",
    "settings",
    "EmailStore",
    "EmbeddingModel",
    "IngestionPipeline",
    "EmailSearch",
    "SearchFilters",
    "EmailParserError",
    "AuthenticationError",
    "GmailAPIError",
    "StoreError",
    "EmbeddingError",
    "SyncError",
    "SearchError",
]
