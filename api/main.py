import logging
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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
    digest,
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
app.include_router(
    digest.router, prefix="/api/digest", dependencies=[Depends(require_auth)]
)

# Serve built frontend — only when dist exists (production)
_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        file = _DIST / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(_DIST / "index.html")
