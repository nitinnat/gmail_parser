import json
import re
from pathlib import Path

from gmail_parser.config import settings

IMMIGRATION = "Immigration"
TAXES = "Taxes"
HEALTH = "Health & Insurance"
JOBS = "Jobs & Recruitment"
INVESTMENTS = "Investments"
MONEY = "Money"
TRAVEL = "Travel"
SHOPPING = "Shopping & Orders"
AI_TECH = "AI & Tech"
GOVERNMENT = "Government & Services"
SECURITY = "Security & Accounts"
NEWSLETTERS = "Newsletters"
PERSONAL = "Personal"
OTHER = "Other"

ALL_CATEGORIES = [
    IMMIGRATION, TAXES, HEALTH, JOBS, INVESTMENTS, MONEY,
    TRAVEL, SHOPPING, AI_TECH, GOVERNMENT, SECURITY, NEWSLETTERS, PERSONAL, OTHER,
]

# (category, sender_re, subject_re, labels_re)
# Rule fires if ANY provided pattern matches; first match wins (highest priority first)
_RULES: list[tuple[str, str | None, str | None, str | None]] = [
    (IMMIGRATION,
        r"uscis\.gov|dol\.gov|cbp\.dhs\.gov|nvc\.dos\.gov|immigration.*(attorney|law|consult)",
        r"\buscis\b|i-?485|i-?797|i-?140|i-?765|i-?131|green card|\bopt\b|h-?1b|employment authorization|labor certif|visa (status|application|approval|interview)|priority date|\bperm\b|national visa center",
        r"\|Immigration\|",
    ),
    (TAXES,
        r"irs\.gov|turbotax\.com|hrblock\.com|taxact\.com|freetaxusa\.com|taxslayer\.com",
        r"w-?2\b|1099-?\w*|\btaxe?s?\b.*(return|refund|document|form|filing|season|software|prep)|\birs\b.*\btax\b|estimated tax payment",
        None,
    ),
    (HEALTH,
        r"cigna|aetna|bluecross|bcbs|anthem|unitedhealthcare|optum|cvs\.com|cvshealth|walgreens\.com|riteaid|kaiser|humana|express.?scripts|quest.?diagnostics|labcorp|mychart|healthequity|hsabank",
        r"health insurance|medical (claim|bill|statement)|dental (plan|coverage|claim)|prescription|pharmacy (order|ship)|eob|explanation of benefit|deductible|copay|health (plan|coverage)|appointment (reminder|confirmation)|lab result|\bhsa\b|\bfsa\b",
        None,
    ),
    (JOBS,
        r"linkedin\.com.*(job|career|alert)|glassdoor\.com|indeed\.com|dice\.com|ziprecruiter|greenhouse\.io|lever\.co|lensa\.ai|hired\.com|jobvite",
        r"job alert|new jobs? matching|we.re hiring|open position|career opport|job application (received|submitted)|interview (invitation|request|scheduled)|apply.*role|your application to|new jobs? for you",
        r"\|Jobs\|",
    ),
    (INVESTMENTS,
        r"robinhood\.com|fidelity\.com|vanguard\.com|schwab\.com|etrade\.com|tdameritrade|webull|coinbase|binance|zerodha|groww\.in|upstox\.com|kuvera|smallcase|coin.?switch",
        r"portfolio (update|statement|summary)|dividend (payment|received)|stock (alert|activity)|trade (confirmation|executed)|investment (statement|summary)|brokerage statement|capital (gain|loss)|mutual fund|sip (investment|confirmation)",
        r"\|Robinhood\||\|Indian Investments\|",
    ),
    (MONEY,
        r"wellsfargo|chase\.com|bankofamerica|citibank|sofi\.com|nerdwallet|americanexpress|amex\.com|paypal|venmo|zelle|capitalone\.com|ally\.com|discover\.com|synchrony",
        r"bank (statement|alert|notification)|account (balance|statement|alert)|credit card (statement|payment|alert)|transaction (alert|notification)|wire transfer|ach (transfer|payment)|overdraft|credit score|loan (payment|statement)|mortgage (payment|statement)|rent (reminder|payment|receipt|invoice)|lease (renewal|agreement|expir)",
        r"\|Expenses/|\|Payments\||Label_1855894895900833747|Label_4999382456449891088|Label_5867791300677796251|Label_9052786769120093422",
    ),
    (TRAVEL,
        r"delta\.com|united\.com|southwest\.com|americanair|alaskaair|jetblue|lufthansa|emirates|airbnb\.com|vrbo|hotels\.com|booking\.com|expedia|kayak|hopper|travelocity|priceline|hertz|enterprise.*rent|avis\.com|tripadvisor",
        r"flight (confirmation|itinerary|check-in|booking|receipt)|hotel (confirmation|booking|reservation)|boarding pass|check-in (open|reminder)|trip (confirmation|summary|itinerary)|car rental confirmation|your (flight|booking|reservation) (confirm|itinerary)",
        None,
    ),
    (SHOPPING,
        r"amazon\.com|ebay\.com|target\.com|walmart\.com|kohls|costco|bestbuy|newegg\.com|etsy\.com|wayfair|overstock|nordstrom|macys|oldnavy|hm\.com|zara\.com|uniqlo|nike\.com|adidas|sunglass.hut|chewy\.com|doordash|ubereats|grubhub|instacart|postmates|hellofresh",
        r"order (confirm|shipped|delivered|dispatch|receip|placed)|your (order|shipment|package|delivery).*confirm|has (shipped|been delivered)|delivery (confirm|notification|update)|tracking (number|update)|package (delivered|out for delivery)|(thank you|thanks) for (your order|your purchase)|receipt for your (order|purchase)|purchase confirm|invoice #\d",
        None,
    ),
    (AI_TECH,
        r"openai\.com|chatgpt|anthropic|deepmind|huggingface|tldr\.tech|tldrnewsletter|bytebytego|alphasignal|therundown\.ai|bensbites|techcrunch|theverge|ycombinator",
        r"\bai\b.*(news|weekly|digest|roundup|update|newsletter|brief|research)|machine learning|deep learning|\bllm\b|neural network|tech (news|digest|weekly|newsletter)|developer (digest|weekly)|engineering (digest|weekly)",
        r"\|ML News\|",
    ),
    (GOVERNMENT,
        r"usps\.com|informeddelivery|\.gov\b|ssa\.gov|medicare\.gov",
        r"informed delivery|mail.*arriving|social security|medicare|medicaid|jury (duty|summons)|passport (renewal|application)|dmv (renewal|appointment)",
        None,
    ),
    (SECURITY,
        None,
        r"verify (your|the) (email|account|identity|phone|number)|password (reset|changed|recovery|update|expir)|login (attempt|alert|from new device)|security (alert|code|verification|warning)|two.?factor authentication|\b2fa\b|authentication code|sign.?in (attempt|alert)|unusual (activity|sign.?in)|account (locked|suspended|compromised|verification)|suspicious (activity|login|access)",
        None,
    ),
    (NEWSLETTERS,
        r"newsletter|substack\.com|coursera\.org|udemy\.com|edx\.org|pluralsight|skillshare|udacity|khanacademy|masterclass|duolingo|brilliant\.org|twitch\.tv|netflix\.com|spotify\.com|hulu\.com|disneyplus|hbomax|peacock|primevideo|steam|epicgames|playstation|xbox|nintendo|discord\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|nextdoor\.com|reddit\.com|pinterest|tiktok|snapchat",
        r"(weekly|daily|monthly) (digest|newsletter|roundup|brief|edition)|issue #\d|vol\.?\s*\d+|course (enroll|complet|certif|progress|purchased)|certificate (earned|available)|learning (path|progress)|new (episode|season|release)|game (pass|available)|commented on your|replied to your|mentioned you|tagged you in|new follower|new connection|\d+% off|buy one get|(flash|lightning|daily) (sale|deal)|exclusive (offer|deal|discount)|limited time offer|clearance sale",
        r"\|Online Courses\||\|Twitch\||\|CATEGORY_SOCIAL\||\|CATEGORY_PROMOTIONS\|",
    ),
    (PERSONAL,
        None,
        None,
        r"\|CATEGORY_PERSONAL\|",
    ),
]

