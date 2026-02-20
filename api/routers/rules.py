import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from api import cache
from gmail_parser.client import GmailClient
from gmail_parser.config import settings as parser_settings
from gmail_parser.store import EmailStore

router = APIRouter()

_RULES_FILE = Path(parser_settings.chroma_persist_dir) / "inbox_rules.json"


class RuleActions(BaseModel):
    mark_read: bool = False
    trash: bool = False
    label: str | None = None


class InboxRule(BaseModel):
    name: str
    senders: list[str] = []
    keywords: list[str] = []
    labels: list[str] = []
    actions: RuleActions = RuleActions()


class RuleSet(BaseModel):
    rules: list[InboxRule] = []


class RunRulesRequest(BaseModel):
    dry_run: bool = True


def _load_rules() -> dict:
    if _RULES_FILE.exists():
        return json.loads(_RULES_FILE.read_text())
    return {"rules": []}


def _save_rules(data: dict) -> None:
    _RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _RULES_FILE.write_text(json.dumps(data, indent=2))


def _labels_contain(label_str: str, label: str) -> bool:
    if not label_str:
        return False
    return f"|{label}|" in label_str


def _rule_matches(rule: dict, meta: dict) -> bool:
    sender = meta.get("sender", "").lower()
    subject = meta.get("subject", "").lower()
    snippet = meta.get("snippet", "").lower()
    labels = meta.get("labels", "")
    text = f"{subject} {snippet}"

    if rule.get("senders"):
        if any(s.lower() in sender for s in rule.get("senders", [])):
            return True
    if rule.get("keywords"):
        if any(k.lower() in text for k in rule.get("keywords", [])):
            return True
    if rule.get("labels"):
        if any(_labels_contain(labels, l) for l in rule.get("labels", [])):
            return True
    return False


@router.get("")
def get_rules():
    return _load_rules()


@router.post("")
def set_rules(rules: RuleSet):
    data = {"rules": [r.model_dump() for r in rules.rules]}
    _save_rules(data)
    return data


@router.post("/run")
def run_rules(req: RunRulesRequest):
    rules = _load_rules().get("rules", [])
    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])

    matches: dict[str, list[str]] = {r["name"]: [] for r in rules}
    for id_, meta in zip(all_emails["ids"], all_emails["metadatas"]):
        for rule in rules:
            if _rule_matches(rule, meta):
                matches[rule["name"]].append(id_)

    if req.dry_run:
        return {"dry_run": True, "matches": {k: len(v) for k, v in matches.items()}}

    client = GmailClient()
    for rule in rules:
        ids = matches.get(rule["name"], [])
        if not ids:
            continue
        actions = rule.get("actions", {})
        if actions.get("trash"):
            for mid in ids:
                client.trash_message(mid)
            store.delete_emails(ids)
        if actions.get("mark_read"):
            for mid in ids:
                client.modify_message(mid, remove_labels=["UNREAD"])
        if actions.get("label"):
            label_name = actions.get("label")
            labels = client.list_labels()
            label_id = next((l["id"] for l in labels if l["name"] == label_name), None)
            if not label_id:
                label_id = client.create_label(label_name)["id"]
            for mid in ids:
                client.modify_message(mid, add_labels=[label_id])

    cache.invalidate("overview", "senders", "categories", "alerts", "eda")
    return {"dry_run": False, "matches": {k: len(v) for k, v in matches.items()}}
