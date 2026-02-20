import logging
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import cache
from gmail_parser.categorizer import ALL_CATEGORIES, get_overrides, set_sender_category
from gmail_parser.store import EmailStore

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
def list_categories():
    cached = cache.get("categories")
    if cached is not None:
        return cached

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])

    # {category: {sender: {count, last_date}}}
    cat_senders: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"count": 0, "last_date": ""}))

    for meta in all_emails["metadatas"]:
        cat = meta.get("category", "Other")
        sender = meta.get("sender", "")
        if not sender:
            continue
        entry = cat_senders[cat][sender]
        entry["count"] += 1
        date = meta.get("date_iso", "")
        if date > entry["last_date"]:
            entry["last_date"] = date

    overrides = get_overrides()
    result = []
    for cat in ALL_CATEGORIES:
        if cat not in cat_senders:
            continue
        senders = sorted(
            [{"sender": s, **data} for s, data in cat_senders[cat].items()],
            key=lambda x: x["count"],
            reverse=True,
        )
        result.append({
            "category": cat,
            "count": sum(s["count"] for s in senders),
            "senders": senders[:100],
            "overrides": {s: overrides[s] for s in overrides if s in cat_senders[cat]},
        })

    cache.set("categories", result)
    return result


class AssignRequest(BaseModel):
    sender: str
    category: str


@router.post("/assign")
def assign_category(req: AssignRequest):
    if req.category not in ALL_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category: {req.category}")

    set_sender_category(req.sender, req.category)

    store = EmailStore()
    result = store.get_emails(where={"sender": req.sender})
    ids = result["ids"]
    if ids:
        store.update_metadatas_batch(ids, [{"category": req.category}] * len(ids))

    cache.invalidate("overview", "categories", "senders", "alerts", "eda")
    logger.info("[assign_category] %s → %s (%d emails)", req.sender, req.category, len(ids))
    return {"updated": len(ids), "sender": req.sender, "category": req.category}
