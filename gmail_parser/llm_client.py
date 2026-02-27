import logging
import os

import httpx

logger = logging.getLogger(__name__)

LLM_URL = os.getenv("LLM_API_URL", "http://localhost:8001/run")


class LLMError(Exception):
    pass


def call_llm(prompt: str, timeout: float = 90.0) -> str:
    try:
        r = httpx.post(
            LLM_URL,
            json={"prompt": prompt, "timeout_seconds": min(timeout, 590)},
            timeout=timeout + 10,
        )
        r.raise_for_status()
        return r.json()["stdout"]
    except Exception as e:
        raise LLMError(f"LLM call failed: {e}") from e
