import pytest


@pytest.fixture
def sample_raw_message():
    return {
        "id": "msg_123",
        "threadId": "thread_456",
        "labelIds": ["INBOX", "UNREAD"],
        "snippet": "Test email snippet",
        "historyId": "12345",
        "internalDate": "1700000000000",
        "sizeEstimate": 1024,
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "sender@example.com"},
                {"name": "To", "value": "recipient@example.com"},
                {"name": "Subject", "value": "Test Subject"},
                {"name": "Date", "value": "Tue, 14 Nov 2023 12:00:00 +0000"},
            ],
            "body": {
                "data": "VGhpcyBpcyBhIHRlc3QgZW1haWwgYm9keQ==",  # "This is a test email body"
            },
            "parts": [],
        },
    }
