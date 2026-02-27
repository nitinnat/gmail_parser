import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api import cache
from gmail_parser.embeddings import EmbeddingModel
from gmail_parser.categorizer import categorize
from gmail_parser.expenses import extract_expense
from gmail_parser.config import settings as parser_settings
from gmail_parser.store import EmailStore

router = APIRouter()


def _get_llm_transactions(store: EmailStore) -> list[dict]:
    result = store.get_emails(where={"has_transactions": {"$eq": True}})
    transactions = []
    for gid, meta in zip(result["ids"], result["metadatas"]):
        spending_raw = meta.get("spending_json") or ""
        if not spending_raw:
            continue
        try:
            spending = json.loads(spending_raw)
        except (json.JSONDecodeError, ValueError):
            continue
        for tx in spending.get("transactions") or []:
            if not isinstance(tx, dict):
                continue
            transactions.append({
                "gmail_id": gid,
                "subject": meta.get("subject", ""),
                "sender": meta.get("sender", ""),
                "email_date": meta.get("date_iso", ""),
                **tx,
                "date": tx.get("date") or meta.get("date_iso", ""),
            })
    return transactions

_RULES_FILE = Path(parser_settings.chroma_persist_dir) / "expense_rules.json"


class ExpenseRule(BaseModel):
    name: str
    senders: list[str] = []
    keywords: list[str] = []
    labels: list[str] = []
    match_categories: list[str] = []
    category: str = "Uncategorized"
    system: bool = False


class ExpenseRules(BaseModel):
    rules: list[ExpenseRule] = []
    include_ids: list[str] = []


class ExpenseOverride(BaseModel):
    gmail_id: str | None = None
    amount: float
    currency: str = "USD"
    merchant: str = ""
    category: str = "Uncategorized"
    date_iso: str | None = None
    notes: str = ""


def _load_rules() -> dict:
    if _RULES_FILE.exists():
        return json.loads(_RULES_FILE.read_text())
    return {
        "rules": [
            {"name": "Chase Transactions", "senders": [], "keywords": ["you made a $"], "labels": [], "match_categories": [], "category": "Uncategorized", "system": True},
            {"name": "Privacy.com", "senders": [], "keywords": ["was authorized at"], "labels": [], "match_categories": [], "category": "Uncategorized", "system": True},
            {"name": "Amex Large Purchases", "senders": [], "keywords": ["large purchase approved"], "labels": [], "match_categories": [], "category": "Uncategorized", "system": True},
            {"name": "WF Credit Card", "senders": [], "keywords": ["credit card purchase of"], "labels": [], "match_categories": [], "category": "Uncategorized", "system": True},
            {"name": "Custom Senders", "senders": [], "keywords": [], "labels": [], "match_categories": [], "category": "Uncategorized", "system": False},
        ],
        "include_ids": [],
    }


def _save_rules(rules: dict) -> None:
    _RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _RULES_FILE.write_text(json.dumps(rules, indent=2))


def _labels_contain(label_str: str, label: str) -> bool:
    if not label_str:
        return False
    return f"|{label}|" in label_str


def _rule_matches(
    rule: dict,
    subject: str,
    snippet: str,
    body: str,
    sender: str,
    labels: str,
    email_category: str,
) -> bool:
    sender_l = sender.lower()
    text = f"{subject} {snippet} {body}".lower()

    if rule.get("senders"):
        if any(s.lower() in sender_l for s in rule.get("senders", [])):
            return True
    if rule.get("keywords"):
        if any(k.lower() in text for k in rule.get("keywords", [])):
            return True
    if rule.get("labels"):
        if any(_labels_contain(labels, l) for l in rule.get("labels", [])):
            return True
    if rule.get("match_categories"):
        if any(
            c.lower() == (email_category or "").lower()
            for c in rule.get("match_categories", [])
        ):
            return True
    return False


