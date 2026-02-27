import csv
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

_SUBSCRIPTION_RE = re.compile(
    r"noreply|no-reply|newsletter|notifications?|updates?|donotreply|marketing|digest|news@",
    re.IGNORECASE,
)
_SUBSCRIPTION_LABELS = frozenset({"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"})

from gmail_parser.embeddings import EmbeddingModel
from gmail_parser.store import EmailStore

logger = logging.getLogger(__name__)


@dataclass
class SearchFilters:
    sender: str | None = None
    recipients: str | None = None
    label: str | None = None
    category: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    has_attachments: bool | None = None
    is_read: bool | None = None
    is_starred: bool | None = None
    subject_contains: str | None = None


class EmailSearch:
    def __init__(self, store: EmailStore | None = None, embedding_model: EmbeddingModel | None = None):
        self._store = store or EmailStore()
        self._embedding = embedding_model or EmbeddingModel()

    # --- Core search methods ---

    def semantic_search(self, query: str, limit: int = 20, threshold: float | None = None) -> list[dict]:
        query_embedding = self._embedding.encode(query)
        result = self._store.query(query_embedding, n_results=limit)

        results = []
        for id_, doc, meta, dist in zip(result["ids"][0], result["documents"][0], result["metadatas"][0], result["distances"][0]):
            score = 1 - dist  # cosine distance -> similarity
            if threshold is not None and score < threshold:
                continue
            results.append({"id": id_, "document": doc, "metadata": meta, "score": score})
        results.sort(key=lambda x: x["metadata"].get("date_timestamp", 0), reverse=True)
        return results

    def fulltext_search(self, query: str, limit: int = 20) -> list[dict]:
        result = self._store.get_emails()  # fetch all — must scan full corpus
        query_lower = query.lower()

        matches = []
        for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"]):
            text = f"{meta.get('subject', '')} {doc}".lower()
            if query_lower in text:
                matches.append({"id": id_, "document": doc, "metadata": meta, "score": 1.0})
        matches.sort(key=lambda x: x["metadata"].get("date_timestamp", 0), reverse=True)
        return matches[:limit]

    def hybrid_search(
        self,
        query: str,
        limit: int = 20,
        semantic_weight: float = 0.7,
        filters: SearchFilters | None = None,
    ) -> list[dict]:
        k = 60  # RRF constant
        pool_size = limit * 10

        semantic_results = self.semantic_search(query, limit=pool_size)
        fulltext_results = self.fulltext_search(query, limit=pool_size)

        scores: dict[str, float] = {}
        result_map: dict[str, dict] = {}

        for rank, item in enumerate(semantic_results):
            eid = item["id"]
            scores[eid] = scores.get(eid, 0) + semantic_weight / (k + rank + 1)
            result_map[eid] = item

        for rank, item in enumerate(fulltext_results):
            eid = item["id"]
            scores[eid] = scores.get(eid, 0) + (1 - semantic_weight) / (k + rank + 1)
            if eid not in result_map:
                result_map[eid] = item

        sorted_ids = sorted(scores, key=lambda eid: scores[eid], reverse=True)

        if filters:
            sorted_ids = [eid for eid in sorted_ids if self._matches_filters(result_map[eid]["metadata"], filters)]

        # Guarantee exact fulltext matches are always included — RRF scoring alone
        # downweights items that appear only in fulltext, causing misses on exact keywords.
        fulltext_ids = [item["id"] for item in fulltext_results if item["id"] in result_map]
        hybrid_ids = [eid for eid in sorted_ids if eid not in set(fulltext_ids)]
        combined = (fulltext_ids + hybrid_ids)[:limit]

        candidates = [{**result_map[eid], "score": scores.get(eid, 0)} for eid in combined]
        candidates.sort(key=lambda x: x["metadata"].get("date_timestamp", 0), reverse=True)
        return candidates

    # --- Filtered queries ---

    def filter_emails(self, filters: SearchFilters, limit: int = 50, offset: int = 0) -> list[dict]:
        where = self._build_where(filters)
        # Fetch all matching so we can sort globally by date before paginating.
        # ChromaDB's .get() has no ORDER BY support and applies a default page limit,
        # so we must pass the full count to get all results then sort ourselves.
        result = self._store.get_emails(where=where or None, limit=self._store.count())
        combined = sorted(
            zip(result["ids"], result["documents"], result["metadatas"]),
            key=lambda x: x[2].get("date_timestamp", 0),
            reverse=True,
        )
        return [
            {"id": id_, "document": doc, "metadata": meta}
            for id_, doc, meta in combined[offset : offset + limit]
        ]

    # --- Convenience queries ---

    def get_email(self, gmail_id: str) -> dict | None:
        return self._store.get_email(gmail_id)

    def get_thread_emails(self, thread_id: str) -> list[dict]:
        result = self._store.get_emails(where={"thread_id": thread_id})
        return [
            {"id": id_, "document": doc, "metadata": meta}
            for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"])
        ]

    def get_emails_by_sender(self, sender: str, limit: int = 50) -> list[dict]:
        result = self._store.get_emails(where={"sender": {"$contains": sender}}, limit=limit)
        return [
            {"id": id_, "document": doc, "metadata": meta}
            for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"])
        ]

    def get_emails_by_label(self, label_name: str, limit: int = 50) -> list[dict]:
        result = self._store.get_emails(where={"labels": {"$contains": f"|{label_name}|"}}, limit=limit)
        return [
            {"id": id_, "document": doc, "metadata": meta}
            for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"])
        ]

    def get_emails_by_date_range(self, date_from: datetime, date_to: datetime, limit: int = 50) -> list[dict]:
        where = {"$and": [
            {"date_timestamp": {"$gte": int(date_from.timestamp())}},
            {"date_timestamp": {"$lte": int(date_to.timestamp())}},
        ]}
        result = self._store.get_emails(where=where, limit=limit)
        return [
            {"id": id_, "document": doc, "metadata": meta}
            for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"])
        ]

    # --- Analytics ---

    def count_by_sender(self, limit: int = 20) -> list[dict]:
        all_emails = self._store.get_all_emails(include=["metadatas"])
        counter = Counter(m.get("sender", "") for m in all_emails["metadatas"])
        return [{"sender": sender, "count": count} for sender, count in counter.most_common(limit)]

    def count_by_label(self) -> list[dict]:
        all_emails = self._store.get_all_emails(include=["metadatas"])
        counter: Counter = Counter()
        for m in all_emails["metadatas"]:
            labels_str = m.get("labels", "")
            for label in labels_str.strip("|").split("|"):
                if label:
                    counter[label] += 1
        return [{"label": label, "count": count} for label, count in counter.most_common()]

    def count_by_date(self, granularity: str = "day") -> list[dict]:
        all_emails = self._store.get_all_emails(include=["metadatas"])
        counter: Counter = Counter()
        for m in all_emails["metadatas"]:
            date_iso = m.get("date_iso", "")
            if not date_iso:
                continue
            try:
                dt = datetime.fromisoformat(date_iso)
            except ValueError:
                continue
            if granularity == "day":
                key = dt.strftime("%Y-%m-%d")
            elif granularity == "week":
                key = dt.strftime("%Y-W%W")
            elif granularity == "month":
                key = dt.strftime("%Y-%m")
            else:
                key = dt.strftime("%Y-%m-%d")
            counter[key] += 1
        return [{"period": period, "count": count} for period, count in sorted(counter.items())]

    def email_count(self) -> int:
        return self._store.count()

    def get_sender_analytics(self, limit: int = 200) -> list[dict]:
        all_emails = self._store.get_all_emails(include=["metadatas"])
        senders: dict[str, dict] = {}

        for meta in all_emails["metadatas"]:
            sender = meta.get("sender", "")
            if not sender:
                continue
            if sender not in senders:
                senders[sender] = {"count": 0, "unread_count": 0, "last_date": "", "has_unsubscribe": False, "labels": set(), "cat_counter": Counter()}
            s = senders[sender]
            s["count"] += 1
            if not meta.get("is_read", True):
                s["unread_count"] += 1
            date_iso = meta.get("date_iso", "")
            if date_iso > s["last_date"]:
                s["last_date"] = date_iso
            if meta.get("list_unsubscribe", ""):
                s["has_unsubscribe"] = True
            for lbl in meta.get("labels", "").strip("|").split("|"):
                if lbl:
                    s["labels"].add(lbl)
            s["cat_counter"][meta.get("category", "Other")] += 1

        results = []
        for sender, s in senders.items():
            is_subscription = (
                s["has_unsubscribe"]
                or bool(_SUBSCRIPTION_RE.search(sender))
                or bool(s["labels"] & _SUBSCRIPTION_LABELS)
                or s["count"] >= 5
            )
            results.append({
                "sender": sender,
                "count": s["count"],
                "unread_count": s["unread_count"],
                "last_date": s["last_date"],
                "has_list_unsubscribe": s["has_unsubscribe"],
                "is_subscription": is_subscription,
                "category": s["cat_counter"].most_common(1)[0][0] if s["cat_counter"] else "Other",
            })

        results.sort(key=lambda x: x["count"], reverse=True)
        return results[:limit]

    # --- Export ---

    CSV_COLUMNS = ["date", "sender", "subject", "recipients_to", "recipients_cc", "labels", "is_read", "is_starred", "has_attachments", "snippet", "gmail_id"]

    def export_csv(
        self,
        path: str | Path,
        filters: SearchFilters | None = None,
        columns: list[str] | None = None,
    ) -> int:
        where = self._build_where(filters) if filters else None
        result = self._store.get_emails(where=where)
        cols = columns or self.CSV_COLUMNS

        col_to_meta_key = {
            "date": "date_iso",
            "gmail_id": None,  # comes from id, not metadata
        }

        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(cols)
            for id_, meta in zip(result["ids"], result["metadatas"]):
                row = []
                for col in cols:
                    if col == "gmail_id":
                        row.append(id_)
                    else:
                        key = col_to_meta_key.get(col, col)
                        row.append(meta.get(key, ""))
                writer.writerow(row)

        count = len(result["ids"])
        logger.info("[EmailSearch] exported %d emails to %s", count, path)
        return count

    # --- Internal helpers ---

    @staticmethod
    def _build_where(filters: SearchFilters) -> dict | None:
        conditions = []
        if filters.sender:
            conditions.append({"sender": {"$contains": filters.sender}})
        if filters.date_from:
            conditions.append({"date_timestamp": {"$gte": int(filters.date_from.timestamp())}})
        if filters.date_to:
            conditions.append({"date_timestamp": {"$lte": int(filters.date_to.timestamp())}})
        if filters.has_attachments is not None:
            conditions.append({"has_attachments": filters.has_attachments})
        if filters.is_read is not None:
            conditions.append({"is_read": filters.is_read})
        if filters.is_starred is not None:
            conditions.append({"is_starred": filters.is_starred})
        if filters.subject_contains:
            conditions.append({"subject": {"$contains": filters.subject_contains}})
        if filters.label:
            conditions.append({"labels": {"$contains": f"|{filters.label}|"}})
        if filters.category:
            conditions.append({"category": filters.category})
        if filters.recipients:
            conditions.append({"recipients_to": {"$contains": filters.recipients}})

        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}

    @staticmethod
    def _matches_filters(metadata: dict, filters: SearchFilters) -> bool:
        if filters.sender and filters.sender.lower() not in metadata.get("sender", "").lower():
            return False
        if filters.date_from:
            ts = metadata.get("date_timestamp", 0)
            if ts < int(filters.date_from.timestamp()):
                return False
        if filters.date_to:
            ts = metadata.get("date_timestamp", 0)
            if ts > int(filters.date_to.timestamp()):
                return False
        if filters.has_attachments is not None and metadata.get("has_attachments") != filters.has_attachments:
            return False
        if filters.is_read is not None and metadata.get("is_read") != filters.is_read:
            return False
        if filters.is_starred is not None and metadata.get("is_starred") != filters.is_starred:
            return False
        if filters.subject_contains and filters.subject_contains.lower() not in metadata.get("subject", "").lower():
            return False
        if filters.category and metadata.get("category") != filters.category:
            return False
        return True
