import logging
from collections import deque
from datetime import datetime, UTC


class LogBuffer(logging.Handler):
    def __init__(self, maxlen: int = 1000):
        super().__init__()
        self.setFormatter(logging.Formatter("%(levelname)s | %(name)s | %(message)s"))
        self._buf: deque[dict] = deque(maxlen=maxlen)

    def emit(self, record: logging.LogRecord):
        self._buf.append({
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "line": self.format(record),
        })

    def records(self, after: str | None = None) -> list[dict]:
        items = list(self._buf)
        if after:
            items = [r for r in items if r["ts"] > after]
        return items

    def clear(self):
        self._buf.clear()


log_buffer = LogBuffer()
