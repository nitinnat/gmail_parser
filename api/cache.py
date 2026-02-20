import time
from typing import Any

_cache: dict[str, tuple[float, Any]] = {}


def get(key: str, ttl: int = 60) -> Any | None:
    if key in _cache:
        ts, val = _cache[key]
        if time.time() - ts < ttl:
            return val
    return None


def set(key: str, val: Any):
    _cache[key] = (time.time(), val)


def invalidate(*keys: str):
    for k in keys:
        _cache.pop(k, None)
