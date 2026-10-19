"""``WebSessionAdapter`` protocol + shared helpers for web2api bridges.

This is the pure protocol layer (T1 of the web-gemini plan). It defines the
structural interface that concrete adapters (e.g.
``web.gemini_protocol`` + the future ``gemini_adapter``) satisfy, plus
reusable helpers: cookie-jar parsing and secret sanitization.

No FastAPI or DB imports live here — the adapter layer is intentionally
importable without the HTTP server or the ORM, so protocol units can be
tested in isolation. ``ClassifiedError`` is imported from
``ai_gateway.adapters.base`` (which itself has no FastAPI/DB deps) to reuse
the fixed error-category vocabulary.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Protocol, TypeAlias

from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

__all__ = [
    "ClassifiedError",
    "ModelDict",
    "WebSessionAdapter",
    "parse_cookie_jar",
    "sanitize_secrets",
]

# A model entry in the unified model list (matches the OpenAI
# ``/v1/models`` item shape). All values are strings — ``id``, ``provider``,
# ``name``, ``object`` — kept identical to the registry's ModelDict contract
# (inference_provider.py) so adapter fetchers plug into the registry cleanly.
ModelDict: TypeAlias = dict[str, str]


class WebSessionAdapter(Protocol):
    """Structural interface for an in-process web-session adapter.

    Phase 0 uses this protocol directly (plan decision D7). It is
    intentionally NOT ``ai_gateway.ProviderAdapter`` — migration to
    ``ProviderAdapter`` happens when the routing engine replaces
    ``_CHAT_COMPLETION_HANDLERS``. Method semantics are kept close:
    ``list_models`` / ``classify_error`` reuse the ``ClassifiedError``
    vocabulary so the future migration is mechanical.

    Adapters are stateless across requests: per-call state (which account,
    which cookies) is resolved by the caller and passed in ``request``.
    """

    provider_id: str
    """Stable provider id, e.g. ``"web-gemini"``. Used for model namespacing
    (``web-{provider}/<model>``) and account filtering."""

    async def available(self) -> bool:
        """Whether at least one credential (or anonymous fallback) is usable
        right now. Cheap — no upstream I/O; checks local state only."""
        ...

    async def list_models(self) -> list[ModelDict]:
        """Return the models this adapter exposes (from the static MODELS
        table, optionally filtered for anonymous mode)."""
        ...

    def stream_chat_completion(
        self, request: dict[str, object]
    ) -> AsyncIterator[str]:
        """Stream a chat completion as OpenAI SSE delta chunk strings.

        Each yielded value is a complete ``data: {...}\\n\\n``-ready payload
        (the caller wraps it in the SSE frame). The adapter is responsible
        for the full lifecycle: account selection, upstream call, JSPB
        parsing, OpenAI delta shaping, and the final ``[DONE]`` marker.
        """
        ...

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
    ) -> ClassifiedError:
        """Map a raised exception / HTTP status into a ``ClassifiedError``.

        Cookie/token values must never appear in the resulting message —
        callers sanitize via :func:`sanitize_secrets` before classification.
        """
        ...


# ─── Helpers ─────────────────────────────────────────────────────────────────


def parse_cookie_jar(cookie_str: str) -> dict[str, str]:
    """Parse a ``"SID=abc; HSID=def"`` cookie-jar string into a dict.

    Tolerates ``"; "`` and ``";"`` separators and surrounding whitespace
    per pair. Empty keys are skipped. Also accepts the JSON form used by
    the reference tooling (``{"cookie": "SID=...; ...", "sapisid": ...}``).
    """
    stripped = cookie_str.strip()
    if stripped.startswith("{"):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return {}
        if isinstance(payload, dict):
            inner = payload.get("cookie")
            if isinstance(inner, str):
                return parse_cookie_jar(inner)
        return {}
    pairs: dict[str, str] = {}
    for raw in cookie_str.split(";"):
        raw = raw.strip()
        if "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        if key:
            pairs[key] = value.strip()
    return pairs


def sanitize_secrets(text: str, secrets: set[str]) -> str:
    """Replace every secret value in ``text`` with ``[redacted]``.

    Mirrors ``zai_adapter.ZaiAdapter._sanitize``: the adapter collects
    sensitive values (auth tokens, cookie strings, SAPISID) into a set and
    calls this on any message before it leaves the adapter (error messages,
    logs). Empty/None entries are skipped.
    """
    sanitized = text
    for value in secrets:
        if value:
            sanitized = sanitized.replace(value, "[redacted]")
    return sanitized
