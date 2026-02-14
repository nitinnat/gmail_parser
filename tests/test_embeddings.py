from gmail_parser.embeddings import EmbeddingModel


def test_prepare_email_text():
    result = EmbeddingModel.prepare_email_text("Meeting", "Let's discuss the project.", "alice@co.com")
    assert "From: alice@co.com" in result
    assert "Subject: Meeting" in result
    assert "discuss the project" in result


def test_prepare_email_text_truncation():
    long_body = "x" * 2000
    result = EmbeddingModel.prepare_email_text("Sub", long_body, "a@b.com")
    # Body should be truncated to 1000 chars, plus header lines
    body_line = result.split("\n", 2)[2]
    assert len(body_line) <= 1000


def test_prepare_email_text_none_handling():
    result = EmbeddingModel.prepare_email_text(None, None, None)
    assert "From: " in result
    assert "Subject: " in result
