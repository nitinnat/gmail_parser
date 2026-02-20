import time

from fastapi import HTTPException, Request, status

from api.settings import settings


def require_auth(request: Request) -> dict:
    if not settings.auth_enabled:
        return {"email": "disabled"}

    user = request.session.get("user")
    expires_at = request.session.get("expires_at")
    if not user or not expires_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    if time.time() > float(expires_at):
        request.session.clear()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        )

    return user
