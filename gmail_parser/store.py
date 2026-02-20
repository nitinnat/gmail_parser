import logging

import chromadb
from chromadb.config import Settings as ChromaSettings

from gmail_parser.config import settings

logger = logging.getLogger(__name__)


class EmailStore:
    def __init__(self, persist_dir: str | None = None):
        self._client = chromadb.PersistentClient(
            path=persist_dir or settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self._emails = self._client.get_or_create_collection(
            "emails", metadata={"hnsw:space": "cosine"},
        )
        self._labels = self._client.get_or_create_collection("labels")
        self._sync_state = self._client.get_or_create_collection("sync_state")
        logger.info("[EmailStore] initialized at %s", persist_dir or settings.chroma_persist_dir)

    # --- Emails ---

    def upsert_email(self, gmail_id: str, document: str, embedding: list[float], metadata: dict):
        self._emails.upsert(ids=[gmail_id], documents=[document], embeddings=[embedding], metadatas=[metadata])

    def upsert_emails_batch(self, ids: list[str], documents: list[str], embeddings: list[list[float]], metadatas: list[dict]):
        batch_size = 500
        for i in range(0, len(ids), batch_size):
            self._emails.upsert(
                ids=ids[i : i + batch_size],
                documents=documents[i : i + batch_size],
                embeddings=embeddings[i : i + batch_size],
                metadatas=metadatas[i : i + batch_size],
            )

    def get_email(self, gmail_id: str) -> dict | None:
        result = self._emails.get(ids=[gmail_id], include=["documents", "metadatas"])
        if not result["ids"]:
            return None
        return {"id": result["ids"][0], "document": result["documents"][0], "metadata": result["metadatas"][0]}

    def query(self, embedding: list[float], n_results: int = 10, where: dict | None = None, where_document: dict | None = None) -> dict:
        kwargs = {"query_embeddings": [embedding], "n_results": n_results, "include": ["documents", "metadatas", "distances"]}
        if where:
            kwargs["where"] = where
        if where_document:
            kwargs["where_document"] = where_document
        return self._emails.query(**kwargs)

    def get_emails(self, where: dict | None = None, limit: int | None = None, offset: int | None = None) -> dict:
        kwargs = {"include": ["documents", "metadatas"]}
        if where:
            kwargs["where"] = where
        if limit:
            kwargs["limit"] = limit
        if offset:
            kwargs["offset"] = offset
        return self._emails.get(**kwargs)

    def get_all_emails(self, include: list[str] | None = None) -> dict:
        return self._emails.get(include=include or ["metadatas"], limit=self._emails.count())

    def count(self) -> int:
        return self._emails.count()

    def update_metadatas_batch(self, ids: list[str], metadatas: list[dict]):
        batch_size = 500
        for i in range(0, len(ids), batch_size):
            self._emails.update(
                ids=ids[i : i + batch_size],
                metadatas=metadatas[i : i + batch_size],
            )

    def get_all_ids(self, where: dict | None = None) -> list[str]:
        kwargs: dict = {"include": [], "limit": self._emails.count()}
        if where:
            kwargs["where"] = where
        return self._emails.get(**kwargs)["ids"]

    def get_existing_ids(self, ids: list[str]) -> set[str]:
        result = self._emails.get(ids=ids, include=[])
        return set(result["ids"])

    def delete_emails(self, ids: list[str]):
        self._emails.delete(ids=ids)

    # --- Labels ---

    def upsert_label(self, gmail_id: str, metadata: dict):
        self._labels.upsert(ids=[gmail_id], documents=[metadata.get("name", "")], metadatas=[metadata])

    def get_labels(self) -> list[dict]:
        result = self._labels.get(include=["metadatas"])
        return [{"gmail_id": id_, **meta} for id_, meta in zip(result["ids"], result["metadatas"])]

    # --- Sync State ---

    def get_sync_state(self) -> dict | None:
        result = self._sync_state.get(ids=["state"], include=["metadatas"])
        if not result["ids"]:
            return None
        return result["metadatas"][0]

    def update_sync_state(self, metadata: dict):
        self._sync_state.upsert(ids=["state"], documents=["sync_state"], metadatas=[metadata])
