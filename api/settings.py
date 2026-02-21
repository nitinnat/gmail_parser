import secrets
from pathlib import Path

from pydantic_settings import BaseSettings

from gmail_parser.config import settings as parser_settings


class DashboardSettings(BaseSettings):
    model_config = {"env_prefix": "DASHBOARD_"}

    auth_enabled: bool = True
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    allowed_email: str = ""
    session_secret: str = ""
    session_ttl_seconds: int = 86400
    https_only: bool = False
    cors_origins: str = "http://localhost:5173"
    llm_provider: str = "anthropic"  # "anthropic" | "ollama"
    llm_model: str = "claude-haiku-4-5-20251001"
    llm_api_key: str = ""
    llm_base_url: str = "http://localhost:11434"

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_session_secret(self) -> str:
        if self.session_secret:
            return self.session_secret
        secret_file = (
            Path(parser_settings.chroma_persist_dir) / "dashboard_session_secret.txt"
        )
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        if secret_file.exists():
            self.session_secret = secret_file.read_text().strip()
            return self.session_secret
        generated = secrets.token_urlsafe(48)
        secret_file.write_text(generated)
        self.session_secret = generated
        return self.session_secret


settings = DashboardSettings()
