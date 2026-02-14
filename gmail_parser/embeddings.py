import logging
import re

from gmail_parser.config import settings
from gmail_parser.exceptions import EmbeddingError

logger = logging.getLogger(__name__)

MAX_BODY_CHARS = 1000


class EmbeddingModel:
    def __init__(self, model_name: str | None = None):
        self._model_name = model_name or settings.embedding_model
        self._model = None

    def load(self):
        if self._model:
            return
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("[EmbeddingModel] loading %s", self._model_name)
            self._model = SentenceTransformer(self._model_name)
        except Exception as e:
            raise EmbeddingError(f"Failed to load model {self._model_name}: {e}") from e

    def _ensure_loaded(self):
        if not self._model:
            self.load()

    def encode(self, text: str) -> list[float]:
        self._ensure_loaded()
        return self._model.encode(text, normalize_embeddings=True).tolist()

    def encode_batch(self, texts: list[str], batch_size: int = 32) -> list[list[float]]:
        self._ensure_loaded()
        return self._model.encode(texts, batch_size=batch_size, normalize_embeddings=True).tolist()

    @staticmethod
    def prepare_email_text(subject: str, body: str, sender: str) -> str:
        body = re.sub(r"\s+", " ", (body or "")).strip()[:MAX_BODY_CHARS]
        return f"From: {sender or ''}\nSubject: {subject or ''}\n{body}"
