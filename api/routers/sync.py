import logging
import threading
import time
from collections import Counter
from datetime import datetime, UTC
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from api import cache
from api.log_buffer import log_buffer
from gmail_parser import IngestionPipeline
from gmail_parser.categorizer import categorize as do_categorize
from gmail_parser.store import EmailStore

SCRIPT_LOG = Path("/tmp/gmail_ingest.log")

router = APIRouter()

_state = {
    "is_syncing": False,
    "synced": 0,
    "total": 0,
    "events": [],  # rolling list of {"ts", "msg"} dicts
    "error": None,
}
_lock = threading.Lock()

_auto_sync = {"enabled": False, "interval_hours": 2, "next_run": None}

MAX_EVENTS = 200


def _push_event(msg: str):
    with _lock:
        _state["events"].append({"ts": datetime.now(UTC).isoformat(), "msg": msg})
        if len(_state["events"]) > MAX_EVENTS:
            _state["events"] = _state["events"][-MAX_EVENTS:]


def _auto_sync_loop():
    while True:
        time.sleep(60)
        with _lock:
            if not _auto_sync["enabled"] or _state["is_syncing"]:
                continue
            if (
                _auto_sync["next_run"] is None
                or datetime.now(UTC).timestamp() < _auto_sync["next_run"]
            ):
                continue
            _auto_sync["next_run"] = (
                datetime.now(UTC).timestamp() + _auto_sync["interval_hours"] * 3600
            )
        logger.info("[auto_sync] triggering scheduled incremental sync")
        threading.Thread(target=_run_incremental, daemon=True).start()


threading.Thread(target=_auto_sync_loop, daemon=True, name="auto-sync").start()


class SyncRequest(BaseModel):
    max_emails: int = 100000
    days_ago: int | None = 90
    query: str = ""


def _run_sync(req: SyncRequest):
    with _lock:
        _state.update(
            {"is_syncing": True, "synced": 0, "total": 0, "error": None, "events": []}
        )
    cache.invalidate(
        "overview",
        "senders",
        "categories",
        "alerts",
        "eda",
        "expenses_overview",
        "expenses_tx",
    )
    _push_event("Sync started")

    def on_progress(synced: int, total: int):
        with _lock:
            _state["synced"] = synced
            _state["total"] = total
        _push_event(
            f"Batch complete — {synced:,} / {total:,} emails ({int(synced / total * 100) if total else 0}%)"
        )

    try:
        pipeline = IngestionPipeline()
        _push_event("Syncing labels…")
        pipeline.sync_labels()

        kwargs: dict = {
            "max_emails": req.max_emails,
            "query": req.query,
            "progress_callback": on_progress,
        }
        if req.days_ago is not None:
            kwargs["days_ago"] = req.days_ago
            _push_event(
                f"Fetching message list (last {req.days_ago} days, max {req.max_emails:,})…"
            )
        else:
            _push_event(f"Fetching message list (all mail, max {req.max_emails:,})…")

        count = pipeline.full_sync(**kwargs)
        _push_event(f"Done — {count:,} emails synced successfully")
    except Exception as e:
        with _lock:
            _state["error"] = str(e)
        _push_event(f"ERROR: {e}")
    finally:
        cache.invalidate(
            "overview",
            "senders",
            "categories",
            "alerts",
            "eda",
            "expenses_overview",
            "expenses_tx",
        )
        with _lock:
            _state["is_syncing"] = False


@router.get("/status")
def sync_status():
    store = EmailStore()
    state = store.get_sync_state()
    return {
        "last_sync": state.get("last_full_sync") if state else None,
        "total_emails": store.count(),
        "is_syncing": _state["is_syncing"],
        "has_history_id": bool(state.get("last_history_id")) if state else False,
    }


@router.post("/start")
def start_sync(req: SyncRequest):
    with _lock:
        if _state["is_syncing"]:
            return {"message": "Sync already in progress"}
    thread = threading.Thread(target=_run_sync, args=(req,), daemon=True)
    thread.start()
    return {"message": "Sync started"}


