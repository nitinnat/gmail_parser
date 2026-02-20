import logging
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import cache
from gmail_parser.categorizer import (
    ALL_CATEGORIES,
    NOISE,
    add_custom_category,
    delete_custom_category,
    get_all_category_names,
    get_custom_categories,
    get_overrides,
    get_subject_overrides,
    remove_sender_override,
    remove_subject_override,
    rename_custom_category,
    set_sender_category,
    set_subject_category,
)
from gmail_parser.store import EmailStore

router = APIRouter()
logger = logging.getLogger(__name__)

_CACHE_KEYS = ("overview", "categories", "senders", "alerts", "eda")


@router.get("")
def list_categories():
    cached = cache.get("categories")
    if cached is not None:
        return cached

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])

    cat_senders: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"count": 0, "last_date": ""})
    )
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
    subject_overrides = get_subject_overrides()
    custom_defs = {c["name"]: c["color"] for c in get_custom_categories()}
    all_names = get_all_category_names()

    result = []
    for cat in all_names:
        has_senders = cat in cat_senders
        has_subject_overrides = cat == NOISE and any(v == NOISE for v in subject_overrides.values())
        if not has_senders and not has_subject_overrides:
            continue

        senders = sorted(
            [{"sender": s, **data} for s, data in cat_senders.get(cat, {}).items()],
            key=lambda x: x["count"],
            reverse=True,
        )
        entry = {
            "category": cat,
            "count": sum(s["count"] for s in senders),
            "senders": senders[:100],
            "overrides": {s: overrides[s] for s in overrides if s in cat_senders.get(cat, {})},
            "is_system": cat in ALL_CATEGORIES,
            "is_noise": cat == NOISE,
        }
        if cat == NOISE:
            entry["subject_overrides"] = [s for s, c in subject_overrides.items() if c == NOISE]
        if cat in custom_defs:
            entry["color"] = custom_defs[cat]
        result.append(entry)

    cache.set("categories", result)
    return result


@router.get("/custom")
def get_custom():
    return get_custom_categories()


class AssignRequest(BaseModel):
    sender: str | None = None
    subject: str | None = None
    category: str


@router.post("/assign")
def assign_category(req: AssignRequest):
    if not req.sender and not req.subject:
        raise HTTPException(status_code=400, detail="Either sender or subject is required")
    if req.category not in get_all_category_names():
        raise HTTPException(status_code=400, detail=f"Unknown category: {req.category}")

    store = EmailStore()
    if req.sender:
        set_sender_category(req.sender, req.category)
        result = store.get_emails(where={"sender": req.sender})
        ids = result["ids"]
        if ids:
            store.update_metadatas_batch(ids, [{"category": req.category}] * len(ids))
        logger.info("[assign_category] sender %s → %s (%d emails)", req.sender, req.category, len(ids))
        response = {"updated": len(ids), "sender": req.sender, "category": req.category}
    else:
        set_subject_category(req.subject, req.category)
        result = store.get_emails(where={"subject": req.subject})
        ids = result["ids"]
        if ids:
            store.update_metadatas_batch(ids, [{"category": req.category}] * len(ids))
        logger.info("[assign_category] subject '%s' → %s (%d emails)", req.subject, req.category, len(ids))
        response = {"updated": len(ids), "subject": req.subject, "category": req.category}

    cache.invalidate(*_CACHE_KEYS)
    return response


class RemoveOverrideRequest(BaseModel):
    sender: str | None = None
    subject: str | None = None


@router.post("/remove-override")
def remove_override(req: RemoveOverrideRequest):
    if not req.sender and not req.subject:
        raise HTTPException(status_code=400, detail="Either sender or subject is required")

    store = EmailStore()
    if req.sender:
        remove_sender_override(req.sender)
        result = store.get_emails(where={"sender": req.sender})
        ids = result["ids"]
        if ids:
            store.update_metadatas_batch(ids, [{"category": "Other"}] * len(ids))
        logger.info("[remove_override] sender %s removed (%d emails → Other)", req.sender, len(ids))
        response = {"removed": req.sender, "reassigned": len(ids)}
    else:
        remove_subject_override(req.subject)
        result = store.get_emails(where={"subject": req.subject})
        ids = result["ids"]
        if ids:
            store.update_metadatas_batch(ids, [{"category": "Other"}] * len(ids))
        logger.info("[remove_override] subject '%s' removed (%d emails → Other)", req.subject, len(ids))
        response = {"removed": req.subject, "reassigned": len(ids)}

    cache.invalidate(*_CACHE_KEYS)
    return response


class CreateRequest(BaseModel):
    name: str
    color: str


@router.post("/create")
def create_category(req: CreateRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if name in get_all_category_names():
        raise HTTPException(status_code=400, detail=f"Category '{name}' already exists")
    cats = add_custom_category(name, req.color)
    cache.invalidate("categories")
    return cats


class RenameRequest(BaseModel):
    old_name: str
    new_name: str


@router.put("/rename")
def rename_category(req: RenameRequest):
    if req.old_name in ALL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Cannot rename system categories")
    custom_names = [c["name"] for c in get_custom_categories()]
    if req.old_name not in custom_names:
        raise HTTPException(status_code=404, detail=f"Category '{req.old_name}' not found")
    new_name = req.new_name.strip()
    if new_name in get_all_category_names():
        raise HTTPException(status_code=400, detail=f"Category '{new_name}' already exists")

    rename_custom_category(req.old_name, new_name)

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])
    ids_to_update = [
        eid for eid, meta in zip(all_emails["ids"], all_emails["metadatas"])
        if meta.get("category") == req.old_name
    ]
    if ids_to_update:
        store.update_metadatas_batch(ids_to_update, [{"category": new_name}] * len(ids_to_update))

    cache.invalidate(*_CACHE_KEYS)
    logger.info("[rename_category] %s → %s (%d emails)", req.old_name, new_name, len(ids_to_update))
    return {"renamed": len(ids_to_update), "old_name": req.old_name, "new_name": new_name}


@router.delete("/{name}")
def delete_category(name: str):
    if name in ALL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Cannot delete system categories")
    custom_names = [c["name"] for c in get_custom_categories()]
    if name not in custom_names:
        raise HTTPException(status_code=404, detail=f"Category '{name}' not found")

    delete_custom_category(name)

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])
    ids_to_update = [
        eid for eid, meta in zip(all_emails["ids"], all_emails["metadatas"])
        if meta.get("category") == name
    ]
    if ids_to_update:
        store.update_metadatas_batch(ids_to_update, [{"category": "Other"}] * len(ids_to_update))

    cache.invalidate(*_CACHE_KEYS)
    logger.info("[delete_category] %s deleted, %d emails → Other", name, len(ids_to_update))
    return {"deleted": name, "reassigned": len(ids_to_update)}
