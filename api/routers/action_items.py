import json
from datetime import date
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from gmail_parser.config import settings
from gmail_parser.store import EmailStore

router = APIRouter()

_DISMISSED_FILE = Path(settings.chroma_persist_dir) / "dismissed_actions.json"


def _load_dismissed() -> set[str]:
    if _DISMISSED_FILE.exists():
        return set(json.loads(_DISMISSED_FILE.read_text()))
    return set()


@router.get("")
def get_action_items():
    store = EmailStore()
    try:
        result = store.get_emails(where={"has_action_items": {"$eq": True}})
    except Exception:
        result = {"ids": [], "metadatas": []}

    dismissed = _load_dismissed()
    today = date.today().isoformat()

    actions = []
    for gmail_id, metadata in zip(result["ids"], result["metadatas"]):
        items = json.loads(metadata.get("action_items_json", "[]"))
        for item in items:
            key = f"{gmail_id}:{item['action']}"
            if key in dismissed:
                continue
            deadline = item.get("deadline") or today
            actions.append({
                "gmail_id": gmail_id,
                "action": item["action"],
                "deadline": deadline,
                "urgency": item.get("urgency", "medium"),
                "subject": metadata.get("subject", ""),
                "sender": metadata.get("sender", ""),
                "is_overdue": bool(item.get("deadline") and item["deadline"] < today),
                "dismiss_key": key,
            })

    return {"actions": sorted(actions, key=lambda x: x["deadline"])}


class DismissRequest(BaseModel):
    dismiss_key: str


@router.post("/dismiss")
def dismiss_action(req: DismissRequest):
    dismissed = _load_dismissed()
    dismissed.add(req.dismiss_key)
    _DISMISSED_FILE.parent.mkdir(parents=True, exist_ok=True)
    _DISMISSED_FILE.write_text(json.dumps(list(dismissed), indent=2))
    return {"ok": True}
