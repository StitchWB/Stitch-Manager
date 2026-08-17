"""Gemini web protocol core — pure async protocol layer (no DB, no FastAPI).

Ported from ``_references/gemini-web2api/gemini_web2api.py`` (Sophomoresty,
MIT, v1.1.0). The reference is study material only — never imported at
runtime. This module ports the protocol functions faithfully (same URLs,
headers, JSPB structure, chunk parsing) but rewrites sync urllib as async
httpx with an injectable HTTP client (``ZaiHttpClient`` DI pattern).

Provides:
- :func:`make_sapisidhash` — Google SAPISIDHASH Authorization header (**SHA1**).
- :func:`fetch_latest_bl` — ``gemini_bl`` build-label fetch with module-level cache.
- :func:`stream_generate` / :func:`generate` — StreamGenerate request builder + JSPB parser.
- :func:`extract_response_text` / :func:`clean_gemini_text` — response text extraction.
- :data:`MODELS` — model → (mode, think, desc) table (copied verbatim from reference).
- :func:`messages_to_prompt` — OpenAI messages → Gemini prompt (with tool-call injection).
- :func:`parse_tool_calls` — extract triple-backtick ``tool_call`` blocks from model output.

Out of scope (Phase 0 = text + tools only): image upload / data-URL handling.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

logger = logging.getLogger(__name__)

# ─── Constants ───────────────────────────────────────────────────────────────

GEMINI_BASE_URL = "https://gemini.google.com"
GEMINI_APP_URL = f"{GEMINI_BASE_URL}/app"
STREAM_GENERATE_PATH = (
    "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
)
DEFAULT_BL = "boq_assistant-bard-web-server_20260716.08_p0"
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
PROMPT_MAX_BYTES = 60000

# ─── Models (copied verbatim from reference) ─────────────────────────────────
# Mapping from JS source: MODE_CATEGORY enum (028-6eb337387583.js)
#   1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE

MODELS: dict[str, dict[str, int | str]] = {
    "gemini-3.7-flash": {
        "mode": 1, "think": 4,
        "desc": "Latest all-around model (Gemini 3.7 Flash)",
    },
    "gemini-3.6-flash": {
        "mode": 1, "think": 4,
        "desc": "All-around model (Gemini 3.6 Flash)",
    },
    "gemini-3.5-flash": {
        "mode": 1, "think": 4,
        "desc": "Alias for gemini-3.6-flash (backend upgraded)",
    },
    "gemini-3.5-flash-thinking": {
        "mode": 2, "think": 0,
        "desc": "Deep thinking mode, longest output (~20k chars)",
    },
    "gemini-3.1-pro": {
        "mode": 3, "think": 4,
        "desc": "Pro model (requires cookie for real routing)",
    },
    "gemini-auto": {
        "mode": 4, "think": 4,
        "desc": "Auto model selection",
    },
    "gemini-3.5-flash-thinking-lite": {
        "mode": 5, "think": 0,
        "desc": "Dynamic thinking with adaptive depth",
    },
    "gemini-flash-lite": {
        "mode": 6, "think": 4,
        "desc": "Lightweight fast model",
    },
}

# ─── HTTP client protocol (DI, zai pattern) ──────────────────────────────────


@dataclass(frozen=True, slots=True)
class GeminiHttpRequest:
    """A single Gemini StreamGenerate HTTP request (form-urlencoded body)."""

    url: str
    headers: dict[str, str]
    body: str


@dataclass(frozen=True, slots=True)
class GeminiHttpResponse:
    """A non-streaming HTTP response (status + full text)."""

    status_code: int
    text: str


class GeminiHttpClient(Protocol):
    """Injectable HTTP client for the Gemini protocol.

    Tests provide a fake; production uses :class:`HttpxGeminiHttpClient`.
    Mirrors the ``ZaiHttpClient`` DI pattern: the protocol layer never
    constructs its own transport.
    """

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        proxy: str | None = None,
    ) -> GeminiHttpResponse:
        ...

    def stream_post(
        self, request: GeminiHttpRequest, *, proxy: str | None = None
    ) -> AsyncIterator[str]:
        ...


class HttpxGeminiHttpClient:
    """Default httpx-based implementation of :class:`GeminiHttpClient`."""

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        proxy: str | None = None,
    ) -> GeminiHttpResponse:
        import httpx

        async with httpx.AsyncClient(timeout=60.0, proxy=proxy) as client:
            resp = await client.get(url, headers=headers or {})
        return GeminiHttpResponse(status_code=resp.status_code, text=resp.text)

    async def stream_post(
        self, request: GeminiHttpRequest, *, proxy: str | None = None
    ) -> AsyncIterator[str]:
        import httpx

        async with httpx.AsyncClient(timeout=180.0, proxy=proxy) as client:
            async with client.stream(
                "POST", request.url, content=request.body, headers=request.headers
            ) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_text():
                    yield chunk


class GeminiProtocolError(RuntimeError):
    """Raised when the Gemini upstream rejects or returns a malformed response."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


