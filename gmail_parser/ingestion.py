import json
import logging
from datetime import UTC, datetime, timedelta

from gmail_parser.categorizer import categorize
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
            self._store.upsert_label(
                detail["id"],
                {
                    "name": detail["name"],
                    "type": detail.get("type", ""),
                    "message_list_visibility": detail.get("messageListVisibility", ""),
                    "label_list_visibility": detail.get("labelListVisibility", ""),
                    "text_color": color.get("textColor", ""),
                    "background_color": color.get("backgroundColor", ""),
                },
            )
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
        max_emails: int = 100000,
        label_ids: list[str] | None = None,
        after: datetime | None = None,
        before: datetime | None = None,
        newer_than: str | None = None,
        older_than: str | None = None,
        days_ago: int | None = None,
        progress_callback=None,
    ) -> int:
        # Always exclude trash and spam — we only want inbox/archive mail
        base = "-in:trash -in:spam"
        query = self.build_time_query(
            f"{base} {query}".strip(), after, before, newer_than, older_than, days_ago
        )
        logger.info(
            "[IngestionPipeline] starting full sync (max=%d, query='%s')",
            max_emails,
            query,
        )
        batch_size = settings.sync_batch_size

        message_stubs = self._client.list_messages(
            query=query, label_ids=label_ids, max_results=max_emails
        )
        total_messages = len(message_stubs)
        logger.info("[IngestionPipeline] found %d messages to sync", total_messages)
        if progress_callback:
            progress_callback(0, total_messages)

        # Build label gmail_id -> name mapping for pipe-delimited labels
        label_map = {l["gmail_id"]: l["name"] for l in self._store.get_labels()}

        total_synced = 0
        total_failed = 0
        all_failed_ids = []
        for i in range(0, total_messages, batch_size):
            chunk_ids = [m["id"] for m in message_stubs[i : i + batch_size]]
            existing = self._store.get_existing_ids(chunk_ids)
            new_ids = [mid for mid in chunk_ids if mid not in existing]
            if existing:
                logger.info(
                    "[IngestionPipeline] batch %d-%d: %d already stored, fetching %d new",
                    i,
                    i + len(chunk_ids),
                    len(existing),
                    len(new_ids),
                )
            if not new_ids:
                total_synced += len(chunk_ids)
                if progress_callback:
                    progress_callback(total_synced, total_messages)
                continue
            raw_messages, failed_ids = self._client.batch_get_messages(new_ids)
            if failed_ids:
                total_failed += len(failed_ids)
                all_failed_ids.extend(failed_ids)
                logger.warning(
                    "[IngestionPipeline] %d/%d messages failed in batch %d-%d",
                    len(failed_ids),
                    len(chunk_ids),
                    i,
                    i + len(chunk_ids),
                )

            parsed = [GmailClient.parse_message(m) for m in raw_messages]

            texts = [
                EmbeddingModel.prepare_email_text(
                    p["subject"], p["body_text"], p["sender"]
                )
                for p in parsed
            ]
            embeddings = self._embedding.encode_batch(texts)

            built_metadatas = [self._build_metadata(p, label_map) for p in parsed]
            ids = [p["gmail_id"] for p in parsed]
            documents = [p["body_text"] or "" for p in parsed]

            self._store.upsert_emails_batch(ids, documents, embeddings, built_metadatas)
            self._llm_post_process(parsed, built_metadatas)
            total_synced += len(parsed) + len(existing)
            logger.info(
                "[IngestionPipeline] synced batch %d-%d (%d new, %d skipped, %d failed)",
                i,
                i + len(chunk_ids),
                len(parsed),
                len(existing),
                len(failed_ids),
            )
            if progress_callback:
                progress_callback(total_synced, total_messages)

        # Deletion detection: remove emails that were deleted in Gmail within this sync's date range
        gmail_ids_set = {m["id"] for m in message_stubs}
        time_where: dict | None = None
        if days_ago is not None:
            after_ts = int((datetime.now(UTC) - timedelta(days=days_ago)).timestamp())
            time_where = {"date_timestamp": {"$gte": after_ts}}
        local_ids_in_range = set(self._store.get_all_ids(time_where))
        deleted_ids = local_ids_in_range - gmail_ids_set
        if deleted_ids:
            delete_list = list(deleted_ids)
            self._store.delete_emails(delete_list)
            self._store.delete_expenses(delete_list)
            logger.info(
                "[IngestionPipeline] removed %d emails deleted in Gmail",
                len(deleted_ids),
            )

        # Store current historyId so incremental_sync can pick up from here
        try:
            current_history_id = self._client.get_history_id()
        except Exception:
            current_history_id = ""

        self._update_sync_state(total_synced, current_history_id)
        if total_failed:
            logger.warning(
                "[IngestionPipeline] full sync complete: %d emails synced, %d FAILED (ids: %s)",
                total_synced,
                total_failed,
                all_failed_ids,
            )
        else:
            logger.info(
                "[IngestionPipeline] full sync complete: %d emails, 0 failures",
                total_synced,
            )
        return total_synced

    def incremental_sync(self) -> dict:
        state = self._store.get_sync_state()
        if not state or not state.get("last_history_id"):
            raise SyncError("No previous sync state found. Run full_sync first.")

        logger.info(
            "[IngestionPipeline] incremental sync from history_id=%s",
            state["last_history_id"],
        )
        try:
            history = self._client.list_history(state["last_history_id"])
        except Exception as e:
            logger.warning(
                "[IngestionPipeline] History API failed (%s) — falling back to 7-day sync", e
            )
            count = self.full_sync(max_emails=500, days_ago=7)
            return {"added": count, "deleted": 0, "refreshed": 0, "fallback": True}

        added_ids: set[str] = set()
        deleted_ids: set[str] = set()
        label_changed_ids: set[str] = set()

        for record in history:
            for msg in record.get("messagesAdded", []):
                added_ids.add(msg["message"]["id"])
            for msg in record.get("messagesDeleted", []):
                deleted_ids.add(msg["message"]["id"])
            for msg in record.get("labelsAdded", []):
                label_changed_ids.add(msg["message"]["id"])
            for msg in record.get("labelsRemoved", []):
                label_changed_ids.add(msg["message"]["id"])

        # Remove emails deleted in Gmail (skip any that were just added in this batch)
        to_delete = list(deleted_ids - added_ids)
        if to_delete:
            self._store.delete_emails(to_delete)
            self._store.delete_expenses(to_delete)
            logger.info(
                "[IngestionPipeline] incremental: deleted %d emails", len(to_delete)
            )

        # Refresh metadata (labels/read/starred) for label-changed emails.
        # If an email was moved to Trash or Spam, delete it instead of updating.
        refresh_ids = list(label_changed_ids - added_ids - deleted_ids)
        refreshed = 0
        if refresh_ids:
            label_map = {l["gmail_id"]: l["name"] for l in self._store.get_labels()}
            meta_messages, _ = self._client.batch_get_messages(
                refresh_ids, format="metadata"
            )
            update_ids = []
            update_metas = []
            trashed_ids = []
            for raw in meta_messages:
                p = GmailClient.parse_message_metadata(raw)
                if "TRASH" in p["label_ids"] or "SPAM" in p["label_ids"]:
                    trashed_ids.append(p["gmail_id"])
                else:
                    label_names = [label_map.get(lid, lid) for lid in p["label_ids"]]
                    labels_str = "|" + "|".join(label_names) + "|" if label_names else ""
                    update_ids.append(p["gmail_id"])
                    update_metas.append(
                        {
                            "labels": labels_str,
                            "is_read": p["is_read"],
                            "is_starred": p["is_starred"],
                            "history_id": p["history_id"],
                        }
                    )
            if trashed_ids:
                self._store.delete_emails(trashed_ids)
                self._store.delete_expenses(trashed_ids)
                logger.info(
                    "[IngestionPipeline] incremental: deleted %d trashed/spammed emails",
                    len(trashed_ids),
                )
            if update_ids:
                self._store.update_metadatas_batch(update_ids, update_metas)
            refreshed = len(update_ids)
            logger.info(
                "[IngestionPipeline] incremental: refreshed metadata for %d emails",
                refreshed,
            )

        # Fetch and store new emails
        added = 0
        if added_ids:
            label_map = {l["gmail_id"]: l["name"] for l in self._store.get_labels()}
            raw_messages, failed_ids = self._client.batch_get_messages(list(added_ids))
            if failed_ids:
                logger.warning(
                    "[IngestionPipeline] incremental: %d new emails failed to fetch",
                    len(failed_ids),
                )
            parsed = [GmailClient.parse_message(m) for m in raw_messages]
            texts = [
                EmbeddingModel.prepare_email_text(
                    p["subject"], p["body_text"], p["sender"]
                )
                for p in parsed
            ]
            embeddings = self._embedding.encode_batch(texts)
            built_metadatas = [self._build_metadata(p, label_map) for p in parsed]
            self._store.upsert_emails_batch(
                [p["gmail_id"] for p in parsed],
                [p["body_text"] or "" for p in parsed],
                embeddings,
                built_metadatas,
            )
            self._llm_post_process(parsed, built_metadatas)
            added = len(parsed)

        try:
            new_history_id = self._client.get_history_id()
        except Exception:
            new_history_id = state["last_history_id"]

        self._update_sync_state(added, new_history_id)
        logger.info(
            "[IngestionPipeline] incremental sync complete: +%d added, -%d deleted, %d metadata refreshed",
            added,
            len(to_delete),
            refreshed,
        )
        return {"added": added, "deleted": len(to_delete), "refreshed": refreshed}

    def reindex_embeddings(self, batch_size: int = 100) -> int:
        logger.info("[IngestionPipeline] reindexing all embeddings")
        all_emails = self._store.get_emails(limit=None)
        ids = all_emails["ids"]
        documents = all_emails["documents"]
        metadatas = all_emails["metadatas"]

        texts = [
            EmbeddingModel.prepare_email_text(
                m.get("subject", ""),
                doc,
                m.get("sender", ""),
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

        metadata = {
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
            "list_unsubscribe": parsed.get("raw_headers", {}).get(
                "List-Unsubscribe", ""
            ),
        }
        metadata["category"] = categorize(metadata)
        return metadata

    def _llm_post_process(self, parsed: list[dict], built_metadatas: list[dict]) -> None:
        if not parsed:
            return
        from gmail_parser.llm_extractor import extract_batch

        email_inputs = [
            {
                "id": p["gmail_id"],
                "subject": p.get("subject", ""),
                "sender": p.get("sender", ""),
                "snippet": p.get("snippet", ""),
                "metadata": m,
            }
            for p, m in zip(parsed, built_metadatas)
        ]

        try:
            results = extract_batch(email_inputs)
        except Exception as exc:
            logger.warning("[IngestionPipeline] LLM extraction failed: %s", exc)
            results = {}

        ids, updates = [], []
        for p in parsed:
            gid = p["gmail_id"]
            result = results.get(gid, {})
            action_items = result.get("action_items", [])
            spending = result.get("spending", {"is_transaction": False, "transactions": []})
            update: dict = {
                "actions_extracted": True,
                "action_items_json": json.dumps(action_items),
                "has_action_items": bool(action_items),
                "spending_json": json.dumps(spending),
                "has_transactions": bool(spending.get("transactions")),
            }
            if result.get("category"):
                update["category"] = result["category"]
                update["llm_categorized"] = True
            ids.append(gid)
            updates.append(update)

        self._store.update_metadatas_batch(ids, updates)
        action_count = sum(1 for u in updates if u.get("has_action_items"))
        logger.info(
            "[IngestionPipeline] LLM post-processed %d emails, %d with action items",
            len(ids),
            action_count,
        )

    def _update_sync_state(self, count: int, history_id: str = ""):
        state = self._store.get_sync_state()
        prev_count = state.get("total_emails_synced", 0) if state else 0
        self._store.update_sync_state(
            {
                "last_history_id": history_id,
                "last_full_sync": datetime.now(UTC).isoformat(),
                "total_emails_synced": prev_count + count,
            }
        )
