from gmail_parser.client import GmailClient


def test_parse_headers():
    headers = [
        {"name": "From", "value": "test@example.com"},
        {"name": "Subject", "value": "Hello"},
    ]
    result = GmailClient.parse_headers(headers)
    assert result == {"From": "test@example.com", "Subject": "Hello"}


def test_parse_message(sample_raw_message):
    parsed = GmailClient.parse_message(sample_raw_message)

    assert parsed["gmail_id"] == "msg_123"
    assert parsed["thread_id"] == "thread_456"
    assert parsed["subject"] == "Test Subject"
    assert parsed["sender"] == "sender@example.com"
    assert parsed["recipients"]["to"] == "recipient@example.com"
    assert parsed["is_read"] is False  # UNREAD label present
    assert parsed["is_starred"] is False
    assert parsed["body_text"] == "This is a test email body"
    assert parsed["snippet"] == "Test email snippet"


def test_parse_message_multipart():
    raw = {
        "id": "msg_multi",
        "threadId": "thread_1",
        "labelIds": ["INBOX"],
        "snippet": "",
        "historyId": "100",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": "a@b.com"},
                {"name": "Subject", "value": "Multi"},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {"data": "cGxhaW4gdGV4dA=="},  # "plain text"
                },
                {
                    "mimeType": "text/html",
                    "body": {"data": "PHA+aHRtbDwvcD4="},  # "<p>html</p>"
                },
            ],
        },
    }
    parsed = GmailClient.parse_message(raw)
    assert parsed["body_text"] == "plain text"
    assert "html" in parsed["body_html"]


def test_extract_attachments():
    payload = {
        "parts": [
            {
                "filename": "report.pdf",
                "mimeType": "application/pdf",
                "body": {"attachmentId": "att_1", "size": 5000},
            },
            {
                "filename": "",
                "mimeType": "text/plain",
                "body": {"data": "dGVzdA=="},
            },
        ]
    }
    attachments = GmailClient._extract_attachments(payload)
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "report.pdf"
    assert attachments[0]["size"] == 5000
