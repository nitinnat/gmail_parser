import logging
from datetime import UTC, datetime, timedelta

from gmail_parser.client import GmailClient
from gmail_parser.config import settings
from gmail_parser.embeddings import EmbeddingModel
from gmail_parser.exceptions import SyncError
from gmail_parser.store import EmailStore

logger = logging.getLogger(__name__)


class IngestionPipeline:
    def __init__(
        self,
        client: GmailClient | None = None,
        store: EmailStore | None = None,
        embedding_model: EmbeddingModel | None = None,
    ):
        self._client = client or GmailClient()
        self._store = store or EmailStore()
        self._embedding = embedding_model or EmbeddingModel()

    def sync_labels(self):
        logger.info("[IngestionPipeline] syncing labels")
        raw_labels = self._client.list_labels()
        for rl in raw_labels:
            detail = self._client.get_label(rl["id"])
            color = detail.get("color", {})
            self._store.upsert_label(detail["id"], {
                "name": detail["name"],
                "type": detail.get("type", ""),
                "message_list_visibility": detail.get("messageListVisibility", ""),
                "label_list_visibility": detail.get("labelListVisibility", ""),
                "text_color": color.get("textColor", ""),
                "background_color": color.get("backgroundColor", ""),
            })
        logger.info("[IngestionPipeline] synced %d labels", len(raw_labels))

    @staticmethod
    def build_time_query(
        query: str = "",
        after: datetime | None = None,
        before: datetime | None = None,
        newer_than: str | None = None,
        older_than: str | None = None,
        days_ago: int | None = None,
    ) -> str:
        parts = [query] if query else []
        if days_ago is not None:
            after = datetime.now(UTC) - timedelta(days=days_ago)
        if after:
            parts.append(f"after:{int(after.timestamp())}")
        if before:
            parts.append(f"before:{int(before.timestamp())}")
        if newer_than:
            parts.append(f"newer_than:{newer_than}")
        if older_than:
            parts.append(f"older_than:{older_than}")
        return " ".join(parts)

    def full_sync(
        self,
        query: str = "",
        max_emails: int = 500,
        label_ids: list[str] | None = None,
        after: datetime | None = None,
        before: datetime | None = None,
        newer_than: str | None = None,
        older_than: str | None = None,
        days_ago: int | None = None,
    ) -> int:
        query = self.build_time_query(query, after, before, newer_than, older_than, days_ago)
        logger.info("[IngestionPipeline] starting full sync (max=%d, query='%s')", max_emails, query)
        batch_size = settings.sync_batch_size

        message_stubs = self._client.list_messages(query=query, label_ids=label_ids, max_results=max_emails)
        logger.info("[IngestionPipeline] found %d messages to sync", len(message_stubs))

        # Build label gmail_id -> name mapping for pipe-delimited labels
        label_map = {l["gmail_id"]: l["name"] for l in self._store.get_labels()}

        total_synced = 0
        for i in range(0, len(message_stubs), batch_size):
            chunk_ids = [m["id"] for m in message_stubs[i : i + batch_size]]
            raw_messages = self._client.batch_get_messages(chunk_ids)
            parsed = [GmailClient.parse_message(m) for m in raw_messages]

            texts = [
                EmbeddingModel.prepare_email_text(p["subject"], p["body_text"], p["sender"])
                for p in parsed
            ]
            embeddings = self._embedding.encode_batch(texts)

            ids = []
            documents = []
            metadatas = []
            for p in parsed:
                ids.append(p["gmail_id"])
                documents.append(p["body_text"] or "")
                metadatas.append(self._build_metadata(p, label_map))

            self._store.upsert_emails_batch(ids, documents, embeddings, metadatas)
            total_synced += len(parsed)
            logger.info("[IngestionPipeline] synced batch %d-%d", i, i + len(chunk_ids))

        self._update_sync_state(total_synced)
        logger.info("[IngestionPipeline] full sync complete: %d emails", total_synced)
        return total_synced

    def incremental_sync(self) -> int:
        state = self._store.get_sync_state()
        if not state or not state.get("last_history_id"):
            raise SyncError("No previous sync state found. Run full_sync first.")

        logger.info("[IngestionPipeline] incremental sync from history_id=%s", state["last_history_id"])
        try:
            history = self._client.list_history(state["last_history_id"])
        except Exception as e:
            raise SyncError(f"History API failed: {e}") from e

        added_ids = set()
        for record in history:
            for msg in record.get("messagesAdded", []):
                added_ids.add(msg["message"]["id"])

        if not added_ids:
            logger.info("[IngestionPipeline] no new messages since last sync")
            return 0

        label_map = {l["gmail_id"]: l["name"] for l in self._store.get_labels()}
        raw_messages = self._client.batch_get_messages(list(added_ids))
        parsed = [GmailClient.parse_message(m) for m in raw_messages]
        texts = [EmbeddingModel.prepare_email_text(p["subject"], p["body_text"], p["sender"]) for p in parsed]
        embeddings = self._embedding.encode_batch(texts)

        ids = [p["gmail_id"] for p in parsed]
        documents = [p["body_text"] or "" for p in parsed]
        metadatas = [self._build_metadata(p, label_map) for p in parsed]
        self._store.upsert_emails_batch(ids, documents, embeddings, metadatas)

        self._update_sync_state(len(parsed))
        logger.info("[IngestionPipeline] incremental sync complete: %d new emails", len(parsed))
        return len(parsed)

    def reindex_embeddings(self, batch_size: int = 100) -> int:
        logger.info("[IngestionPipeline] reindexing all embeddings")
        all_emails = self._store.get_emails(limit=None)
        ids = all_emails["ids"]
        documents = all_emails["documents"]
        metadatas = all_emails["metadatas"]

        texts = [
            EmbeddingModel.prepare_email_text(
                m.get("subject", ""), doc, m.get("sender", ""),
            )
            for doc, m in zip(documents, metadatas)
        ]

        embeddings = self._embedding.encode_batch(texts, batch_size=batch_size)
        self._store.upsert_emails_batch(ids, documents, embeddings, metadatas)
        logger.info("[IngestionPipeline] reindexed %d emails", len(ids))
        return len(ids)

    @staticmethod
    def _build_metadata(parsed: dict, label_map: dict) -> dict:
        label_names = [label_map.get(lid, lid) for lid in parsed.get("label_ids", [])]
        labels_str = "|" + "|".join(label_names) + "|" if label_names else ""

        recipients = parsed.get("recipients", {})
        date = parsed.get("date")

        return {
            "thread_id": parsed.get("thread_id", ""),
            "subject": parsed.get("subject", ""),
            "sender": parsed.get("sender", ""),
            "recipients_to": recipients.get("to", ""),
            "recipients_cc": recipients.get("cc", ""),
            "recipients_bcc": recipients.get("bcc", ""),
            "date_iso": date.isoformat() if date else "",
            "date_timestamp": int(date.timestamp()) if date else 0,
            "snippet": parsed.get("snippet", ""),
            "internal_date": parsed.get("internal_date", ""),
            "is_read": parsed.get("is_read", False),
            "is_starred": parsed.get("is_starred", False),
            "is_draft": parsed.get("is_draft", False),
            "has_attachments": parsed.get("has_attachments", False),
            "labels": labels_str,
            "history_id": parsed.get("history_id", ""),
            "size_estimate": parsed.get("size_estimate", 0),
        }

    def _update_sync_state(self, count: int):
        state = self._store.get_sync_state()
        prev_count = state.get("total_emails_synced", 0) if state else 0
        self._store.update_sync_state({
            "last_history_id": "",
            "last_full_sync": datetime.now(UTC).isoformat(),
            "total_emails_synced": prev_count + count,
        })