_COMPILED: list[tuple[str, re.Pattern | None, re.Pattern | None, re.Pattern | None]] = [
    (
        cat,
        re.compile(s, re.IGNORECASE) if s else None,
        re.compile(sub, re.IGNORECASE) if sub else None,
        re.compile(lbl) if lbl else None,
    )
    for cat, s, sub, lbl in _RULES
]


_OVERRIDES_FILE = Path(settings.chroma_persist_dir) / "sender_categories.json"
_OVERRIDES: dict[str, str] = (
    json.loads(_OVERRIDES_FILE.read_text()) if _OVERRIDES_FILE.exists() else {}
)


def get_overrides() -> dict[str, str]:
    return dict(_OVERRIDES)


def set_sender_category(sender: str, category: str) -> None:
    _OVERRIDES[sender] = category
    _OVERRIDES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _OVERRIDES_FILE.write_text(json.dumps(_OVERRIDES, indent=2, sort_keys=True))


def categorize(metadata: dict) -> str:
    sender = metadata.get("sender", "")

    if sender in _OVERRIDES:
        return _OVERRIDES[sender]

    subject = metadata.get("subject", "")
    labels = metadata.get("labels", "")
    list_unsubscribe = metadata.get("list_unsubscribe", "")

    for cat, sender_re, subject_re, labels_re in _COMPILED:
        if sender_re and sender_re.search(sender):
            return cat
        if subject_re and subject_re.search(subject):
            return cat
        if labels_re and labels_re.search(labels):
            return cat

    # Emails with an unsubscribe header that didn't match a more specific category
    if list_unsubscribe:
        return NEWSLETTERS

    return OTHER
