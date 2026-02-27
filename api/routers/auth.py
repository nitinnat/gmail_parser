import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow
from starlette.responses import RedirectResponse

from api.settings import settings
from gmail_parser.config import settings as parser_settings

router = APIRouter()
logger = logging.getLogger(__name__)

_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
]


def _make_state(raw: str, redirect_uri: str, next_path: str, secret: str) -> str:
    """Encode OAuth state + metadata into a signed, URL-safe token."""
    payload = base64.urlsafe_b64encode(
        json.dumps({"s": raw, "r": redirect_uri, "n": next_path}).encode()
    ).decode()
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{payload}.{sig}"


def _parse_state(token: str, secret: str) -> dict | None:
    """Verify and decode a state token; returns None if invalid."""
    parts = token.rsplit(".", 1)
    if len(parts) != 2:
        return None
    payload, sig = parts
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()))
    except Exception:
        return None


def _client_config() -> dict:
    if settings.google_client_id and settings.google_client_secret:
        return {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.google_redirect_uri],
            }
        }

    cred_path = Path(parser_settings.google_credentials_path)
    if not cred_path.exists():
        raise HTTPException(status_code=500, detail="Missing OAuth credentials")

    data = json.loads(cred_path.read_text())
    if "web" in data:
        return data
    if "installed" in data:
        return {"web": data["installed"]}

    raise HTTPException(status_code=500, detail="Invalid credentials.json format")


def _redirect_uri(config: dict, origin: str | None = None) -> str:
    if settings.google_redirect_uri:
        return settings.google_redirect_uri
    redirect_uris = config.get("web", {}).get("redirect_uris", [])
    if not redirect_uris:
        raise HTTPException(status_code=500, detail="No redirect URI configured")
    for uri in redirect_uris:
        if uri.startswith(("http://localhost:8000", "http://127.0.0.1:8000")):
            return uri
    if origin and origin in settings.cors_origin_list():
        candidate = f"{origin}/api/auth/callback"
        if candidate in redirect_uris:
            return candidate
    return redirect_uris[0]


def _safe_next(path: str | None) -> str:
    if not path:
        return "/"
    parsed = urlparse(path)
    if parsed.scheme or parsed.netloc:
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin in settings.cors_origin_list():
            return path
        return "/"
    return parsed.path or "/"


def _ensure_configured() -> None:
    if not settings.auth_enabled:
        return
    _client_config()
    settings.ensure_session_secret()


def _post_login_sync():
    """Kick off an incremental sync (or recent fallback) after login."""
    try:
        from gmail_parser.ingestion import IngestionPipeline
        from api.routers.sync import _run_incremental, _auto_sync, _lock
        pipeline = IngestionPipeline()
        state = pipeline._store.get_sync_state()
        if state and state.get("last_history_id"):
            logger.info("[auth] triggering incremental sync on login")
            _run_incremental()
        else:
            logger.info("[auth] no history_id — skipping login sync (run full sync first)")
        # Re-enable auto sync in case it was paused due to invalid_grant
        with _lock:
            if not _auto_sync["enabled"]:
                _auto_sync["enabled"] = True
                logger.info("[auth] re-enabled auto sync after login")
    except Exception as e:
        logger.warning("[auth] post-login sync failed: %s", e)


@router.get("/login")
def login(request: Request, next: str | None = None):
    _ensure_configured()
    if not settings.auth_enabled:
        return {"message": "auth disabled"}

    if request.url.hostname in {"localhost", "127.0.0.1"}:
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

    config = _client_config()
    redirect_uri = _redirect_uri(config, request.headers.get("origin"))
    next_path = _safe_next(next)
    raw_state = secrets.token_urlsafe(32)
    signed_state = _make_state(raw_state, redirect_uri, next_path, settings.ensure_session_secret())

    flow = Flow.from_client_config(config, scopes=_SCOPES)
    flow.redirect_uri = redirect_uri
    authorization_url, _ = flow.authorization_url(
        state=signed_state,
        access_type="offline",
        prompt="consent",
    )
    return RedirectResponse(authorization_url)


@router.get("/callback")
def callback(request: Request):
    _ensure_configured()
    if not settings.auth_enabled:
        return {"message": "auth disabled"}

    if request.url.hostname in {"localhost", "127.0.0.1"}:
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

    signed_state = request.query_params.get("state", "")
    parsed = _parse_state(signed_state, settings.ensure_session_secret())
    if not parsed:
        raise HTTPException(status_code=400, detail="Missing OAuth state")

    redirect_uri = parsed["r"]
    next_path = parsed["n"]

    config = _client_config()
    flow = Flow.from_client_config(config, scopes=_SCOPES, state=signed_state)
    flow.redirect_uri = redirect_uri

    authorization_response = str(request.url)
    if authorization_response.startswith("http://") and redirect_uri.startswith("https://"):
        authorization_response = "https://" + authorization_response[len("http://"):]
    flow.fetch_token(authorization_response=authorization_response)
    credentials = flow.credentials

    # Persist Gmail API token so IngestionPipeline can use it
    token_path = Path(parser_settings.google_token_path)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(credentials.to_json())
    logger.info("[auth] Gmail token saved to %s", token_path)

    id_token_value = getattr(credentials, "id_token", None)
    if not id_token_value:
        raise HTTPException(status_code=400, detail="Missing id_token")

    info = id_token.verify_oauth2_token(
        id_token_value,
        google_requests.Request(),
        config.get("web", {}).get("client_id"),
    )

    email = (info.get("email") or "").lower()

    allow_file = Path(parser_settings.chroma_persist_dir) / "dashboard_allowlist.json"
    allow_file.parent.mkdir(parents=True, exist_ok=True)
    allowed_email = settings.allowed_email.lower() if settings.allowed_email else ""
    if not allowed_email:
        if allow_file.exists():
            try:
                allowed_email = (
                    json.loads(allow_file.read_text()).get("email", "").lower()
                )
            except Exception:
                allowed_email = ""

    if not allowed_email:
        allow_file.write_text(json.dumps({"email": email}, indent=2))
        allowed_email = email

    if email != allowed_email:
        request.session.clear()
        raise HTTPException(status_code=403, detail="Email not authorized")

    request.session["user"] = {
        "email": email,
        "name": info.get("name", ""),
        "picture": info.get("picture", ""),
        "sub": info.get("sub", ""),
    }
    request.session["expires_at"] = time.time() + settings.session_ttl_seconds

    threading.Thread(target=_post_login_sync, daemon=True).start()

    return RedirectResponse(next_path or "/")


@router.get("/me")
def me(request: Request):
    if not settings.auth_enabled:
        return {"email": "disabled"}
    user = request.session.get("user")
    expires_at = request.session.get("expires_at")
    if not user or not expires_at or time.time() > float(expires_at):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}
