import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from api import cache
from gmail_parser.config import settings

router = APIRouter()

_RULES_FILE = Path(settings.chroma_persist_dir) / "alert_rules.json"


def load_rules() -> dict:
    if _RULES_FILE.exists():
        return json.loads(_RULES_FILE.read_text())
    return {"senders": []}


def _save_rules(rules: dict) -> None:
    _RULES_FILE.write_text(json.dumps(rules, indent=2))


class SenderRule(BaseModel):
    sender: str
    note: str = ""


class AlertRules(BaseModel):
    senders: list[SenderRule]


@router.get("/rules")
def get_rules():
    return load_rules()


@router.put("/rules")
def set_rules(rules: AlertRules):
    seen: set[str] = set()
    deduped = []
    for s in rules.senders:
        if s.sender not in seen:
            seen.add(s.sender)
            deduped.append({"sender": s.sender, "note": s.note})
    data = {"senders": deduped}
    _save_rules(data)
    cache.invalidate("alerts")
    return data