def _extract_from_email(meta: dict, body: str, rule: dict | None = None) -> dict | None:
    subject = meta.get("subject", "")
    snippet = meta.get("snippet", "")
    sender = meta.get("sender", "")
    labels = meta.get("labels", "")

    text = f"{subject}\n{snippet}\n{body}"
    extracted = extract_expense(text)
    if extracted.amount is None:
        return None

    category = rule.get("category") if rule else "Uncategorized"
    return {
        "amount": extracted.amount,
        "currency": extracted.currency or "USD",
        "merchant": extracted.merchant or "",
        "category": category,
        "source_sender": sender,
        "labels": labels,
        "date_iso": meta.get("date_iso", ""),
        "date_timestamp": meta.get("date_timestamp", 0),
        "confidence": extracted.confidence,
        "rule_name": rule.get("name") if rule else "",
        "source": "rule",
        "source_gmail_id": meta.get("gmail_id", ""),
        "thread_id": meta.get("thread_id", ""),
        "subject": subject,
    }


@router.get("/rules")
def get_rules():
    return _load_rules()


@router.post("/rules")
def set_rules(rules: ExpenseRules):
    data = {
        "rules": [r.model_dump() for r in rules.rules],
        "include_ids": rules.include_ids,
    }
    _save_rules(data)
    cache.invalidate("expenses_overview", "expenses_tx")
    return data


@router.post("/override")
def override_expense(req: ExpenseOverride):
    store = EmailStore()
    embedding = EmbeddingModel()

    expense_id = req.gmail_id or f"manual_{uuid4().hex}"
    date_iso = req.date_iso or datetime.utcnow().isoformat()
    try:
        date_ts = int(datetime.fromisoformat(date_iso).timestamp())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date_iso: {e}") from e

    meta = {
        "amount": req.amount,
        "currency": req.currency,
        "merchant": req.merchant,
        "category": req.category,
        "source_sender": "",
        "labels": "",
        "date_iso": date_iso,
        "date_timestamp": date_ts,
        "confidence": 1.0,
        "rule_name": "manual",
        "source": "manual",
        "source_gmail_id": req.gmail_id or "",
        "thread_id": "",
        "subject": "",
        "notes": req.notes,
    }

    doc = f"{req.merchant} {req.category} {req.amount} {req.currency}".strip()
    vec = embedding.encode(doc)
    store.upsert_expenses_batch([expense_id], [doc], [vec], [meta])
    cache.invalidate("expenses_overview", "expenses_tx")
    return {"id": expense_id, **meta}


@router.post("/reprocess")
def reprocess_expenses():
    rules = _load_rules()
    rule_list = rules.get("rules", [])
    include_ids = set(rules.get("include_ids", []))

    store = EmailStore()
    embedding = EmbeddingModel()

    existing = store.get_all_expenses(include=["metadatas"])
    delete_ids = [
        eid
        for eid, meta in zip(existing["ids"], existing["metadatas"])
        if meta.get("source") == "rule"
    ]
    if delete_ids:
        store.delete_expenses(delete_ids)

    all_emails = store.get_all_emails(include=["documents", "metadatas"])
    ids = all_emails["ids"]
    docs = all_emails["documents"]
    metas = all_emails["metadatas"]

    expense_ids = []
    expense_docs = []
    expense_metas = []
    matched_total = 0
    missing_amount = 0
    matched_samples = []  # (subject, sender) for emails that matched but had no amount

    for gmail_id, doc, meta in zip(ids, docs, metas):
        doc = doc or ""
        meta = dict(meta)
        meta["gmail_id"] = gmail_id
        if gmail_id in include_ids:
            extracted = _extract_from_email(
                meta, doc, {"name": "manual", "category": "Uncategorized"}
            )
            if extracted:
                expense_ids.append(gmail_id)
                expense_docs.append(doc[:500])
                expense_metas.append(extracted)
            continue

        matched = None
        for rule in rule_list:
            if _rule_matches(
                rule,
                meta.get("subject", ""),
                meta.get("snippet", ""),
                doc,
                meta.get("sender", ""),
                meta.get("labels", ""),
                meta.get("category") or categorize(meta),
            ):
                matched = rule
                break
        if not matched:
            continue

        matched_total += 1

        extracted = _extract_from_email(meta, doc, matched)
        if not extracted:
            missing_amount += 1
            if len(matched_samples) < 25:
                matched_samples.append({
                    "subject": meta.get("subject", ""),
                    "sender": meta.get("sender", ""),
                    "date": meta.get("date_iso", ""),
                })
            continue
        expense_ids.append(gmail_id)
        expense_docs.append(doc[:500])
        expense_metas.append(extracted)

    if expense_ids:
        vectors = embedding.encode_batch(expense_docs)
        store.upsert_expenses_batch(expense_ids, expense_docs, vectors, expense_metas)

    cache.invalidate("expenses_overview", "expenses_tx")
    return {
        "processed": len(ids),
        "matched": matched_total,
        "extracted": len(expense_ids),
        "missing_amount": missing_amount,
        "matched_samples": matched_samples,
    }


