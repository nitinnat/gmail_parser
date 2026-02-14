class EmailParserError(Exception):
    pass


class AuthenticationError(EmailParserError):
    pass


class GmailAPIError(EmailParserError):
    pass


class StoreError(EmailParserError):
    pass


class EmbeddingError(EmailParserError):
    pass


class SyncError(EmailParserError):
    pass


class SearchError(EmailParserError):
    pass
