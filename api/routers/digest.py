from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from gmail_parser.llm_client import LLMError, call_llm

router = APIRouter()


class DigestRequest(BaseModel):
    emails: list[dict]


@router.post("/summarize")
def summarize(req: DigestRequest):
    if not req.emails:
        raise HTTPException(400, "No emails provided")

    lines = "\n".join(
        f"- [{e.get('bucket', '?').upper()}] {e.get('subject', '')} "
        f"(from {e.get('sender', '')}, {e.get('date', '')[:10]})"
        for e in req.emails[:30]
    )
    prompt = (
        "You are a personal inbox assistant. Summarize the following emails in 2-3 sentences. "
        "Focus on what needs attention: replies needed, deadlines, important updates. "
        "Be concise and direct.\n\nEmails:\n" + lines
    )

    try:
        summary = call_llm(prompt, timeout=60.0)
        return {"summary": summary}
    except LLMError as e:
        raise HTTPException(503, f"LLM unavailable: {e}") from e
