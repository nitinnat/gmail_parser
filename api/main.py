import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from api.deps import require_auth
from api.log_buffer import log_buffer
from api.routers import (
    sync,
    analytics,
    emails,
    actions,
    categories,
    alert_rules,
    auth,
    expenses,
    rules,
)
from api.settings import settings

# Attach in-process log capture to all gmail_parser loggers
logging.getLogger("gmail_parser").addHandler(log_buffer)
logging.getLogger("gmail_parser").setLevel(logging.INFO)

app = FastAPI(title="Gmail Dashboard API")

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.ensure_session_secret(),
    same_site="lax",
    https_only=settings.https_only,
    max_age=settings.session_ttl_seconds,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth")
app.include_router(
    sync.router, prefix="/api/sync", dependencies=[Depends(require_auth)]
)
app.include_router(
    analytics.router, prefix="/api/analytics", dependencies=[Depends(require_auth)]
)
app.include_router(
    emails.router, prefix="/api/emails", dependencies=[Depends(require_auth)]
)
app.include_router(
    actions.router, prefix="/api/actions", dependencies=[Depends(require_auth)]
)
app.include_router(
    categories.router, prefix="/api/categories", dependencies=[Depends(require_auth)]
)
app.include_router(
    alert_rules.router, prefix="/api/alerts", dependencies=[Depends(require_auth)]
)
app.include_router(
    expenses.router, prefix="/api/expenses", dependencies=[Depends(require_auth)]
)
app.include_router(
    rules.router, prefix="/api/rules", dependencies=[Depends(require_auth)]
)
