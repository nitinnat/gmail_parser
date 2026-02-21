import json
import os
import secrets
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

_SCOPES = ["openid", "email", "profile"]


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


@router.get("/login")
def login(request: Request, next: str | None = None):
    _ensure_configured()
    if not settings.auth_enabled:
        return {"message": "auth disabled"}

    if request.url.hostname in {"localhost", "127.0.0.1"}:
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

    config = _client_config()
    flow = Flow.from_client_config(config, scopes=_SCOPES)
    redirect_uri = _redirect_uri(config, request.headers.get("origin"))
    request.session["redirect_uri"] = redirect_uri
    flow.redirect_uri = redirect_uri

    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["next"] = _safe_next(next)

    authorization_url, returned_state = flow.authorization_url(
        state=state,
        access_type="online",
        prompt="select_account",
    )
    request.session["oauth_state"] = returned_state
    return RedirectResponse(authorization_url)


@router.get("/callback")
def callback(request: Request):
    _ensure_configured()
    if not settings.auth_enabled:
        return {"message": "auth disabled"}

    if request.url.hostname in {"localhost", "127.0.0.1"}:
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

    state = request.session.get("oauth_state")
    if not state:
        raise HTTPException(status_code=400, detail="Missing OAuth state")

    config = _client_config()
    flow = Flow.from_client_config(config, scopes=_SCOPES, state=state)
    redirect_uri = request.session.get("redirect_uri") or _redirect_uri(config)
    flow.redirect_uri = redirect_uri

    authorization_response = str(request.url)
    # Cloudflare Tunnel terminates TLS; ensure the scheme is https when the
    # registered redirect URI uses https but the proxy forwards plain HTTP.
    if authorization_response.startswith("http://") and redirect_uri.startswith("https://"):
        authorization_response = "https://" + authorization_response[len("http://"):]
    flow.fetch_token(authorization_response=authorization_response)
    credentials = flow.credentials

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

    next_path = request.session.pop("next", "/")
    request.session.pop("oauth_state", None)
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
