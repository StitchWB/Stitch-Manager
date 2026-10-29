"""
DeepSeek Chat API Adapter - WASM-based PoW solving, session management, streaming
Supports expert mode (thinking_enabled, search_enabled).

Anti-detection upgrades (2026-06):
- TLS/JA3 impersonation via curl_cffi (chrome131)
- Header set & values captured from a real Chrome 149 + chat.deepseek.com session
- Cookie jar auto-rotates Set-Cookie (cf_clearance / awswaf token refresh)
- Detects 405 x-amzn-waf-action=captcha and 403/429 cf-mitigated=challenge
"""
import base64
import json
import os
import random
import time

try:
    from curl_cffi import requests as cffi_requests
except ImportError as e:
    # Vendor patch: ImportError (not SystemExit) so a missing optional dep degrades the provider to "unavailable".
    raise ImportError(
        "curl_cffi is required for TLS fingerprint impersonation.\n"
        "Run: pip install -r requirements.txt"
    ) from e

from . import sse as _sse
from . import util as _util
from .errors import (
    PoWError,
    RateLimitError,
    UpstreamEmptyError,
    UpstreamHintError,
    UserMutedError,
    WAFChallengeError,
    WASMError,
    _mute_msg,
)
from .hif import HIF_DLIQ_URL, HIF_LEIM_URL, _HifProvider
from .logger import get_logger
from .pow_solver import _WASM_BYTES, _WASM_PATH, _WASMSolver

log = get_logger("adapter")

COOKIES = os.environ.get("DEEPSEEK_COOKIES", "")
BASE_URL = "https://chat.deepseek.com"
TOKEN = os.environ.get("DEEPSEEK_TOKEN", "")
IMPERSONATE = os.environ.get("DEEPSEEK_IMPERSONATE", "chrome131")
try:
    JITTER_SECS = max(0.0, float(os.environ.get("DEEPSEEK_JITTER_SECS", "0.4") or 0))
except ValueError:
    JITTER_SECS = 0.0

# Each entry delays (seconds) one retry after an upstream RateLimitError; empty list disables retries.
try:
    _raw_delays = os.environ.get("DEEPSEEK_RATE_LIMIT_RETRY_DELAYS", "5,15")
    RATE_LIMIT_RETRY_DELAYS = [float(x) for x in _raw_delays.split(",") if x.strip()]
except ValueError:
    RATE_LIMIT_RETRY_DELAYS = []


