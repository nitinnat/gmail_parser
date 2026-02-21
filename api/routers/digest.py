import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.settings import settings

router = APIRouter()


class DigestRequest(BaseModel):
    emails: list[dict]


@router.post("/summarize")
async def summarize(req: DigestRequest):
    if not req.emails:
        raise HTTPException(400, "No emails provided")

    lines = "\n".join(
        f"- [{e.get('bucket', '?').upper()}] {e.get('subject', '')} (from {e.get('sender', '')}, {e.get('date', '')[:10]})"
        for e in req.emails[:30]
    )
    prompt = (
        "You are a personal inbox assistant. Summarize the following emails in 2-3 sentences. "
        "Focus on what needs attention: replies needed, deadlines, important updates. Be concise and direct.\n\n"
        f"Emails:\n{lines}"
    )

    if settings.llm_provider == "ollama":
        return await _call_ollama(prompt)
    return await _call_anthropic(prompt)


async def _call_anthropic(prompt: str) -> dict:
    if not settings.llm_api_key:
        raise HTTPException(400, "LLM API key not configured (set DASHBOARD_LLM_API_KEY)")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.llm_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.llm_model or "claude-haiku-4-5-20251001",
                "max_tokens": 256,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        r.raise_for_status()
        return {"summary": r.json()["content"][0]["text"]}


async def _call_ollama(prompt: str) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{settings.llm_base_url}/api/chat",
            json={
                "model": settings.llm_model or "llama3.2",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            },
        )
        r.raise_for_status()
        return {"summary": r.json()["message"]["content"]}
