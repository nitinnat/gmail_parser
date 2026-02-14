from pydantic_settings import BaseSettings


class EmailParserSettings(BaseSettings):
    model_config = {"env_prefix": "EMAIL_PARSER_"}

    chroma_persist_dir: str = "./email_data"
    google_credentials_path: str = "credentials.json"
    google_token_path: str = "token.json"
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    sync_batch_size: int = 100


def get_settings() -> EmailParserSettings:
    return EmailParserSettings()


class _LazySettings:
    _instance: EmailParserSettings | None = None

    def __getattr__(self, name: str):
        if self._instance is None:
            self._instance = get_settings()
        return getattr(self._instance, name)


settings = _LazySettings()
