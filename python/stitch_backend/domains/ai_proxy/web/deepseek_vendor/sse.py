"""SSE parsing and upstream response interpretation for the DeepSeek vendor core."""
import json

from .errors import (
    RateLimitError,
    UpstreamEmptyError,
    UpstreamHintError,
    UserMutedError,
    WAFChallengeError,
    _mute_msg,
)
from .logger import get_logger
from .util import _detect_waf_challenge

# invariant: logger name must stay "adapter" (ds2api.adapter) after the split
log = get_logger("adapter")


def _parse_sse(text: str):
    """Parse SSE text into a list of events"""
    events = []
    current_event = ""
    for line in text.split("\n"):
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            data_str = line[6:]
            if data_str:
                try:
                    events.append((current_event, json.loads(data_str)))
                except json.JSONDecodeError:
                    events.append((current_event, data_str))
            current_event = ""
    return events


def _scan_toast_errors(events):
    """Return the first upstream toast error in ``events`` as
    ``(message, finish_reason)``, or ``None`` if there is none.

    DeepSeek's web backend signals "this client is too old to use
    Expert / your account hit a content policy / etc." via an SSE
    ``toast`` event with ``type=error`` rather than a non-2xx HTTP
    status. Without this scan we silently turn that into an empty
    completion (issue #8) and the user has no idea why.
    """
    for event_type, data in events:
        if event_type != "toast" or not isinstance(data, dict):
            continue
        if str(data.get("type", "")).lower() != "error":
            continue
        content = data.get("content") or data.get("msg") or ""
        finish_reason = data.get("finish_reason") or "upstream_toast_error"
        return content, finish_reason
    return None


def _scan_hint_errors(events):
    """Return the first upstream ``hint`` error in ``events`` as
    ``(message, finish_reason)`` or ``None``.

    Rate limiting arrives as an SSE ``event: hint`` frame with
    ``type=error`` and ``finish_reason=rate_limit_reached``
    ('消息发送过于频繁，请稍后重试'). Unparsed, a rate-limited
    request looks like a successful empty completion.
    """
    for event_type, data in events:
        if event_type != "hint" or not isinstance(data, dict):
            continue
        if str(data.get("type", "")).lower() != "error":
            continue
        content = data.get("content") or data.get("msg") or ""
        finish_reason = data.get("finish_reason") or "upstream_hint_error"
        return content, finish_reason
    return None


def _raise_hint_error(content: str, finish_reason: str):
    if finish_reason == "rate_limit_reached" or "频繁" in (content or ""):
        raise RateLimitError(content or "rate limited", finish_reason)
    raise UpstreamHintError(
        f"upstream_hint_error: {content or ''} ({finish_reason})"
    )


def _collect_chat_events(events, ready_out, session_id) -> tuple[str, str]:
    """Process parsed SSE events of a non-streaming completion into (content, thinking)."""
    # Issue #8: upstream may reject with a toast event of type=error; surface it as a real exception.
    toast = _scan_toast_errors(events)
    if toast is not None:
        raise RuntimeError(f"upstream_toast_error: {toast[0]} ({toast[1]})")

    # Multi-turn parent chain: capture the upstream response message id; reusing a stale parent id returns empty.
    if ready_out is not None:
        for event_type, data in events:
            if not isinstance(data, dict):
                continue
            mid = None
            if event_type == "ready" and isinstance(data.get("response_message_id"), int):
                mid = data["response_message_id"]
            elif isinstance(data.get("v"), dict) and 'response' in data["v"]:
                r = data["v"]["response"]
                if isinstance(r.get("message_id"), int):
                    mid = r["message_id"]
            if mid is not None:
                ready_out["response_message_id"] = mid
                ready_out["session_id"] = session_id
                break

    # Rate limiting arrives as an event:hint frame with type=error (rate_limit_reached); surface it as an error.
    hint = _scan_hint_errors(events)
    if hint is not None:
        _raise_hint_error(hint[0], hint[1])

    # Collect all content from both normal mode and expert fragment mode
    content_parts = []
    thinking_parts = []
    frag_type = None  # None, 'thinking', 'content'

    for event_type, data in events:
        if not isinstance(data, dict):
            continue
        p = data.get("p", "")
        o = data.get("o", "")
        v = data.get("v", "")

        # Expert mode: initial response with fragments
        if isinstance(v, dict) and 'response' in v:
            resp_data = v['response']
            fragments = resp_data.get('fragments', [])
            if fragments:
                ft = fragments[0].get('type', '')
                frag_type = 'thinking' if ft == 'THINK' else 'content'
                fc = fragments[0].get('content', '')
                if fc:
                    (thinking_parts if frag_type == 'thinking' else content_parts).append(fc)
            continue

        # Expert mode: fragment content append
        if p == "response/fragments/-1/content" and o == "APPEND":
            if frag_type == 'thinking':
                thinking_parts.append(v)
            else:
                content_parts.append(v)
            continue
        if p == "response/fragments/-1/content" and not o:
            # Frag content without o (happens after fragment switch)
            if frag_type == 'thinking':
                thinking_parts.append(v)
            else:
                content_parts.append(v)
            continue

        # Expert mode: fragment switch
        if p == "response/fragments" and o == "APPEND":
            if isinstance(v, list) and v:
                new_type = v[0].get('type', '')
                if new_type == 'RESPONSE':
                    frag_type = 'content'
                elif new_type == 'THINK':
                    frag_type = 'thinking'
            continue

        # Normal mode
        if p == "response/content" and o == "APPEND":
            content_parts.append(v)
            continue

        # Plain token event — belongs to current fragment or normal mode
        if "v" in data and "p" not in data and "o" not in data:
            token = data["v"]
            if isinstance(token, str) and token:
                if frag_type == 'thinking':
                    thinking_parts.append(token)
                else:
                    content_parts.append(token)
            continue

    content = "".join(content_parts)
    thinking = "".join(thinking_parts)
    # Defense-in-depth: a reply with neither content nor reasoning is almost never legitimate; surface it for retry.
    if not content and not thinking:
        raise UpstreamEmptyError("upstream returned empty content")
    return content, thinking


