"""Shared helpers for the AI Gateway provider adapters.

Currently houses ``_sanitize_error`` — extracted from ``configurable.py``
so the LiteLLM executor (which has no adapter in scope) can redact
secret-bearing URLs from error messages before they reach logs or metrics.
"""

from __future__ import annotations

import re


def _sanitize_error(exc: BaseException, secret: str) -> str:
    """Strip secrets from error messages before logging/storing.

    httpx errors include the full URL which may contain query-param
    secrets (e.g. Gemini's ``?key=...``).  This helper removes the
    secret from the error string to prevent leakage into logs or
    ``ProbeResult.error``.
    """
    msg = str(exc)
    if secret and secret in msg:
        msg = msg.replace(secret, "***REDACTED***")
    # Also strip any URL query params that look like secrets
    msg = re.sub(
        r"([?&])(key|api_key|apikey|token|secret)=([^&\s]+)",
        r"\1\2=***REDACTED***",
        msg,
        flags=re.IGNORECASE,
    )
    # Strip secrets leaked via Authorization / x-api-key headers (e.g. when
    # an httpx error echoes the request headers).
    msg = re.sub(
        r"(authorization\s*:\s*bearer\s+)([^\s,]+)",
        r"\1***REDACTED***",
        msg,
        flags=re.IGNORECASE,
    )
    msg = re.sub(
        r"(x-api-key\s*:\s*)([^\s,]+)",
        r"\1***REDACTED***",
        msg,
        flags=re.IGNORECASE,
    )
    return msg[:200]
