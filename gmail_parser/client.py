import base64
import logging
import random
import time
from datetime import datetime
from email.utils import parsedate_to_datetime

from bs4 import BeautifulSoup
from googleapiclient.errors import HttpError

from gmail_parser.auth import GmailAuth
from gmail_parser.exceptions import GmailAPIError

logger = logging.getLogger(__name__)


class GmailClient:
    def __init__(self, auth: GmailAuth | None = None):
        self._auth = auth or GmailAuth()
        self._service = None

    @property
    def service(self):
        if not self._service:
            self._service = self._auth.get_service()
        return self._service

    # --- Messages ---

    def get_message(self, message_id: str, format: str = "full") -> dict:
        try:
            return self.service.users().messages().get(
                userId="me", id=message_id, format=format
            ).execute()
        except Exception as e:
            raise GmailAPIError(f"Failed to get message {message_id}: {e}") from e

    def list_messages(
        self,
        query: str = "",
        label_ids: list[str] | None = None,
        max_results: int = 10000,
    ) -> list[dict]:
        messages = []
        request = self.service.users().messages().list(
            userId="me", q=query, labelIds=label_ids or [], maxResults=min(max_results, 500),
        )
        while request and len(messages) < max_results:
            response = request.execute()
            messages.extend(response.get("messages", []))
            request = self.service.users().messages().list_next(request, response)
        return messages[:max_results]

    def batch_get_messages(
        self, message_ids: list[str], format: str = "full", max_retries: int = 7,
    ) -> tuple[list[dict], list[str]]:
        """Returns (successful_results, permanently_failed_ids)."""
        results = {}
        non_retryable_failures = set()
        pending_ids = list(message_ids)
        batch_size = 10
        inter_batch_delay = 2.0

        for attempt in range(max_retries + 1):
            if not pending_ids:
                break

            rate_limited_ids = []
            for i in range(0, len(pending_ids), batch_size):
                chunk = pending_ids[i : i + batch_size]
                batch = self.service.new_batch_http_request()

                def _callback(request_id, response, exception, mid=None):
                    if exception:
                        status = getattr(getattr(exception, "resp", None), "status", None)
                        if isinstance(exception, HttpError) and status in (429, 403):
                            rate_limited_ids.append(mid)
                        else:
                            non_retryable_failures.add(mid)
                            logger.warning("[GmailClient] permanent error for %s (status=%s): %s", mid, status, exception)
                    else:
                        results[mid] = response

                for mid in chunk:
                    batch.add(
                        self.service.users().messages().get(userId="me", id=mid, format=format),
                        callback=lambda req_id, resp, exc, m=mid: _callback(req_id, resp, exc, m),
                    )
                batch.execute()

                if i + batch_size < len(pending_ids):
                    time.sleep(inter_batch_delay)

            if not rate_limited_ids:
                break

            pending_ids = rate_limited_ids
            backoff = min(2 ** (attempt + 1), 64) + random.uniform(0, 2)
            logger.info(
                "[GmailClient] %d messages rate-limited, retrying in %.1fs (attempt %d/%d)",
                len(rate_limited_ids), backoff, attempt + 1, max_retries,
            )
            time.sleep(backoff)
        else:
            # Loop exhausted all retries without breaking — remaining pending_ids are failures
            if pending_ids:
                logger.warning("[GmailClient] %d messages still rate-limited after %d retries", len(pending_ids), max_retries)
                non_retryable_failures.update(pending_ids)

        failed = [mid for mid in message_ids if mid in non_retryable_failures]
        return [results[mid] for mid in message_ids if mid in results], failed

    def get_history_id(self) -> str:
        return self.service.users().getProfile(userId="me").execute().get("historyId", "")

    @staticmethod
    def parse_message_metadata(raw: dict) -> dict:
        label_ids = raw.get("labelIds", [])
        headers = GmailClient.parse_headers(raw.get("payload", {}).get("headers", []))
        return {
            "gmail_id": raw["id"],
            "label_ids": label_ids,
            "is_read": "UNREAD" not in label_ids,
            "is_starred": "STARRED" in label_ids,
            "snippet": raw.get("snippet", ""),
            "history_id": raw.get("historyId", ""),
        }

    def modify_message(self, message_id: str, add_labels: list[str] | None = None, remove_labels: list[str] | None = None) -> dict:
        body = {
            "addLabelIds": add_labels or [],
            "removeLabelIds": remove_labels or [],
        }
        return self.service.users().messages().modify(userId="me", id=message_id, body=body).execute()

    def trash_message(self, message_id: str) -> dict:
        return self.service.users().messages().trash(userId="me", id=message_id).execute()

    def untrash_message(self, message_id: str) -> dict:
        return self.service.users().messages().untrash(userId="me", id=message_id).execute()

    # --- Threads ---

    def get_thread(self, thread_id: str) -> dict:
        return self.service.users().threads().get(userId="me", id=thread_id).execute()

    def list_threads(self, query: str = "", max_results: int = 100) -> list[dict]:
        threads = []
        request = self.service.users().threads().list(
            userId="me", q=query, maxResults=min(max_results, 500),
        )
        while request and len(threads) < max_results:
            response = request.execute()
            threads.extend(response.get("threads", []))
            request = self.service.users().threads().list_next(request, response)
        return threads[:max_results]

    def modify_thread(self, thread_id: str, add_labels: list[str] | None = None, remove_labels: list[str] | None = None) -> dict:
        body = {"addLabelIds": add_labels or [], "removeLabelIds": remove_labels or []}
        return self.service.users().threads().modify(userId="me", id=thread_id, body=body).execute()

    def trash_thread(self, thread_id: str) -> dict:
        return self.service.users().threads().trash(userId="me", id=thread_id).execute()

    # --- Labels ---

    def list_labels(self) -> list[dict]:
        return self.service.users().labels().list(userId="me").execute().get("labels", [])

    def get_label(self, label_id: str) -> dict:
        return self.service.users().labels().get(userId="me", id=label_id).execute()

    def create_label(self, name: str, **kwargs) -> dict:
        body = {"name": name, **kwargs}
        return self.service.users().labels().create(userId="me", body=body).execute()

    def update_label(self, label_id: str, **kwargs) -> dict:
        return self.service.users().labels().update(userId="me", id=label_id, body=kwargs).execute()

    def delete_label(self, label_id: str):
        self.service.users().labels().delete(userId="me", id=label_id).execute()

    # --- Attachments ---

    def get_attachment(self, message_id: str, attachment_id: str) -> dict:
        return self.service.users().messages().attachments().get(
            userId="me", messageId=message_id, id=attachment_id
        ).execute()

    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        data = self.get_attachment(message_id, attachment_id)
        return base64.urlsafe_b64decode(data["data"])

    # --- History ---

    def list_history(self, start_history_id: str, history_types: list[str] | None = None) -> list[dict]:
        records = []
        request = self.service.users().history().list(
            userId="me",
            startHistoryId=start_history_id,
            historyTypes=history_types or ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
        )
        while request:
            response = request.execute()
            records.extend(response.get("history", []))
            request = self.service.users().history().list_next(request, response)
        return records

    # --- Parsing ---

    @staticmethod
    def parse_headers(headers: list[dict]) -> dict:
        return {h["name"]: h["value"] for h in headers}

    @staticmethod
    def parse_message(raw_message: dict) -> dict:
        payload = raw_message.get("payload", {})
        headers = GmailClient.parse_headers(payload.get("headers", []))
        label_ids = raw_message.get("labelIds", [])

        body_text, body_html = GmailClient._extract_body(payload)

        date = None
        if date_str := headers.get("Date"):
            try:
                date = parsedate_to_datetime(date_str)
            except Exception:
                pass

        recipients = {
            "to": headers.get("To", ""),
            "cc": headers.get("Cc", ""),
            "bcc": headers.get("Bcc", ""),
        }

        attachments = GmailClient._extract_attachments(payload)

        return {
            "gmail_id": raw_message["id"],
            "thread_id": raw_message.get("threadId"),
            "subject": headers.get("Subject", ""),
            "sender": headers.get("From", ""),
            "recipients": recipients,
            "date": date,
            "internal_date": raw_message.get("internalDate"),
            "snippet": raw_message.get("snippet", ""),
            "body_text": body_text,
            "body_html": body_html,
            "raw_headers": headers,
            "size_estimate": raw_message.get("sizeEstimate"),
            "is_read": "UNREAD" not in label_ids,
            "is_starred": "STARRED" in label_ids,
            "is_draft": "DRAFT" in label_ids,
            "has_attachments": len(attachments) > 0,
            "history_id": raw_message.get("historyId"),
            "label_ids": label_ids,
            "attachments": attachments,
        }

    @staticmethod
    def _extract_body(payload: dict) -> tuple[str, str]:
        text_body = ""
        html_body = ""

        if parts := payload.get("parts"):
            for part in parts:
                mime = part.get("mimeType", "")
                if mime == "text/plain":
                    text_body = GmailClient._decode_body(part.get("body", {}))
                elif mime == "text/html":
                    html_body = GmailClient._decode_body(part.get("body", {}))
                elif mime.startswith("multipart/"):
                    t, h = GmailClient._extract_body(part)
                    text_body = text_body or t
                    html_body = html_body or h
        else:
            mime = payload.get("mimeType", "")
            decoded = GmailClient._decode_body(payload.get("body", {}))
            if mime == "text/plain":
                text_body = decoded
            elif mime == "text/html":
                html_body = decoded

        if not text_body and html_body:
            text_body = BeautifulSoup(html_body, "html.parser").get_text(separator=" ", strip=True)

        return text_body, html_body

    @staticmethod
    def _decode_body(body: dict) -> str:
        if data := body.get("data"):
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        return ""

    @staticmethod
    def _extract_attachments(payload: dict) -> list[dict]:
        attachments = []
        for part in payload.get("parts", []):
            if part.get("filename"):
                attachments.append({
                    "gmail_attachment_id": part.get("body", {}).get("attachmentId"),
                    "filename": part["filename"],
                    "mime_type": part.get("mimeType"),
                    "size": part.get("body", {}).get("size", 0),
                })
            if part.get("parts"):
                attachments.extend(GmailClient._extract_attachments(part))
        return attachments
