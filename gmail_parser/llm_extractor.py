import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

from gmail_parser.categorizer import categorize, get_all_category_names
from gmail_parser.llm_client import LLMError, call_llm

logger = logging.getLogger(__name__)

_BATCH_SIZE = 40
_MAX_WORKERS = 8

# Spending transaction schema (stored as spending_json in ChromaDB):
# {
#   "is_transaction": bool,
#   "transactions": [{
#     "amount": float,                   // primary amount in stated currency
#     "currency": "USD",                 // ISO 4217
#     "merchant": "Netflix",             // as it appears in the email
#     "merchant_normalized": "Netflix",  // cleaned-up canonical name
#     "merchant_category": "Streaming",  // specific sub-category (e.g. Groceries, SaaS, Flights)
#     "transaction_type": "subscription",// purchase|refund|transfer|subscription|bill|fee|atm|other
#     "payment_method": "credit_card",   // credit_card|debit_card|bank_transfer|upi|wallet|bnpl|cash|other
#     "card_last4": "4242",
#     "card_network": "Visa",            // Visa|Mastercard|Amex|Discover|RuPay|other
#     "account_name": "Chase Sapphire",  // bank/card account name if mentioned
#     "date": "YYYY-MM-DD",              // transaction date (not email date)
#     "description": "...",              // line-item description from the receipt/alert
#     "is_recurring": bool,
#     "recurrence_period": "monthly",    // daily|weekly|monthly|quarterly|annual|null
#     "is_international": bool,
#     "foreign_amount": float|null,      // original amount before conversion
#     "foreign_currency": "INR"|null,
#     "exchange_rate": float|null,
#     "reference_id": "TXN123",          // order ID, transaction ID, reference number
#     "status": "completed"              // completed|pending|failed|reversed|disputed
#   }]
# }


def extract_batch(emails: list[dict], progress_callback=None) -> dict[str, dict]:
    """emails: list of {id, subject, sender, snippet, metadata}.
    Returns id -> {category, action_items, spending}.
    progress_callback(done, total) called as chunks complete."""
    total = len(emails)
    chunks = [emails[i : i + _BATCH_SIZE] for i in range(0, total, _BATCH_SIZE)]
    results: dict[str, dict] = {}
    done_count = 0
    lock = threading.Lock()

    logger.info("[llm_extractor] %d emails across %d chunks, %d workers", total, len(chunks), _MAX_WORKERS)

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        futures = {executor.submit(_extract_chunk, chunk): chunk for chunk in chunks}
        for future in as_completed(futures):
            chunk_results = future.result()
            with lock:
                results.update(chunk_results)
                done_count += len(futures[future])
                if progress_callback:
                    progress_callback(min(done_count, total), total)
            logger.info("[llm_extractor] %d / %d done", done_count, total)

    return results


def _extract_chunk(batch: list[dict]) -> dict[str, dict]:
    categories = get_all_category_names()
    today = date.today().isoformat()
    items = "\n\n".join(
        f'EMAIL_ID: {e["id"]}\nSender: {e.get("sender", "")[:60]}\n'
        f'Subject: {e.get("subject", "")[:80]}\n'
        f'Snippet: {e.get("snippet", "")[:400]}'
        for e in batch
    )
    prompt = (
        f"Today is {today}. For each email do three things:\n"
        f"1. Categorize into exactly one of: {', '.join(categories)}\n"
        "2. Extract action items required FROM THE RECIPIENT (deadlines if mentioned, urgency: high/medium/low)\n"
        "3. Extract spending/transaction data if the email is a receipt, payment confirmation, bank alert, or invoice.\n"
        "   For spending, capture: amount, currency, merchant, merchant_normalized, merchant_category (specific e.g. Groceries/SaaS/Flights/Dining), "
        "transaction_type (purchase|refund|transfer|subscription|bill|fee|atm|other), "
        "payment_method (credit_card|debit_card|bank_transfer|upi|wallet|bnpl|cash|other), "
        "card_last4, card_network (Visa|Mastercard|Amex|Discover|RuPay|other), account_name, "
        "date (YYYY-MM-DD, use transaction date not email date), description, "
        "is_recurring (bool), recurrence_period (monthly|annual|weekly|quarterly|null), "
        "is_international (bool), foreign_amount, foreign_currency, exchange_rate, "
        "reference_id (order/txn ID), status (completed|pending|failed|reversed|disputed).\n"
        "Return ONLY a JSON array, no markdown:\n"
        '[{"id":"<id>","category":"<cat>","action_items":[{"action":"...","deadline":"YYYY-MM-DD or null","urgency":"high|medium|low"}],'
        '"spending":{"is_transaction":false,"transactions":[]}}]\n'
        "Include every email id. Use action_items:[] and spending:{\"is_transaction\":false,\"transactions\":[]} if none apply.\n\n"
        f"{items}"
    )
    try:
        raw = call_llm(prompt, timeout=120.0)
        start, end = raw.find("["), raw.rfind("]") + 1
        if start == -1 or end == 0:
            raise ValueError("no JSON array in response")
        parsed = json.loads(raw[start:end])
        id_to_result = {item["id"]: item for item in parsed}

        results: dict[str, dict] = {}
        fallbacks = 0
        for e in batch:
            item = id_to_result.get(e["id"], {})
            cat = item.get("category")
            if cat not in categories:
                cat = categorize(e.get("metadata", {}))
                fallbacks += 1
            results[e["id"]] = {
                "category": cat,
                "action_items": item.get("action_items", []),
                "spending": item.get("spending", {"is_transaction": False, "transactions": []}),
            }
        if fallbacks:
            logger.warning("[llm_extractor] %d/%d categories fell back to heuristics", fallbacks, len(batch))
        return results
    except (LLMError, Exception) as exc:
        logger.warning("[llm_extractor] chunk failed (%s), using heuristics for categories", exc)
        return {
            e["id"]: {
                "category": categorize(e.get("metadata", {})),
                "action_items": [],
                "spending": {"is_transaction": False, "transactions": []},
            }
            for e in batch
        }