@router.get("/transactions")
def list_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(500, le=2000),
    merchant_category: str | None = None,
    transaction_type: str | None = None,
    currency: str | None = None,
    is_recurring: bool | None = None,
    is_international: bool | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    store = EmailStore()
    txns = _get_llm_transactions(store)

    if merchant_category:
        txns = [t for t in txns if (t.get("merchant_category") or "").lower() == merchant_category.lower()]
    if transaction_type:
        txns = [t for t in txns if (t.get("transaction_type") or "") == transaction_type]
    if currency:
        txns = [t for t in txns if (t.get("currency") or "USD") == currency]
    if is_recurring is not None:
        txns = [t for t in txns if bool(t.get("is_recurring")) == is_recurring]
    if is_international is not None:
        txns = [t for t in txns if bool(t.get("is_international")) == is_international]
    if date_from:
        txns = [t for t in txns if (t.get("date") or "") >= date_from]
    if date_to:
        txns = [t for t in txns if (t.get("date") or "") <= date_to]

    txns.sort(key=lambda t: t.get("date") or t.get("email_date") or "", reverse=True)
    total = len(txns)
    offset = (page - 1) * limit
    return {"items": txns[offset : offset + limit], "total": total, "page": page, "limit": limit}


@router.get("/overview")
def overview():
    cached = cache.get("expenses_overview", ttl=15)
    if cached is not None:
        return cached

    store = EmailStore()
    txns = _get_llm_transactions(store)

    totals: dict[str, float] = defaultdict(float)
    refunds: dict[str, float] = defaultdict(float)
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_merchant_category: dict[str, float] = defaultdict(float)
    by_transaction_type: dict[str, float] = defaultdict(float)
    by_payment_method: dict[str, int] = defaultdict(int)
    merchant_totals: dict[str, float] = defaultdict(float)
    recurring_monthly: dict[str, float] = defaultdict(float)

    for tx in txns:
        amount = float(tx.get("amount") or 0)
        currency = tx.get("currency") or "USD"
        tx_type = tx.get("transaction_type") or "other"
        merchant_cat = tx.get("merchant_category") or "Other"
        payment = tx.get("payment_method") or "other"
        merchant = tx.get("merchant_normalized") or tx.get("merchant") or "Unknown"
        date = tx.get("date") or ""

        if tx_type == "refund":
            refunds[currency] += amount
            continue

        totals[currency] += amount
        by_merchant_category[merchant_cat] += amount
        by_transaction_type[tx_type] += amount
        by_payment_method[payment] += 1
        merchant_totals[merchant] += amount

        if date:
            try:
                monthly[date[:7]][currency] += amount
            except Exception:
                pass

        if tx.get("is_recurring"):
            period = tx.get("recurrence_period") or "monthly"
            divisor = {"annual": 12, "quarterly": 3, "weekly": 1 / 4.33}.get(period, 1)
            recurring_monthly[currency] += amount / divisor if divisor > 1 else amount * abs(divisor)

    result = {
        "count": len(txns),
        "totals": {"by_currency": dict(totals)},
        "refunds": {"by_currency": dict(refunds)},
        "recurring_monthly": {"by_currency": dict(recurring_monthly)},
        "monthly": [{"period": p, **dict(v)} for p, v in sorted(monthly.items())],
        "by_merchant_category": sorted(
            [{"category": k, "amount": round(v, 2)} for k, v in by_merchant_category.items()],
            key=lambda x: x["amount"], reverse=True,
        ),
        "by_transaction_type": sorted(
            [{"type": k, "amount": round(v, 2)} for k, v in by_transaction_type.items()],
            key=lambda x: x["amount"], reverse=True,
        ),
        "by_payment_method": sorted(
            [{"method": k, "count": v} for k, v in by_payment_method.items()],
            key=lambda x: x["count"], reverse=True,
        ),
        "top_merchants": sorted(
            [{"merchant": k, "amount": round(v, 2)} for k, v in merchant_totals.items()],
            key=lambda x: x["amount"], reverse=True,
        )[:20],
    }

    cache.set("expenses_overview", result)
    return result
