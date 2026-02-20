import re
from dataclasses import dataclass


# Priority 1: explicit $ prefix — most reliable for USD transaction alerts
_DOLLAR_RE = re.compile(r'\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)')

# Priority 2: INR / Rs / ₹ prefix
_INR_RE = re.compile(
    r'(?:INR|Rs\.?|₹)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?)',
    re.IGNORECASE,
)

# Strip "more than $X" / "over $X" threshold phrases before extraction (e.g. Amex notification thresholds)
_THRESHOLD_CONTEXT_RE = re.compile(
    r'\b(?:more than|over|greater than|above)\s+\$\s*[0-9]+(?:\.[0-9]{2})?',
    re.IGNORECASE,
)

# Priority 3: financial keyword immediately before an amount (no currency symbol)
_KEYWORD_AMOUNT_RE = re.compile(
    r'(?:amount|total|charge(?:d)?|debit(?:ed)?|payment|paid|bill|spend(?:ing)?|due)\s*'
    r'(?:of|:)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)',
    re.IGNORECASE,
)

_KEYWORD_RE = re.compile(
    r'spent|purchase|charged|debited|transaction|card|payment', re.IGNORECASE
)

# Merchant extraction: ordered by specificity — first match wins.
_MERCHANT_PATTERNS = [
    # WF: "Merchant detail SOME MERCHANT in CITY" or "...SOME MERCHANT View Accounts"
    # No IGNORECASE — WF body has exact "Merchant detail" casing; merchants are ALL CAPS.
    # Lookahead stops at lowercase "in <CITY>", a comma, a Title-cased word (e.g. "View"), newline, or end.
    re.compile(r'\bMerchant detail\s+([A-Z][A-Z0-9 *&.\'\-]{2,}?)(?=\s+in\b|\s*,|\s+[A-Z][a-z]|\n|$)'),
    # Chase: "transaction with [PROC* ]MERCHANT on your card" or trailing " -" / newline in subject
    re.compile(r'\btransaction with\s+(?:(?:TST|SQ|SQU|PMT)\*\s*)?([A-Za-z0-9][\w &*.\'\-]{1,}?)(?=\s+on\b|\s+[-]|\s*\n|\s*$)', re.IGNORECASE),
    # Amex: "MERCHANT NAME $XX.XX*" or "MERCHANT NAME INR X,XXX.XX*"
    re.compile(r'([A-Z][A-Z0-9 &.\'\-]{4,}?)\s+(?:\$|INR\s*)[0-9,]+\.[0-9]{2}\*'),
    # Privacy.com / generic: "authorized at MERCHANT on your card"
    re.compile(r'\b(?:authorized at|purchased at|at)\s+([A-Za-z0-9][\w *&.\'\-]{1,}?)(?=\s+on\b|\s*[.,]|\n|$)', re.IGNORECASE),
]


@dataclass
class ExpenseMatch:
    amount: float | None
    currency: str | None
    merchant: str | None
    confidence: float


def extract_amount(text: str) -> tuple[float | None, str | None]:
    if not text:
        return None, None

    text = _THRESHOLD_CONTEXT_RE.sub('', text)

    # Priority 1: first $ amount (not the largest — transaction amount comes first in alerts)
    for raw in _DOLLAR_RE.findall(text):
        amount = float(raw.replace(',', ''))
        if 0 < amount < 1_000_000:
            return amount, 'USD'

    # Priority 2: INR amounts
    for raw in _INR_RE.findall(text):
        amount = float(raw.replace(',', ''))
        if 0 < amount < 10_000_000:
            return amount, 'INR'

    # Priority 3: keyword-anchored amounts (fallback, currency unknown)
    m = _KEYWORD_AMOUNT_RE.search(text)
    if m:
        amount = float(m.group(1).replace(',', ''))
        if 0 < amount < 1_000_000:
            return amount, None

    return None, None


def extract_merchant(text: str) -> str | None:
    if not text:
        return None
    for pattern in _MERCHANT_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        merchant = re.sub(r'\s{2,}', ' ', m.group(1).strip())
        return merchant[:80] if len(merchant) >= 2 else None
    return None


def extract_expense(text: str) -> ExpenseMatch:
    amount, currency = extract_amount(text)
    merchant = extract_merchant(text)

    confidence = 0.0
    if amount is not None:
        confidence += 0.6
    if _KEYWORD_RE.search(text or ''):
        confidence += 0.2
    if merchant:
        confidence += 0.1

    return ExpenseMatch(
        amount=amount,
        currency=currency,
        merchant=merchant,
        confidence=round(confidence, 2),
    )
