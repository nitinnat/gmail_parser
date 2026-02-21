import re
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Query

from api import cache
from api.routers.alert_rules import load_rules
from gmail_parser.categorizer import ALL_CATEGORIES, NOISE
from gmail_parser.search import EmailSearch
from gmail_parser.store import EmailStore

router = APIRouter()

_SUBSCRIPTION_RE = re.compile(
    r"noreply|no-reply|newsletter|notifications?|updates?|donotreply|marketing|digest|news@",
    re.IGNORECASE,
)

_REPLY_CATEGORIES = frozenset({"Personal", "Jobs & Recruitment"})
_DO_CATEGORIES = frozenset({"Immigration", "Taxes", "Health & Insurance", "Security & Accounts", "Government & Services"})
_DO_KEYWORDS_RE = re.compile(
    r"\b(expires?d?|due|deadline|confirm|verify|action.required|urgent|remind(er)?|renew|pay(ment)?|invoice|sign|complete|submit|required|overdue|appointment|schedule|register|enroll)\b",
    re.IGNORECASE,
)
_SUBSCRIPTION_LABELS = frozenset({"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"})


@router.get("/overview")
def overview():
    cached = cache.get("overview", ttl=10)
    if cached is not None:
        return cached

    store = EmailStore()
    metadatas = store.get_all_emails(include=["metadatas"])["metadatas"]

    total = unread = starred = 0
    month_counter: Counter = Counter()
    cat_counter: Counter = Counter()
    senders: dict[str, dict] = {}

    for m in metadatas:
        total += 1
        if not m.get("is_read", True):
            unread += 1
        if m.get("is_starred", False):
            starred += 1

        date_iso = m.get("date_iso", "")
        if date_iso:
            try:
                month_counter[datetime.fromisoformat(date_iso).strftime("%Y-%m")] += 1
            except ValueError:
                pass

        cat = m.get("category", "Other")
        if cat != NOISE:
            cat_counter[cat] += 1

        sender = m.get("sender", "")
        if sender:
            if sender not in senders:
                senders[sender] = {"count": 0, "has_unsubscribe": False, "labels": set()}
            s = senders[sender]
            s["count"] += 1
            if m.get("list_unsubscribe", ""):
                s["has_unsubscribe"] = True
            for lbl in m.get("labels", "").strip("|").split("|"):
                if lbl:
                    s["labels"].add(lbl)

    subscription_count = sum(
        1 for sender, s in senders.items()
        if (
            s["has_unsubscribe"]
            or bool(_SUBSCRIPTION_RE.search(sender))
            or bool(s["labels"] & _SUBSCRIPTION_LABELS)
            or s["count"] >= 5
        )
    )

    categories = sorted(
        [{"category": cat, "count": cat_counter[cat]} for cat in ALL_CATEGORIES if cat_counter.get(cat, 0) > 0 and cat != NOISE],
        key=lambda x: x["count"],
        reverse=True,
    )

    result = {
        "total": total,
        "unread": unread,
        "starred": starred,
        "subscription_count": subscription_count,
        "monthly_volume": [{"period": p, "count": c} for p, c in sorted(month_counter.items())],
        "categories": categories,
    }
    cache.set("overview", result)
    return result


@router.get("/senders")
def get_senders(limit: int = Query(200, ge=1, le=1000)):
    cached = cache.get("senders")
    if cached is None:
        cached = EmailSearch().get_sender_analytics(limit=1000)
        cache.set("senders", cached)
    return cached[:limit]


@router.get("/subscriptions")
def get_subscriptions():
    cached = cache.get("senders")
    if cached is None:
        cached = EmailSearch().get_sender_analytics(limit=1000)
        cache.set("senders", cached)
    return [s for s in cached if s["is_subscription"]]


@router.get("/labels")
def get_labels():
    return EmailSearch().count_by_label()


@router.get("/categories")
def get_categories():
    store = EmailStore()
    counter = Counter(m.get("category", "Other") for m in store.get_all_emails(include=["metadatas"])["metadatas"])
    result = [{"category": cat, "count": counter[cat]} for cat in ALL_CATEGORIES if counter.get(cat, 0) > 0 and cat != NOISE]
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


@router.get("/alerts")
def get_alerts(limit: int = Query(500, le=2000)):
    cached = cache.get("alerts")
    if cached is not None:
        return cached[:limit]

    rules = load_rules()
    pinned_senders = {
        (s["sender"] if isinstance(s, dict) else s)
        for s in rules.get("senders", [])
    }

    if not pinned_senders:
        return []

    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])
    results = []
    for id_, meta in zip(all_emails["ids"], all_emails["metadatas"]):
        cat = meta.get("category", "Other")
        sender = meta.get("sender", "")
        if sender not in pinned_senders:
            continue
        results.append({
            "id": id_,
            "subject": meta.get("subject", ""),
            "sender": sender,
            "date": meta.get("date_iso", ""),
            "category": cat,
            "is_read": meta.get("is_read", True),
        })

    results.sort(key=lambda x: x["date"], reverse=True)
    cache.set("alerts", results)
    return results[:limit]


