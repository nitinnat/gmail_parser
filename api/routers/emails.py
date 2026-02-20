from fastapi import APIRouter, HTTPException, Query

from gmail_parser.search import EmailSearch, SearchFilters
from gmail_parser.store import EmailStore

router = APIRouter()


@router.get("")
def list_emails(
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=200),
    sender: str | None = None,
    label: str | None = None,
    category: str | None = None,
    unread: bool | None = None,
    starred: bool | None = None,
    search: str | None = None,
    mode: str = "hybrid",
):
    search_obj = EmailSearch()

    if search:
        if mode == "semantic":
            results = search_obj.semantic_search(search, limit=limit)
        elif mode == "fulltext":
            results = search_obj.fulltext_search(search, limit=limit)
        else:
            results = search_obj.hybrid_search(search, limit=limit)
        return {"emails": results, "page": 1, "limit": limit}

    filters = SearchFilters(
        sender=sender,
        label=label,
        category=category,
        is_read=None if unread is None else not unread,
        is_starred=starred,
    )
    results = search_obj.filter_emails(filters, limit=limit, offset=(page - 1) * limit)
    return {"emails": results, "page": page, "limit": limit}


@router.get("/{gmail_id}")
def get_email(gmail_id: str):
    email = EmailStore().get_email(gmail_id)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email
