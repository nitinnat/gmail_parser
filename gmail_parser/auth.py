import logging
import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from gmail_parser.config import settings
from gmail_parser.exceptions import AuthenticationError

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
]


class GmailAuth:
    def __init__(
        self,
        credentials_path: str | None = None,
        token_path: str | None = None,
        scopes: list[str] | None = None,
    ):
        self._credentials_path = credentials_path or settings.google_credentials_path
        self._token_path = token_path or settings.google_token_path
        self._scopes = scopes or SCOPES
        self._creds: Credentials | None = None

    def authenticate(self) -> Credentials:
        if os.path.exists(self._token_path):
            self._creds = Credentials.from_authorized_user_file(self._token_path, self._scopes)

        if self._creds and self._creds.valid:
            return self._creds

        if self._creds and self._creds.expired and self._creds.refresh_token:
            logger.info("[GmailAuth] refreshing expired token")
            self._creds.refresh(Request())
        else:
            if not os.path.exists(self._credentials_path):
                raise AuthenticationError(f"Credentials file not found: {self._credentials_path}")
            logger.info("[GmailAuth] starting OAuth2 flow")
            flow = InstalledAppFlow.from_client_secrets_file(self._credentials_path, self._scopes)
            self._creds = flow.run_local_server(port=0)

        with open(self._token_path, "w") as f:
            f.write(self._creds.to_json())
        logger.info("[GmailAuth] token saved to %s", self._token_path)
        return self._creds

    def get_service(self):
        if not self._creds or not self._creds.valid:
            self.authenticate()
        return build("gmail", "v1", credentials=self._creds)

    def revoke(self):
        if self._creds:
            self._creds.revoke(Request())
            if os.path.exists(self._token_path):
                os.remove(self._token_path)
            logger.info("[GmailAuth] credentials revoked")
