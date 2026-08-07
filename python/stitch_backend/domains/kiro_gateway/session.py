"""Session affinity: extract session hint from requests and stabilize conversationId routing.

Reference: _references/Kiro-account-manager/.../proxyServer.ts extractSessionHint
plus sessionAffinity map with 10-minute TTL and per-API-key namespacing.
"""

from __future__ import annotations

import hashlib
import threading
import time
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from collections.abc import Mapping

    from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonObject

# ── extract_session_hint ──────────────────────────────────────────────────────


def extract_session_hint(headers: Mapping[str, str], body: JsonObject) -> str | None:
    """Extract a stable session hint from request headers and body.

    Three-tier priority:
    1. HTTP headers: explicit session IDs from known clients
    2. Body fields: conversation/thread/session identifiers
    2.5. Metadata: nested session/conversation fields
    3. History fingerprint: stable hash of first user message content

    Returns None when no hint is extractable.
    """
    # Tier 1: explicit stable headers
    header_hint = (
        headers.get("x-claude-code-session-id")
        or headers.get("x-opencode-session")
        or headers.get("x-session-affinity")
        or headers.get("x-conversation-id")
    )
    if header_hint:
        return str(header_hint)

    # Tier 2: body fields
    body_hint = (
        _body_str(body, "prompt_cache_key")
        or _body_str(body, "promptCacheKey")
        or _body_str(body, "conversation_id")
        or _body_str(body, "conversationId")
        or _body_str(body, "thread_id")
        or _body_str(body, "threadId")
        or _body_str(body, "session_id")
        or _body_str(body, "sessionId")
    )
    if body_hint:
        return body_hint

    # Tier 2.5: metadata nested fields
    metadata = body.get("metadata")
    if isinstance(metadata, dict):
        meta_hint = _body_str(metadata, "session_id") or _body_str(metadata, "conversation_id")
        if meta_hint:
            return meta_hint

    # Tier 3: history fingerprint (stable hash of first user message content)
    history = body.get("history")
    if isinstance(history, list) and history:
        fp = _fingerprint_from_history(history)
        if fp:
            return fp

    return None


# ── helpers ───────────────────────────────────────────────────────────────────


def _body_str(body: JsonObject, key: str) -> str | None:
    v = body.get(key)
    return str(v) if isinstance(v, str) and v else None


def _fingerprint_from_history(history: list[JsonObject]) -> str | None:
    """Stable hash of first 2 user messages (deterministic across processes via hashlib)."""
    if not history:
        return None
    parts: list[str] = []
    for msg in history[:2]:
        user_msg = msg.get("userInputMessage")
        assistant_msg = msg.get("assistantResponseMessage")
        user_content = ""
        if isinstance(user_msg, dict):
            uc = user_msg.get("content")
            user_content = str(uc) if isinstance(uc, str) else ""
        assistant_content = ""
        if isinstance(assistant_msg, dict):
            ac = assistant_msg.get("content")
            assistant_content = str(ac) if isinstance(ac, str) else ""
        parts.append(f"{user_content}|{assistant_content}")
    fp = "::".join(parts)
    return hashlib.sha256(fp.encode()).hexdigest()[:32]


# ── SessionAffinityEntry ──────────────────────────────────────────────────────


class _AffinityEntry(TypedDict):
    account_id: str
    last_at: float


# ── SessionAffinityStore ──────────────────────────────────────────────────────


class SessionAffinityStore:
    """In-memory conversationId → account_id map with TTL-based eviction.

    Per-API-key namespacing: keys are `f"{api_key_id}:{conversation_id}"`.
    A background thread runs periodic eviction at `eviction_interval_s` seconds.
    """

    _TTL_S = 600.0  # 10 minutes, matches reference proxyServer.ts

    def __init__(self, eviction_interval_s: float = 60.0) -> None:
        self._lock = threading.Lock()
        self._map: dict[str, _AffinityEntry] = {}
        self._eviction_interval_s = eviction_interval_s
        self._running = True
        self._evictor = threading.Thread(target=self._evict_loop, daemon=True)
        self._evictor.start()

    # ── public API ────────────────────────────────────────────────────────

    def get(self, conversation_id: str, api_key_id: str = "default") -> str | None:
        key = f"{api_key_id}:{conversation_id}"
        with self._lock:
            entry = self._map.get(key)
            if entry is None:
                return None
            if time.time() - entry["last_at"] > self._TTL_S:
                del self._map[key]
                return None
            entry["last_at"] = time.time()
            return entry["account_id"]

    def set(self, conversation_id: str, account_id: str, api_key_id: str = "default") -> None:
        key = f"{api_key_id}:{conversation_id}"
        with self._lock:
            self._map[key] = _AffinityEntry(account_id=account_id, last_at=time.time())

    def remove(self, conversation_id: str, api_key_id: str = "default") -> None:
        key = f"{api_key_id}:{conversation_id}"
        with self._lock:
            self._map.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._map.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._map)

    # ── eviction ──────────────────────────────────────────────────────────

    def _evict_loop(self) -> None:
        while self._running:
            time.sleep(self._eviction_interval_s)
            self._evict_expired()

    def _evict_expired(self) -> None:
        now = time.time()
        with self._lock:
            expired = [k for k, v in self._map.items() if now - v["last_at"] > self._TTL_S]
            for k in expired:
                del self._map[k]

    def stop(self) -> None:
        """Stop the eviction thread. Call on shutdown."""
        self._running = False
