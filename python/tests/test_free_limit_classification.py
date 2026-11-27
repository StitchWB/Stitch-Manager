"""Regression tests: ReformBoss free-tier limit errors must not classify as unknown.

Live observation: upstream errors mentioning ``free_limit`` were logged as
"unclassified upstream error code … — status fallback" and fell through to
status-based classification, producing ``unknown``/``auth_failed`` for what is
in fact a daily free-tier quota suspension — transient and backoff-eligible.
"""

from __future__ import annotations

import httpx

from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter


def _status_error(status: int, body: str) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.reformboss.com/v1/chat/completions")
    response = httpx.Response(status, request=request, text=body)
    return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)


def _adapter() -> ConfigurableAdapter:
    return ConfigurableAdapter()


def test_free_limit_envelope_code_classifies_as_quota() -> None:
    """An envelope whose machine code mentions free_limit is a quota suspension."""
    body = (
        '{"error": {"code": "free_limit_exceeded", '
        '"message": "free_limit reached for the free tier today", '
        '"type": "new_api_error", "outcome": "not_executed"}}'
    )
    classified = _adapter().classify_error(_status_error(429, body))
    assert classified.category == "quota_exhausted"
    assert classified.scope == "account"
    # Backoff-eligible: parked until the daily reset, not dead.
    assert classified.retry_at is not None


def test_free_limit_message_marker_overrides_status_fallback() -> None:
    """Unknown/absent envelope code but an explicit free_limit marker in the message."""
    body = (
        '{"error": {"code": "user_request_limit", '
        '"message": "free_limit exhausted: free tier daily allowance used up"}}'
    )
    classified = _adapter().classify_error(_status_error(429, body))
    assert classified.category == "quota_exhausted"
    assert classified.retry_at is not None


def test_free_limit_spaced_marker_classifies_as_quota() -> None:
    """The spaced variant ``free limit`` is matched as conservatively."""
    body = '{"error": {"message": "Free limit for today has been used up"}}'
    classified = _adapter().classify_error(_status_error(403, body))
    assert classified.category == "quota_exhausted"


def test_unrelated_errors_are_not_captured() -> None:
    """A plain unknown body without the marker must stay unknown."""
    classified = _adapter().classify_error(
        _status_error(418, '{"error": {"code": "teapot", "message": "I am a teapot"}}'),
    )
    assert classified.category == "unknown"


def test_negated_free_limit_is_not_captured() -> None:
    """'There is no free limit' must never park an account group."""
    body = '{"error": {"message": "there is no free limit on this account"}}'
    classified = _adapter().classify_error(_status_error(403, body))
    assert classified.category != "quota_exhausted"


def test_free_limit_outside_error_message_is_not_captured() -> None:
    """Marker text outside the error envelope code/message must not match."""
    body = (
        '{"error": {"code": "teapot", "message": "I am a teapot"}, '
        '"warning": "free_limit policy does not apply here"}'
    )
    classified = _adapter().classify_error(_status_error(418, body))
    assert classified.category != "quota_exhausted"


def test_free_limitation_is_not_captured() -> None:
    """'free limitation' is not the free-tier-limit marker."""
    body = '{"error": {"message": "free limitation of liability applies"}}'
    classified = _adapter().classify_error(_status_error(403, body))
    assert classified.category != "quota_exhausted"


def test_carefree_limit_is_not_captured() -> None:
    """The marker must be a standalone token, not a substring of another word."""
    classified = _adapter().classify_error(
        _status_error(500, '{"error": {"message": "carefree limit reached internally"}}'),
    )
    assert classified.category != "quota_exhausted"


def test_free_limit_marker_in_plain_text_body_still_matches() -> None:
    """Non-JSON bodies keep the raw scan (ReformBoss observed shapes are JSON, but
    gateways sometimes answer plain text) — with the tightened token shape."""
    classified = _adapter().classify_error(_status_error(429, "free_limit exceeded for today"))
    assert classified.category == "quota_exhausted"
