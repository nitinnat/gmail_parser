import logging

from fastapi import APIRouter
from pydantic import BaseModel

from gmail_parser.client import GmailClient
from gmail_parser.store import EmailStore

router = APIRouter()
logger = logging.getLogger(__name__)

_PREVIEW = {"preview": True}


class IdsRequest(BaseModel):
    ids: list[str]
    confirm: bool = False


class LabelRequest(BaseModel):
    ids: list[str]
    label_name: str
    confirm: bool = False


class SenderRequest(BaseModel):
    sender: str
    confirm: bool = False


@router.post("/trash")
def trash_emails(req: IdsRequest):
    if not req.confirm:
        return {**_PREVIEW, "would_trash": len(req.ids), "ids": req.ids}
    logger.info("[actions/trash] trashing %d messages: %s", len(req.ids), req.ids)
    client = GmailClient()
    for mid in req.ids:
        client.trash_message(mid)
    EmailStore().delete_emails(req.ids)
    logger.info("[actions/trash] done — %d messages trashed", len(req.ids))
    return {"trashed": len(req.ids)}


@router.post("/mark-read")
def mark_read(req: IdsRequest):
    if not req.confirm:
        return {**_PREVIEW, "would_mark_read": len(req.ids), "ids": req.ids}
    logger.info("[actions/mark-read] marking %d messages as read", len(req.ids))
    client = GmailClient()
    for mid in req.ids:
        client.modify_message(mid, remove_labels=["UNREAD"])
    logger.info("[actions/mark-read] done")
    return {"marked_read": len(req.ids)}


@router.post("/label")
def apply_label(req: LabelRequest):
    if not req.confirm:
        return {**_PREVIEW, "would_label": len(req.ids), "label_name": req.label_name, "ids": req.ids}
    logger.info("[actions/label] applying label '%s' to %d messages", req.label_name, len(req.ids))
    client = GmailClient()
    labels = client.list_labels()
    label_id = next((l["id"] for l in labels if l["name"] == req.label_name), None)
    if not label_id:
        label_id = client.create_label(req.label_name)["id"]
    for mid in req.ids:
        client.modify_message(mid, add_labels=[label_id])
    logger.info("[actions/label] done — label_id=%s", label_id)
    return {"labeled": len(req.ids), "label_id": label_id}


@router.post("/trash-sender")
def trash_sender(req: SenderRequest):
    store = EmailStore()
    result = store.get_emails(where={"sender": req.sender})
    ids = result["ids"]
    if not req.confirm:
        return {**_PREVIEW, "sender": req.sender, "would_trash": len(ids)}
    logger.info("[actions/trash-sender] trashing %d messages from '%s'", len(ids), req.sender)
    client = GmailClient()
    for mid in ids:
        client.trash_message(mid)
    store.delete_emails(ids)
    logger.info("[actions/trash-sender] done — %d trashed", len(ids))
    return {"trashed": len(ids), "sender": req.sender}