def _iter_stream_events(resp, ready_out, session_id):
    """Yield tokens from one streaming response, surfacing WAF/mute/toast/hint errors."""
    try:
        kind = _detect_waf_challenge(resp.status_code, resp.headers)
        if kind:
            # Drain so the connection can be reused.
            try:
                body_text = resp.text
            except Exception as e:
                log.debug("waf_body_read_failed", extra={"error": str(e)})
                body_text = ""
            raise WAFChallengeError(kind, resp.status_code, body_text)
        resp.raise_for_status()
        frag_type = None  # None, 'thinking', 'content'
        current_event = ""  # tracks the most recent `event:` SSE field

        for line in resp.iter_lines():
            # curl_cffi yields bytes from iter_lines.
            if isinstance(line, (bytes, bytearray)):
                try:
                    line = line.decode("utf-8")
                except UnicodeDecodeError:
                    continue
            line = line.rstrip()
            if not line:
                continue
            if line.startswith("event: "):
                current_event = line[7:]
                continue
            if line.startswith("data: "):
                data_str = line[6:]
                if not data_str:
                    continue
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
            else:
                # Plain JSON body (non-SSE), e.g. the account-mute enforcement payload; skip if it fails to parse.
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
            if not isinstance(data, dict):
                continue

            p = data.get("p", "")
            o = data.get("o", "")
            v = data.get("v", "")

            # Mute enforcement arrives as a plain JSON 200 body (no SSE channel); surface it as a real error.
            mute = _mute_msg(data)
            if mute:
                raise UserMutedError(mute)

            # Toast/hint error payload may be top-level data or wrapped in {"v": ...}; check both (issue #8).
            err = (data if isinstance(data, dict)
                   and str(data.get("type", "")).lower() == "error" else None)
            if err is None and isinstance(v, dict) \
                    and str(v.get("type", "")).lower() == "error":
                err = v
            if current_event == "toast" and err is not None:
                raise RuntimeError(
                    f"upstream_toast_error: {err.get('content') or err.get('msg') or ''} "
                    f"({err.get('finish_reason') or 'upstream_toast_error'})"
                )
            if current_event == "hint" and err is not None:
                _raise_hint_error(
                    err.get("content") or err.get("msg") or "",
                    err.get("finish_reason") or "upstream_hint_error",
                )

            # Multi-turn parent chain: capture the response message id for the caller to re-send as parent_message_id.
            if ready_out is not None and current_event == "ready":
                if isinstance(data.get("response_message_id"), int):
                    ready_out["response_message_id"] = data["response_message_id"]
                    ready_out["session_id"] = session_id
            if isinstance(data.get("toast"), dict) and \
                    str(data["toast"].get("type", "")).lower() == "error":
                t = data["toast"]
                raise RuntimeError(
                    f"upstream_toast_error: {t.get('content') or t.get('msg') or ''} "
                    f"({t.get('finish_reason') or 'upstream_toast_error'})"
                )

            # Initial response with fragments (expert mode)
            if isinstance(v, dict) and 'response' in v:
                resp_data = v['response']
                fragments = resp_data.get('fragments', [])
                if fragments:
                    ft = fragments[0].get('type', '')
                    frag_type = 'thinking' if ft == 'THINK' else 'content'
                    fc = fragments[0].get('content', '')
                    if fc:
                        if frag_type == 'thinking':
                            yield {"__type": "thinking", "content": fc}
                        else:
                            yield fc
                else:
                    frag_type = 'content'
                    content = resp_data.get('content', '')
                    if content:
                        yield content
                continue

            # Fragment content append (expert mode)
            if p == "response/fragments/-1/content" and o == "APPEND":
                if frag_type == 'thinking':
                    if v:
                        yield {"__type": "thinking", "content": v}
                else:
                    if v:
                        yield v
                continue

            # Fragment content without o (after fragment switch in batched responses)
            if p == "response/fragments/-1/content" and not o:
                if frag_type == 'thinking':
                    if v:
                        yield {"__type": "thinking", "content": v}
                else:
                    if v:
                        yield v
                continue

            # Fragment switch (expert mode)
            if p == "response/fragments" and o == "APPEND":
                if isinstance(v, list) and v:
                    new_type = v[0].get('type', '')
                    if new_type == 'RESPONSE':
                        frag_type = 'content'
                    elif new_type == 'THINK':
                        frag_type = 'thinking'
                continue

            # Normal mode content
            if p == "response/content" and o == "APPEND":
                yield v
                continue

            # Plain token event
            if "v" in data and "p" not in data and "o" not in data:
                token = data["v"]
                if isinstance(token, str) and token:
                    if frag_type == 'thinking':
                        yield {"__type": "thinking", "content": token}
                    else:
                        yield token
                continue

            # Status
            if p == "response/status":
                yield {"__type": "status", "status": v}
                continue
    finally:
        try:
            resp.close()
        except Exception as e:
            log.debug("response_close_failed", extra={"error": str(e)})