# ─── SAPISIDHASH (SHA1 — Google's algorithm, NOT SHA256) ────────────────────


def make_sapisidhash(sapisid: str, *, now: float | None = None) -> str:
    """Build the ``Authorization: SAPISIDHASH <ts>_<hash>`` header value.

    Google's algorithm: ``SHA1("<ts> <sapisid> https://gemini.google.com")``.
    Uses SHA1 deliberately — do NOT change to SHA256.
    """
    ts = int(now if now is not None else time.time())
    h = hashlib.sha1(
        f"{ts} {sapisid} https://gemini.google.com".encode()
    ).hexdigest()
    return f"SAPISIDHASH {ts}_{h}"


# ─── BL label fetch (module-level cache) ─────────────────────────────────────

_BL_CACHE: str | None = None


def get_cached_bl() -> str:
    """Return the cached bl label, or the default if none cached."""
    return _BL_CACHE or DEFAULT_BL


def set_cached_bl(bl: str | None) -> None:
    """Set or clear the module-level bl cache (tests use this to reset)."""
    global _BL_CACHE
    _BL_CACHE = bl


async def fetch_latest_bl(
    client: GeminiHttpClient, *, proxy: str | None = None
) -> str | None:
    """Fetch the latest ``gemini_bl`` build label from the Gemini page.

    GETs ``https://gemini.google.com/app`` and regex-extracts the
    ``boq_assistant-bard-web-server_...`` label. On success, updates the
    module-level cache and returns the label; on any failure returns None.
    """
    global _BL_CACHE
    try:
        resp = await client.get(
            GEMINI_APP_URL,
            headers={"User-Agent": DEFAULT_USER_AGENT},
            proxy=proxy,
        )
    except Exception as exc:  # noqa: BLE001 — protocol layer must not crash
        logger.warning("bl fetch failed: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("bl fetch returned status %d", resp.status_code)
        return None
    m = re.search(r"(boq_assistant-bard-web-server_\d+\.\d+_p\d+)", resp.text)
    if not m:
        logger.warning("bl pattern not found in page HTML")
        return None
    bl = m.group(1)
    _BL_CACHE = bl
    return bl


async def _refetch_bl(
    client: GeminiHttpClient, *, proxy: str | None = None
) -> bool:
    """Refetch bl once; return True if it changed (caller should retry).

    ``fetch_latest_bl`` writes the new label into the cache as a side
    effect, so the OLD value must be captured BEFORE the fetch — otherwise
    the comparison below is always equal and the 405-retry never fires.
    """
    old_bl = get_cached_bl()
    new_bl = await fetch_latest_bl(client, proxy=proxy)
    if new_bl and new_bl != old_bl:
        logger.info("bl updated: %s -> %s", old_bl, new_bl)
        return True
    return False


# ─── Request builder ─────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class GeminiStreamRequest:
    """Parameters for a StreamGenerate request."""

    prompt: str
    model_id: int
    think_mode: int
    cookie_str: str = ""
    sapisid: str = ""
    auth_user: str | None = None
    xsrf_token: str | None = None
    bl: str | None = None
    temporary_chats: bool = False


def _account_prefix(req: GeminiStreamRequest) -> str:
    if req.auth_user is None or req.auth_user == "":
        return ""
    return f"/u/{req.auth_user}"


def build_stream_url(req: GeminiStreamRequest, *, reqid: int) -> str:
    """Build the StreamGenerate URL with bl, hl, _reqid, rt query params."""
    bl = req.bl or get_cached_bl()
    prefix = _account_prefix(req)
    return (
        f"{GEMINI_BASE_URL}{prefix}{STREAM_GENERATE_PATH}"
        f"?bl={bl}&hl=en&_reqid={reqid}&rt=c"
    )


def build_stream_headers(req: GeminiStreamRequest) -> dict[str, str]:
    """Build the request headers (Content-Type, Origin, Cookie, Auth, ...)."""
    prefix = _account_prefix(req)
    headers: dict[str, str] = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": GEMINI_BASE_URL,
        "Referer": f"{GEMINI_BASE_URL}{prefix}/app",
        "X-Same-Domain": "1",
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if prefix:
        headers["X-Goog-AuthUser"] = str(req.auth_user)
    if req.cookie_str:
        headers["Cookie"] = req.cookie_str
    if req.sapisid:
        headers["Authorization"] = make_sapisidhash(req.sapisid)
    return headers


def build_stream_body(req: GeminiStreamRequest) -> str:
    """Build the form-urlencoded StreamGenerate body (JSPB inner array).

    The inner array structure is copied verbatim from the reference; field
    [79] selects the model, [17] sets the think mode, [41]/[45] control
    chat persistence, [59] is a random conversation id.
    """
    inner: list[Any] = [None] * 80
    inner[0] = [req.prompt, 0, None, None, None, None, 0]
    inner[1] = ["en"]
    inner[2] = ["", "", "", None, None, None, None, None, None, ""]
    inner[6] = [0]
    inner[7] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[req.think_mode]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    if req.temporary_chats:
        inner[41] = [1]
        inner[45] = 1
    else:
        inner[41] = [2]
    inner[53] = 0
    inner[59] = str(uuid.uuid4())
    inner[61] = []
    inner[68] = 1
    inner[79] = req.model_id

    outer = [None, json.dumps(inner)]
    params: dict[str, str] = {"f.req": json.dumps(outer)}
    if req.xsrf_token:
        params["at"] = req.xsrf_token
    return urllib.parse.urlencode(params)


# ─── JSPB chunk parsing ──────────────────────────────────────────────────────


def clean_gemini_text(text: str, strip: bool = True) -> str:
    """Remove internal code-execution artifacts from Gemini output."""
    text = re.sub(
        r"```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n.*?```\n?",
        "",
        text,
        flags=re.DOTALL,
    )
    return text.strip() if strip else text


def _strip_xssi_prefix(line: str) -> str:
    """Strip Google's ``)]}'`` XSSI protection prefix if present."""
    stripped = line.lstrip()
    if stripped.startswith(")]}'"):
        return stripped[4:]
    return line


def _extract_frame_texts(line: str) -> list[str]:
    """Extract text strings from a single JSPB stream frame line.

    A valid frame is a JSON array whose first element is ``["wrb.fr", null,
    <inner_json_str>]``. The inner JSON string parses to a list whose index
    4 holds response parts; each part's index 1 holds a list of text strings.
    Lines shorter than 200 chars or without ``"wrb.fr"`` are skipped (matches
    the reference heuristic for non-data lines).
    """
    line = _strip_xssi_prefix(line)
    if '"wrb.fr"' not in line or len(line) < 200:
        return []
    try:
        arr = json.loads(line)
        inner_str = arr[0][2]
        if not inner_str or len(inner_str) < 50:
            return []
        inner = json.loads(inner_str)
    except (json.JSONDecodeError, IndexError, TypeError):
        return []
    texts: list[str] = []
    if isinstance(inner, list) and len(inner) > 4 and inner[4]:
        for part in inner[4]:
            if (
                isinstance(part, list)
                and len(part) > 1
                and part[1]
                and isinstance(part[1], list)
            ):
                for t in part[1]:
                    # Keepalive frames carry ``ping!...`` strings in the same
                    # slot as model text (observed live: ``["rc_<id>",
                    # ["ping!..."]]``). They are not content — skip them,
                    # otherwise anonymous/throttled streams leak pings as
                    # assistant text.
                    if isinstance(t, str) and len(t) > 0 and not t.startswith("ping!"):
                        texts.append(t)
    return texts


def extract_response_text(raw: str) -> str:
    """Parse a full StreamGenerate response and return the final text.

    Raises :class:`GeminiProtocolError` if the response contains a
    ``BardErrorInfo`` rejection. Returns the last non-empty text found
    across all frames (Gemini sends cumulative text in each frame).
    """
    raw = _strip_xssi_prefix(raw)
    bard_err = re.search(r"BardErrorInfo\s*\[(\d+)\]", raw)
    if bard_err:
        raise GeminiProtocolError(
            "bard_error",
            f"Gemini upstream rejected request: BardErrorInfo [{bard_err.group(1)}]",
        )
    texts: list[str] = []
    for line in raw.split("\n"):
        texts.extend(_extract_frame_texts(line))
    text = ""
    for t in reversed(texts):
        if t.strip():
            text = t
            break
    return clean_gemini_text(text)


async def parse_stream_response(
    chunk_iter: AsyncIterator[str],
    *,
    first_text_timeout: float = 60.0,
) -> AsyncIterator[str]:
    """Parse JSPB streaming chunks, yielding incremental text deltas.

    Gemini sends cumulative text in each frame (frame N's text is a prefix
    of frame N+1's text). This function tracks ``prev_text`` and yields
    only the suffix delta, cleaned of code-execution artifacts.

    ``first_text_timeout`` bounds silent throttling (observed live for
    anonymous requests from sanctioned networks: the upstream returns 200
    and streams ``ping!`` keepalives forever without generating). Without
    this guard the stream would hang until the HTTP timeout.
    """
    buf = ""
    prev_text = ""
    got_text = False
    started = time.monotonic()
    async for chunk in chunk_iter:
        if not got_text and (time.monotonic() - started) > first_text_timeout:
            raise GeminiProtocolError(
                "stream_stalled",
                f"Gemini stream produced no text within {first_text_timeout:.0f}s "
                "(anonymous throttling or stale session)",
            )
        buf += chunk
        if "BardErrorInfo" in buf:
            m = re.search(r"BardErrorInfo\s*\[(\d+)\]", buf)
            if m:
                raise GeminiProtocolError(
                    "bard_error",
                    f"Gemini upstream rejected request: BardErrorInfo [{m.group(1)}]",
                )
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            for t in _extract_frame_texts(line):
                if len(t) > len(prev_text):
                    delta = clean_gemini_text(t[len(prev_text):], strip=False)
                    if delta:
                        yield delta
                    prev_text = t
                    got_text = True


# ─── Stream generate (async, with BL refetch on 405) ─────────────────────────


def _is_http_405(exc: BaseException) -> bool:
    """True if ``exc`` is an httpx HTTPStatusError with status 405."""
    resp = getattr(exc, "response", None)
    return resp is not None and getattr(resp, "status_code", 0) == 405


async def stream_generate(
    req: GeminiStreamRequest,
    http_client: GeminiHttpClient,
    *,
    proxy: str | None = None,
    clock: Callable[[], float] = time.time,
) -> AsyncIterator[str]:
    """Send a StreamGenerate request and yield incremental text deltas.

    On HTTP 405 (stale bl), refetches the bl label once and retries. Any
    other exception propagates to the caller (the adapter classifies it).
    """
    reqid = int(clock()) % 1000000
    url = build_stream_url(req, reqid=reqid)
    headers = build_stream_headers(req)
    body = build_stream_body(req)

    try:
        chunk_iter = http_client.stream_post(
            GeminiHttpRequest(url=url, headers=headers, body=body),
            proxy=proxy,
        )
        async for delta in parse_stream_response(chunk_iter):
            yield delta
    except Exception as exc:  # noqa: BLE001 — 405 retry is the protocol
        if _is_http_405(exc) and await _refetch_bl(http_client, proxy=proxy):
            reqid = int(clock()) % 1000000
            url = build_stream_url(req, reqid=reqid)
            chunk_iter = http_client.stream_post(
                GeminiHttpRequest(url=url, headers=headers, body=body),
                proxy=proxy,
            )
            async for delta in parse_stream_response(chunk_iter):
                yield delta
            return
        raise


# ─── Messages → prompt ───────────────────────────────────────────────────────


def messages_to_prompt(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> str:
    """Convert OpenAI messages to a Gemini prompt string.

    Injects a tool-call instruction block when ``tools`` is provided (the
    model is told to emit ``\\`\\`\\`tool_call`` blocks). Image parts in
    content arrays are ignored (Phase 0 = text + tools only).
    """
    parts: list[str] = []
    if tools:
        tool_defs: list[dict[str, Any]] = []
        for tool in tools:
            fn = tool.get("function", tool) if tool.get("type") == "function" else tool
            tool_defs.append({
                "name": fn.get("name", tool.get("name", "")),
                "description": fn.get("description", tool.get("description", "")),
                "parameters": fn.get("parameters", tool.get("parameters", {})),
            })
        if tool_defs:
            tools_json = json.dumps(tool_defs, indent=2)
            if len(tools_json) > PROMPT_MAX_BYTES // 2:
                slim_defs = [
                    {"name": t["name"], "description": t["description"]}
                    for t in tool_defs
                ]
                tools_json = json.dumps(slim_defs, indent=2)
                logger.info(
                    "tools block too large (%d tools), stripped parameters",
                    len(tool_defs),
                )
            parts.append(
                "[System instruction]: You have access to tools. "
                "To call a tool, respond with:\n"
                '```tool_call\n{"name": "func_name", "arguments": {...}}\n```\n'
                "Only use tool_call blocks when needed.\n\n"
                f"Available tools:\n{tools_json}"
            )
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts: list[str] = []
            for c in content:
                if c.get("type") in ("text", "input_text", "output_text"):
                    text_parts.append(c.get("text", ""))
            content = " ".join(text_parts)
        if role == "system":
            parts.append(f"[System instruction]: {content}")
        elif role == "assistant":
            if msg.get("tool_calls"):
                tc_strs: list[str] = []
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    tc_strs.append(
                        f'```tool_call\n{{"name": "{fn.get("name")}", '
                        f'"arguments": {fn.get("arguments", "{}")}}}\n```'
                    )
                parts.append(f"[Assistant]: {content or ''}\n" + "\n".join(tc_strs))
            else:
                parts.append(f"[Assistant]: {content}")
        elif role == "tool":
            parts.append(f"[Tool result for {msg.get('name', '')}]: {content}")
        else:
            parts.append(content if content else "")
    return "\n\n".join(p for p in parts if p)


# ─── Tool call parsing ───────────────────────────────────────────────────────


def parse_tool_calls(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Extract ``\\`\\`\\`tool_call`` blocks from model output.

    Returns ``(clean_text, tool_calls)`` where each tool call follows the
    OpenAI format (``id``, ``type``, ``function.name``, ``function.arguments``).
    Invalid JSON blocks are silently skipped.
    """
    tool_calls: list[dict[str, Any]] = []
    pattern = r"```tool_call\s*\n(.*?)\n```"
    for match in re.findall(pattern, text, re.DOTALL):
        try:
            data = json.loads(match.strip())
            tool_calls.append({
                "id": f"call_{uuid.uuid4().hex[:8]}",
                "type": "function",
                "function": {
                    "name": data["name"],
                    "arguments": json.dumps(
                        data.get("arguments", {}), ensure_ascii=False
                    ),
                },
            })
        except (json.JSONDecodeError, KeyError):
            pass
    clean = re.sub(pattern, "", text, flags=re.DOTALL).strip()
    return clean, tool_calls