def _run_incremental():
    with _lock:
        _state.update(
            {"is_syncing": True, "synced": 0, "total": 0, "error": None, "events": []}
        )
    cache.invalidate(
        "overview",
        "senders",
        "categories",
        "alerts",
        "eda",
        "expenses_overview",
        "expenses_tx",
    )
    _push_event("Incremental sync started")
    try:
        pipeline = IngestionPipeline()
        result = pipeline.incremental_sync()
        _push_event(
            f"Done — +{result['added']:,} new, -{result['deleted']:,} deleted, "
            f"{result['refreshed']:,} metadata refreshed"
        )
    except Exception as e:
        with _lock:
            _state["error"] = str(e)
        _push_event(f"ERROR: {e}")
    finally:
        cache.invalidate(
            "overview",
            "senders",
            "categories",
            "alerts",
            "eda",
            "expenses_overview",
            "expenses_tx",
        )
        with _lock:
            _state["is_syncing"] = False


@router.post("/incremental")
def start_incremental():
    with _lock:
        if _state["is_syncing"]:
            return {"message": "Sync already in progress"}
    thread = threading.Thread(target=_run_incremental, daemon=True)
    thread.start()
    return {"message": "Incremental sync started"}


@router.get("/progress")
def sync_progress():
    with _lock:
        s = dict(_state)
    return {
        "is_syncing": s["is_syncing"],
        "synced": s["synced"],
        "total": s["total"],
        "pct": round(s["synced"] / s["total"] * 100, 1) if s["total"] > 0 else 0,
        "error": s["error"],
    }


@router.get("/events")
def sync_events(after: str | None = None):
    """Return event log entries, optionally only those after a given ISO timestamp."""
    with _lock:
        events = list(_state["events"])
    if after:
        events = [e for e in events if e["ts"] > after]
    return {"events": events, "is_syncing": _state["is_syncing"]}


@router.get("/live-count")
def live_count():
    """Real-time ChromaDB email count — works even during background script ingestion."""
    return {"count": EmailStore().count()}


@router.post("/categorize")
def categorize_emails():
    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])
    ids = all_emails["ids"]
    metadatas = all_emails["metadatas"]
    updated = [{"category": do_categorize(m)} for m in metadatas]
    store.update_metadatas_batch(ids, updated)
    counts = Counter(m["category"] for m in updated)
    cache.invalidate(
        "overview",
        "categories",
        "senders",
        "alerts",
        "eda",
        "expenses_overview",
        "expenses_tx",
    )
    logger.info("[categorize_emails] categorized %d emails", len(ids))
    return {"updated": len(ids), "categories": dict(counts)}


@router.get("/logs")
def get_logs(after: str | None = None):
    """
    Combined log stream: in-process captured logs (API-triggered syncs) +
    the background ingest script log file if present.
    """
    # In-process logs (API-triggered syncs)
    api_logs = log_buffer.records(after)

    # Background script log file
    script_lines: list[dict] = []
    if SCRIPT_LOG.exists():
        lines = SCRIPT_LOG.read_text(errors="replace").splitlines()
        for line in lines[-500:]:
            stripped = line.strip()
            if not stripped:
                continue
            level = "INFO"
            if stripped.startswith("WARNING"):
                level = "WARNING"
            elif stripped.startswith("ERROR"):
                level = "ERROR"
            script_lines.append(
                {"ts": None, "level": level, "line": stripped, "source": "script"}
            )

    for r in api_logs:
        r.setdefault("source", "api")

    return {
        "api_logs": api_logs,
        "script_lines": script_lines,
        "script_log_exists": SCRIPT_LOG.exists(),
    }


def _auto_sync_response():
    with _lock:
        state = dict(_auto_sync)
    return {
        "enabled": state["enabled"],
        "interval_hours": state["interval_hours"],
        "next_run": datetime.fromtimestamp(state["next_run"], UTC).isoformat()
        if state["next_run"]
        else None,
    }


@router.get("/auto")
def get_auto_sync():
    return _auto_sync_response()


class AutoSyncRequest(BaseModel):
    enabled: bool


@router.post("/auto")
def set_auto_sync(req: AutoSyncRequest):
    with _lock:
        _auto_sync["enabled"] = req.enabled
        if req.enabled:
            _auto_sync["next_run"] = (
                datetime.now(UTC).timestamp() + _auto_sync["interval_hours"] * 3600
            )
        else:
            _auto_sync["next_run"] = None
    logger.info("[auto_sync] %s", "enabled" if req.enabled else "disabled")
    return _auto_sync_response()
