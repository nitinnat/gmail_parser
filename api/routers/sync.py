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

_AUTO_SYNC_INTERVAL_SECS = 30
_auto_sync = {"enabled": True, "interval_hours": _AUTO_SYNC_INTERVAL_SECS / 3600, "next_run": time.time() + _AUTO_SYNC_INTERVAL_SECS}

MAX_EVENTS = 200


def _push_event(msg: str):
    with _lock:
        _state["events"].append({"ts": datetime.now(UTC).isoformat(), "msg": msg})
        if len(_state["events"]) > MAX_EVENTS:
            _state["events"] = _state["events"][-MAX_EVENTS:]


def _auto_sync_loop():
    while True:
        time.sleep(10)
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
        suffix = " [fallback: 7-day sync]" if result.get("fallback") else ""
        _push_event(
            f"Done — +{result['added']:,} new, -{result['deleted']:,} deleted, "
            f"{result['refreshed']:,} metadata refreshed{suffix}"
        )
    except Exception as e:
        with _lock:
            _state["error"] = str(e)
        _push_event(f"ERROR: {e}")
        if "invalid_grant" in str(e):
            with _lock:
                _auto_sync["enabled"] = False
                _auto_sync["next_run"] = None
            logger.warning("[auto_sync] paused due to invalid_grant — will resume after next login")
            _push_event("Auto sync paused — token expired. Log out and log back in to resume.")
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
        is_syncing = _state["is_syncing"]
    if after:
        events = [e for e in events if e["ts"] > after]
    return {"events": events, "is_syncing": is_syncing}


@router.get("/live-count")
def live_count():
    """Real-time ChromaDB email count — works even during background script ingestion."""
    return {"count": EmailStore().count()}


_llm_state = {"is_running": False, "processed": 0, "total": 0, "error": None}
_llm_lock = threading.Lock()


_llm_logger = logging.getLogger("gmail_parser.llm_process")


def _run_llm_process(force: bool = False):
    from gmail_parser.llm_extractor import extract_batch, _BATCH_SIZE
    import json

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas", "documents"])
    ids = all_emails["ids"]
    metadatas = all_emails["metadatas"]
    documents = all_emails.get("documents") or [""] * len(ids)

    unprocessed = [
        (gid, m, doc)
        for gid, m, doc in zip(ids, metadatas, documents)
        if force or not m.get("actions_extracted")
    ]
    total = len(unprocessed)

    with _llm_lock:
        _llm_state.update({"is_running": True, "processed": 0, "total": total, "error": None})

    _llm_logger.info(
        "LLM processing started — %d emails to process (%d per call)%s",
        total, _BATCH_SIZE, " [forced reprocess]" if force else "",
    )

    if not unprocessed:
        _llm_logger.info("Nothing to process — all emails already have LLM extraction")
        with _llm_lock:
            _llm_state["is_running"] = False
        return

    email_inputs = [
        {
            "id": gid,
            "subject": m.get("subject", ""),
            "sender": m.get("sender", ""),
            "snippet": doc or m.get("snippet", ""),
            "metadata": m,
        }
        for gid, m, doc in unprocessed
    ]

    def _on_progress(done, _total):
        with _llm_lock:
            _llm_state["processed"] = done
        _llm_logger.info("LLM processing — %d / %d emails done", done, _total)

    try:
        results = extract_batch(email_inputs, progress_callback=_on_progress)

        update_ids, updates = [], []
        action_count = 0
        tx_count = 0
        for gid, _, _ in unprocessed:
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
            if action_items:
                action_count += 1
            if spending.get("transactions"):
                tx_count += 1
            update_ids.append(gid)
            updates.append(update)

        store.update_metadatas_batch(update_ids, updates)
        with _llm_lock:
            _llm_state["processed"] = total

        cache.invalidate("alerts", "overview", "categories", "expenses_overview", "expenses_tx")
        _llm_logger.info(
            "LLM processing done — %d emails, %d with action items, %d with transactions",
            total, action_count, tx_count,
        )
    except Exception as e:
        with _llm_lock:
            _llm_state["error"] = str(e)
        _push_event(f"ERROR: {e}")
        logger.error("[llm_process] failed: %s", e)
    finally:
        with _llm_lock:
            _llm_state["is_running"] = False


class LlmProcessRequest(BaseModel):
    force: bool = False


@router.post("/llm-process")
def start_llm_process(req: LlmProcessRequest = LlmProcessRequest()):
    with _llm_lock:
        if _llm_state["is_running"]:
            return {"message": "LLM processing already in progress", **_llm_state}
    threading.Thread(target=_run_llm_process, args=(req.force,), daemon=True).start()
    return {"message": "LLM processing started"}


@router.get("/llm-process")
def llm_process_status():
    with _llm_lock:
        return dict(_llm_state)


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