@router.get("/triage")
def get_triage(days: int = Query(7, ge=1, le=30)):
    cache_key = f"triage_{days}"
    cached = cache.get(cache_key, ttl=60)
    if cached is not None:
        return cached

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    store = EmailStore()
    all_emails = store.get_all_emails(include=["metadatas"])

    reply, do, read = [], [], []
    for id_, meta in zip(all_emails["ids"], all_emails["metadatas"]):
        date_iso = meta.get("date_iso", "")
        if not date_iso or date_iso < cutoff:
            continue

        sender = meta.get("sender", "")
        subject = meta.get("subject", "")
        category = meta.get("category", "Other")
        is_read = meta.get("is_read", True)
        is_subscription = bool(_SUBSCRIPTION_RE.search(sender))

        item = {"id": id_, "subject": subject, "sender": sender, "date": date_iso, "category": category, "is_read": is_read}

        if not is_subscription and (category in _REPLY_CATEGORIES or "?" in subject):
            reply.append({**item, "bucket": "reply"})
        elif category in _DO_CATEGORIES or bool(_DO_KEYWORDS_RE.search(subject)):
            do.append({**item, "bucket": "do"})
        elif not is_subscription and not is_read:
            read.append({**item, "bucket": "read"})

    for bucket in (reply, do, read):
        bucket.sort(key=lambda x: x["date"], reverse=True)

    result = {"reply": reply[:20], "do": do[:20], "read": read[:20]}
    cache.set(cache_key, result)
    return result


_DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_EMAIL_DOMAIN_RE = re.compile(r"@([\w.\-]+)")


def _extract_domain(sender: str) -> str | None:
    m = _EMAIL_DOMAIN_RE.search(sender)
    return m.group(1).lower() if m else None


@router.get("/eda")
def get_eda():
    cached = cache.get("eda", ttl=10)
    if cached is not None:
        return cached

    store = EmailStore()
    metadatas = store.get_all_emails(include=["metadatas"])["metadatas"]

    dow_counter: Counter = Counter()
    hour_counter: Counter = Counter()
    heatmap_counter: Counter = Counter()
    cat_stats: dict = defaultdict(lambda: {"count": 0, "unread": 0, "starred": 0, "with_attachments": 0})
    month_cat_counter: dict[str, Counter] = defaultdict(Counter)
    sender_vol: Counter = Counter()
    sender_unread: Counter = Counter()
    domain_counter: Counter = Counter()
    total_read = total_starred = total_attachments = 0

    for m in metadatas:
        date_iso = m.get("date_iso", "")
        if date_iso:
            try:
                dt = datetime.fromisoformat(date_iso)
                dow_counter[dt.weekday()] += 1
                hour_counter[dt.hour] += 1
                heatmap_counter[(dt.weekday(), dt.hour)] += 1
                month_cat_counter[dt.strftime("%Y-%m")][m.get("category", "Other")] += 1
            except ValueError:
                pass

        cat = m.get("category", "Other")
        if cat == NOISE:
            continue
        is_read = m.get("is_read", True)
        is_starred = m.get("is_starred", False)
        has_att = m.get("has_attachments", False)

        cs = cat_stats[cat]
        cs["count"] += 1
        if is_read:
            total_read += 1
        else:
            cs["unread"] += 1
        if is_starred:
            cs["starred"] += 1
            total_starred += 1
        if has_att:
            cs["with_attachments"] += 1
            total_attachments += 1

        sender = m.get("sender", "")
        if sender:
            sender_vol[sender] += 1
            if not is_read:
                sender_unread[sender] += 1
            domain = _extract_domain(sender)
            if domain:
                domain_counter[domain] += 1

    # Category trend: last 12 months, top 6 categories by total
    all_months = sorted(month_cat_counter.keys())[-12:]
    top_cats = [cat for cat, _ in Counter({cat: s["count"] for cat, s in cat_stats.items()}).most_common(6)]
    monthly_by_category = [
        {"period": m, **{cat: month_cat_counter[m].get(cat, 0) for cat in top_cats}}
        for m in all_months
    ]

    total = len(metadatas)
    result = {
        "day_of_week": [{"day": _DOW_LABELS[i], "count": dow_counter.get(i, 0)} for i in range(7)],
        "hour_of_day": [{"hour": i, "count": hour_counter.get(i, 0)} for i in range(24)],
        "heatmap": [[heatmap_counter.get((dow, h), 0) for h in range(24)] for dow in range(7)],
        "category_stats": sorted(
            [
                {
                    "category": cat,
                    "count": s["count"],
                    "unread": s["unread"],
                    "starred": s["starred"],
                    "with_attachments": s["with_attachments"],
                    "unread_pct": round(s["unread"] / s["count"] * 100, 1) if s["count"] else 0,
                }
                for cat, s in cat_stats.items()
            ],
            key=lambda x: x["count"],
            reverse=True,
        ),
        "top_senders": [
            {"sender": s, "count": c, "unread": sender_unread.get(s, 0)}
            for s, c in sender_vol.most_common(15)
        ],
        "domain_distribution": [
            {"domain": d, "count": c} for d, c in domain_counter.most_common(15)
        ],
        "monthly_by_category": monthly_by_category,
        "category_trend_keys": top_cats,
        "totals": {
            "unique_senders": len(sender_vol),
            "read_rate": round(total_read / total * 100, 1) if total else 0,
            "attachment_rate": round(total_attachments / total * 100, 1) if total else 0,
            "starred_rate": round(total_starred / total * 100, 1) if total else 0,
        },
    }
    cache.set("eda", result)
    return result
