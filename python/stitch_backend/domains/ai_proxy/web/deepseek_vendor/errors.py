"""Upstream error types and mute-body detection for the DeepSeek vendor core."""
import datetime


class WASMError(Exception):
    pass


class PoWError(Exception):
    pass


class WAFChallengeError(Exception):
    """Raised when AWS WAF or Cloudflare returns a challenge response."""
    def __init__(self, kind: str, status: int, body: str = ""):
        super().__init__(f"{kind} challenge ({status}): {body[:200]}")
        self.kind = kind
        self.status = status
        self.body = body


class UpstreamEmptyError(RuntimeError):
    """Raised when the upstream returned a 200 with an empty body (no SSE
    data lines at all). This is typically a transient throttle/WAF state;
    the adapter retries once with a fresh session before giving up.
    """


class UpstreamHintError(RuntimeError):
    """Raised when the upstream signals an error via an SSE ``hint`` event
    (``type=error``) rather than an HTTP error — e.g. rate limiting.
    """


class RateLimitError(UpstreamHintError):
    """Upstream rate limiting (finish_reason ``rate_limit_reached``:
    '消息发送过于频繁，请稍后重试'). Maps to HTTP 429 on the server side."""


class UserMutedError(RateLimitError):
    """The upstream answered with ``biz_msg: "user is muted"`` (biz_code 5)
    — an account-level penalty, not a protocol issue. The body is a plain
    JSON 200 (no SSE channel), so the SSE parser sees zero tokens on it.
    """

    def __init__(self, message: str, mute_until: float | None = None):
        super().__init__(message, "user_muted")
        self.mute_until = mute_until


def _mute_msg(raw) -> str | None:
    """Return a human-readable mute message if ``raw`` is an upstream mute /
    enforcement body, else None. Detects the shape::

        {"code": 0, "data": {"biz_code": 5, "biz_msg": "user is muted",
                             "biz_data": {"is_muted": 1, "mute_until": ...}}}
    """
    if not isinstance(raw, dict):
        return None
    d = raw.get("data")
    if not isinstance(d, dict):
        return None
    biz_msg = str(d.get("biz_msg") or "")
    biz_code = d.get("biz_code")
    if biz_code is None:
        return None
    if int(biz_code) == 5 or "mute" in biz_msg.lower():
        until = ""
        bd = d.get("biz_data")
        if isinstance(bd, dict) and bd.get("mute_until"):
            try:
                until = "，解封时间 " + datetime.datetime.fromtimestamp(
                    float(bd["mute_until"])
                ).strftime("%Y-%m-%d %H:%M")
            except (TypeError, ValueError, OSError, OverflowError):
                until = ""
        return f"上游账号已静音：{biz_msg or 'user is muted'}{until}"
    return None