class DeepSeekAdapter:
    """Adapter for DeepSeek Chat API"""

    # UA must match the impersonation profile's TLS fingerprint (chrome131 = Chrome 131); bump both together.
    _DEFAULT_UA = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
    _DEFAULT_SEC_CH_UA = (
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
    )

    def __init__(self, token: str = TOKEN, cookies: str = COOKIES,
                 impersonate: str = IMPERSONATE, proxy: str | None = None):
        self.token = self._normalize_token(token)
        self.cookies = cookies
        self.impersonate = impersonate
        self.proxy = proxy
        self._solver = None
        # curl_cffi.Session auto-merges Set-Cookie, so cf_clearance / AWS WAF tokens stay fresh across calls.
        self._client = cffi_requests.Session(
            impersonate=impersonate,
            timeout=120,
            proxies={"all": proxy} if proxy else None,
        )
        # Best-effort hif signature headers (see _HifProvider); never fails the main request.
        self._hif = _HifProvider(client=self._client)
        # Seed jar from the user-supplied cookie blob (one-shot import; afterwards the jar is source of truth).
        if cookies:
            for part in cookies.split(";"):
                part = part.strip()
                if not part or "=" not in part:
                    continue
                name, value = part.split("=", 1)
                try:
                    self._client.cookies.set(
                        name.strip(), value.strip(), domain=".deepseek.com"
                    )
                except Exception as e:
                    log.debug(
                        "cookie_seed_failed",
                        extra={"name": name, "error": str(e)},
                    )

        self._msg_counters: dict[str, int] = {}
        # Header set and name casing mirror a live browser fetch().
        self._base_headers = {
            "User-Agent": self._DEFAULT_UA,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
            "Origin": BASE_URL,
            "Referer": f"{BASE_URL}/",
            "Priority": "u=1, i",
            "Sec-Ch-Ua": self._DEFAULT_SEC_CH_UA,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            # DeepSeek-specific application headers; x-client-version tracks the browser release.
            "X-Client-Version": "2.3.0",
            "X-Client-Platform": "web",
            "X-Client-Locale": "zh_CN",
            "X-Client-Timezone-Offset": "28800",
            "x-client-bundle-id": "com.deepseek.chat",
        }

    @staticmethod
    def _normalize_token(token: str) -> str:
        return _util._normalize_token(token)

    @staticmethod
    def _detect_waf_challenge(status: int, headers) -> str | None:
        return _util._detect_waf_challenge(status, headers)

    @property
    def solver(self):
        if self._solver is None:
            self._solver = _WASMSolver()
        return self._solver

    def _get_challenge(self, target_path: str = "/api/v0/chat/completion"):
        resp = self._client.post(
            f"{BASE_URL}/api/v0/chat/create_pow_challenge",
            json={"target_path": target_path},
            headers=self._base_headers,
        )
        kind = self._detect_waf_challenge(resp.status_code, resp.headers)
        if kind:
            raise WAFChallengeError(kind, resp.status_code, resp.text)
        resp.raise_for_status()
        data = resp.json()
        try:
            return data["data"]["biz_data"]["challenge"]
        except (KeyError, TypeError) as e:
            raise RuntimeError(
                f"Unexpected challenge response structure: {data.get('code', 'unknown')} - {data.get('msg', str(e))}"
            )

    def _solve(self, challenge_data: dict) -> str:
        nonce = self.solver.solve(
            challenge=challenge_data["challenge"],
            salt=challenge_data["salt"],
            expire_at=challenge_data["expire_at"],
            difficulty=challenge_data["difficulty"],
        )
        raw = json.dumps({
            "algorithm": "DeepSeekHashV1",
            "challenge": challenge_data["challenge"],
            "salt": challenge_data["salt"],
            "answer": nonce,
            "signature": challenge_data["signature"],
            "target_path": challenge_data["target_path"],
        }, separators=(",", ":"))
        return base64.b64encode(raw.encode()).decode()

    def _pow_headers(self, target_path: str = "/api/v0/chat/completion",
                     include_hif: bool = True):
        if JITTER_SECS > 0:
            time.sleep(random.uniform(0, JITTER_SECS))
        c = self._get_challenge(target_path)
        pow_h = self._solve(c)
        headers = {**self._base_headers, "X-DS-PoW-Response": pow_h}
        if include_hif:
            headers.update(self._hif.headers())
        return headers

    def create_session(self) -> str:
        """Create a new chat session, returns session_id"""
        headers = self._pow_headers("/api/v0/chat/completion", include_hif=False)
        resp = self._client.post(
            f"{BASE_URL}/api/v0/chat_session/create",
            json={"target_path": "/api/v0/chat/completion"},
            headers=headers,
        )
        kind = self._detect_waf_challenge(resp.status_code, resp.headers)
        if kind:
            raise WAFChallengeError(kind, resp.status_code, resp.text)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"Session creation failed: {data}")
        biz = data["data"]["biz_data"]
        # Handle both formats: direct id vs nested chat_session.id
        if "id" in biz:
            return biz["id"]
        return biz["chat_session"]["id"]

    def _parse_sse(self, text: str):
        return _sse._parse_sse(text)

    @staticmethod
    def _scan_toast_errors(events):
        return _sse._scan_toast_errors(events)

    @staticmethod
    def _scan_hint_errors(events):
        return _sse._scan_hint_errors(events)

    @staticmethod
    def _raise_hint_error(content: str, finish_reason: str):
        _sse._raise_hint_error(content, finish_reason)

    def _send_completion(self, session_id: str, prompt: str, stream: bool = False,
                         model_type: str | None = None,
                         thinking_enabled: bool = False, search_enabled: bool = False,
                         parent_message_id: int | None = None):
        """Send a completion request, returns raw response.

        ``parent_message_id`` is the message id from the previous turn in
        this chat_session. Pass ``None`` to start a fresh thread. When the
        caller doesn't provide one, the per-session counter is used as a
        monotonically increasing fallback (legacy behavior).
        """
        headers = self._pow_headers("/api/v0/chat/completion")
        if parent_message_id is None:
            mid = self._msg_counters.get(session_id, 0) + 1
            self._msg_counters[session_id] = mid
            parent_message_id = mid - 1 if mid > 1 else None
        body = {
            "chat_session_id": session_id,
            "parent_message_id": parent_message_id,
            "model_type": model_type,
            "prompt": prompt,
            "ref_file_ids": [],
            "stream": stream,
            "thinking_enabled": thinking_enabled,
            "search_enabled": search_enabled,
            "preempt": False,
        }
        # Fresh Session for non-stream: a connection abandoned mid-stream could be reused and return an empty body.
        if stream:
            client = self._client
        else:
            client = cffi_requests.Session(
                impersonate=self.impersonate,
                timeout=120,
                proxies={"all": self.proxy} if self.proxy else None,
            )
        resp = client.post(
            f"{BASE_URL}/api/v0/chat/completion",
            json=body,
            headers=headers,
        )
        kind = self._detect_waf_challenge(resp.status_code, resp.headers)
        if kind:
            raise WAFChallengeError(kind, resp.status_code, resp.text)
        resp.raise_for_status()
        return resp

    def chat(self, session_id: str, prompt: str, model_type: str | None = None,
             thinking_enabled: bool = False, search_enabled: bool = False,
             parent_message_id: int | None = None,
             ready_out: dict | None = None) -> tuple[str, str]:
        """Send a non-streaming chat message.

        Returns ``(content, thinking)``:
          * ``content`` — the user-facing answer (concatenated text tokens).
          * ``thinking`` — the expert-mode reasoning chain (empty string in
            quick mode or when ``thinking_enabled`` is False).

        The returned ``thinking`` lets the Anthropic ``/v1/messages``
        non-streaming endpoint expose the ``thinking`` content block.
        Callers that only care about the visible text should unpack with
        ``content, _ = adapter.chat(...)``.

        ``ready_out`` is an optional dict the caller provides; when the
        upstream ``ready`` event is seen the adapter fills
        ``ready_out["response_message_id"]`` (and keys it by the session
        actually used). This maintains the multi-turn parent chain — the
        server caches this id and re-sends it as ``parent_message_id`` on
        the next turn.
        """
        for attempt in range(1, max(len(RATE_LIMIT_RETRY_DELAYS), 1) + 2):
            try:
                ret = self._chat_once(session_id, prompt, model_type=model_type,
                                      thinking_enabled=thinking_enabled,
                                      search_enabled=search_enabled,
                                      parent_message_id=parent_message_id,
                                      ready_out=ready_out)
                if ready_out is not None:
                    ready_out["session_id"] = session_id
                return ret
            except UserMutedError:
                # Account-level penalty: persists until mute_until; backoff retries only waste time.
                raise
            except RateLimitError:
                idx = attempt - 1
                if idx >= len(RATE_LIMIT_RETRY_DELAYS):
                    raise
                delay = RATE_LIMIT_RETRY_DELAYS[idx]
                log.warning("upstream_rate_limit_retry_nonstream",
                            extra={"attempt": attempt, "delay": delay})
                time.sleep(delay)
                session_id = self.create_session()
                # Fresh session: re-sending a stale parent id makes the upstream reply empty again.
                parent_message_id = None
            except UpstreamEmptyError:
                if attempt > 1:
                    raise
                log.warning("upstream_empty_retry_nonstream")
                session_id = self.create_session()
                # Fresh session: never re-send the stale parent id.
                parent_message_id = None
        raise UpstreamEmptyError("upstream returned empty response")  # pragma: no cover

    def _chat_once(self, session_id: str, prompt: str, model_type: str | None = None,
                   thinking_enabled: bool = False, search_enabled: bool = False,
                   parent_message_id: int | None = None,
                   ready_out: dict | None = None) -> tuple[str, str]:
        resp = self._send_completion(session_id, prompt, stream=False,
                                     model_type=model_type,
                                     thinking_enabled=thinking_enabled,
                                     search_enabled=search_enabled,
                                     parent_message_id=parent_message_id)
        if not resp.text or not resp.text.strip():
            raise UpstreamEmptyError("upstream returned empty response body")

        # A mute/enforcement body is a plain JSON 200 (not SSE); the SSE parse would silently drop it.
        try:
            raw = json.loads(resp.text)
        except json.JSONDecodeError:
            raw = None
        mute = _mute_msg(raw) if isinstance(raw, dict) else None
        if mute:
            raise UserMutedError(mute)

        events = self._parse_sse(resp.text)
        return _sse._collect_chat_events(events, ready_out, session_id)

    def chat_stream(self, session_id: str, prompt: str,
                    model_type: str | None = None,
                    thinking_enabled: bool = False, search_enabled: bool = False,
                    parent_message_id: int | None = None,
                    ready_out: dict | None = None):
        """Stream a chat message, yields content tokens.

        In expert mode (model_type='expert'), yields dicts with
        __type='thinking' for reasoning tokens and strings for final content.

        ``parent_message_id`` is the message id from the previous turn; pass
        ``None`` to start a fresh thread.

        ``ready_out`` is an optional dict filled with the upstream
        ``response_message_id`` (and the session id actually used) when the
        ``event: ready`` frame arrives. The caller caches it and re-sends it
        as ``parent_message_id`` on the next turn to keep multi-turn sessions
        working (a stale parent id makes the upstream reply empty).

        A completely empty upstream stream (no tokens at all) is retried
        once with a fresh session; if it is still empty an
        ``UpstreamEmptyError`` is raised.
        """
        for attempt in range(1, max(len(RATE_LIMIT_RETRY_DELAYS), 1) + 2):
            yielded = False
            try:
                for token in self._chat_stream_once(
                        session_id, prompt, model_type=model_type,
                        thinking_enabled=thinking_enabled,
                        search_enabled=search_enabled,
                        parent_message_id=parent_message_id,
                        ready_out=ready_out):
                    yielded = True
                    yield token
            except UserMutedError:
                # Account-level penalty: persists until mute_until; no backoff retry.
                raise
            except RateLimitError:
                idx = attempt - 1
                if idx >= len(RATE_LIMIT_RETRY_DELAYS):
                    raise
                delay = RATE_LIMIT_RETRY_DELAYS[idx]
                log.warning("upstream_rate_limit_retry_stream",
                            extra={"attempt": attempt, "delay": delay})
                time.sleep(delay)
            except UpstreamEmptyError:
                if attempt > 1:
                    raise
            else:
                if yielded:
                    return
                log.warning("upstream_empty_retry_stream")
            if attempt > max(len(RATE_LIMIT_RETRY_DELAYS), 1):
                break
            session_id = self.create_session()
            # Retry uses a brand-new session; a stale parent id makes the upstream reply empty again.
            parent_message_id = None
        raise UpstreamEmptyError("upstream returned empty response")  # pragma: no cover

    def _chat_stream_once(self, session_id: str, prompt: str,
                          model_type: str | None = None,
                          thinking_enabled: bool = False, search_enabled: bool = False,
                          parent_message_id: int | None = None,
                          ready_out: dict | None = None):
        headers = self._pow_headers("/api/v0/chat/completion")
        if parent_message_id is None:
            mid = self._msg_counters.get(session_id, 0) + 1
            self._msg_counters[session_id] = mid
            parent_message_id = mid - 1 if mid > 1 else None
        body = {
            "chat_session_id": session_id,
            "parent_message_id": parent_message_id,
            "model_type": model_type,
            "prompt": prompt,
            "ref_file_ids": [],
            "stream": True,
            "thinking_enabled": thinking_enabled,
            "search_enabled": search_enabled,
            "preempt": False,
        }
        resp = self._client.post(
            f"{BASE_URL}/api/v0/chat/completion",
            json=body, headers=headers, stream=True,
        )
        yield from _sse._iter_stream_events(resp, ready_out, session_id)
