import shutil
import tempfile

import pytest

from gmail_parser.store import EmailStore


@pytest.fixture
def store(tmp_path):
    return EmailStore(persist_dir=str(tmp_path / "test_data"))


def test_upsert_and_get_email(store):
    store.upsert_email("msg_1", "Hello world", [0.1] * 384, {"subject": "Test", "sender": "a@b.com"})
    result = store.get_email("msg_1")
    assert result is not None
    assert result["id"] == "msg_1"
    assert result["metadata"]["sender"] == "a@b.com"


def test_get_nonexistent_email(store):
    assert store.get_email("nonexistent") is None


def test_count(store):
    assert store.count() == 0
    store.upsert_email("msg_1", "Hello", [0.1] * 384, {"subject": "A"})
    store.upsert_email("msg_2", "World", [0.2] * 384, {"subject": "B"})
    assert store.count() == 2


def test_upsert_idempotent(store):
    store.upsert_email("msg_1", "Hello", [0.1] * 384, {"subject": "V1"})
    store.upsert_email("msg_1", "Updated", [0.1] * 384, {"subject": "V2"})
    assert store.count() == 1
    result = store.get_email("msg_1")
    assert result["metadata"]["subject"] == "V2"
    assert result["document"] == "Updated"


def test_labels(store):
    store.upsert_label("INBOX", {"name": "INBOX", "type": "system"})
    store.upsert_label("STARRED", {"name": "STARRED", "type": "system"})
    labels = store.get_labels()
    assert len(labels) == 2
    names = {l["name"] for l in labels}
    assert names == {"INBOX", "STARRED"}


def test_sync_state(store):
    assert store.get_sync_state() is None
    store.update_sync_state({"last_history_id": "123", "total_emails_synced": 10})
    state = store.get_sync_state()
    assert state["last_history_id"] == "123"
    assert state["total_emails_synced"] == 10


def test_query(store):
    store.upsert_email("msg_1", "Meeting notes for project", [0.5] * 384, {"subject": "Meeting", "sender": "a@b.com"})
    store.upsert_email("msg_2", "Invoice attached", [0.1] * 384, {"subject": "Invoice", "sender": "c@d.com"})
    results = store.query([0.5] * 384, n_results=1)
    assert results["ids"][0][0] == "msg_1"
