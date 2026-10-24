"""Optional second opinion from a vision LLM hosted on GitHub Models (https://github.com/marketplace/models).

Off unless TC_GITHUB_MODELS_TOKEN is set (a GitHub token with the `models:read` permission). The token never
leaves the backend. Free-tier GitHub Models is rate limited, so this is an on-demand check, not part of the
per-frame loop. LLM answers can be wrong and are shown as advice only.
"""
import base64
import json

import httpx

from ..config import get_settings

ENDPOINT = "https://models.github.ai/inference/chat/completions"
PROMPT = """You are assisting an accessibility engineer planning where to lay a directional tactile paving strip
(300 mm tiles) for blind pedestrians in this photo of a footpath or campus walkway.
Reply with JSON only, using exactly these keys:
{"walkway_visible": true|false,
 "surface": "short description of the walking surface",
 "obstacles": [{"name": "...", "position": "left|centre|right", "blocks_route": true|false}],
 "hazards": ["e.g. kerb edge, steps, drain, slope"],
 "suggested_route": "one or two sentences: which side of the walkway the strip should follow and what to avoid",
 "confidence": "low|medium|high"}
If you cannot tell, say so in the fields rather than guessing."""


class NotConfigured(RuntimeError):
    pass


class UpstreamError(RuntimeError):
    pass


def configured() -> bool:
    return bool(get_settings().github_models_token)


def scene_check(jpeg: bytes) -> dict:
    s = get_settings()
    if not s.github_models_token:
        raise NotConfigured("GitHub Models is not configured. Set TC_GITHUB_MODELS_TOKEN on the backend.")
    image_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    body = {
        "model": s.github_models_model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [{"type": "text", "text": PROMPT},
                                                  {"type": "image_url", "image_url": {"url": image_url, "detail": "low"}}]}],
    }
    headers = {"Authorization": f"Bearer {s.github_models_token}", "Accept": "application/json",
               "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"}
    try:
        r = httpx.post(ENDPOINT, json=body, headers=headers, timeout=45)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Could not reach GitHub Models: {exc.__class__.__name__}") from exc
    if r.status_code == 429:
        raise UpstreamError("GitHub Models rate limit reached. Try again later.")
    if r.status_code >= 400:
        raise UpstreamError(f"GitHub Models returned {r.status_code}: {r.text[:200]}")
    try:
        content = r.json()["choices"][0]["message"]["content"]
        answer = json.loads(content)
    except (KeyError, IndexError, ValueError) as exc:
        raise UpstreamError("GitHub Models returned an unexpected response") from exc
    return {"model": s.github_models_model, "answer": answer}
