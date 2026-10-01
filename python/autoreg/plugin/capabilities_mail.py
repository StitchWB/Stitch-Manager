"""imap.otp capability for StepKind v2 (plan §4.3)."""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable
from typing import Any

from ..scenario.schema import ScenarioStep
from ..stitch_backend_bridge import resolve_email_verification
from .capabilities_base import StepResult

logger = logging.getLogger(__name__)


def imap_otp_capability(
    step: ScenarioStep,
    imap_config: dict[str, Any] | None,
    imap_factory: Callable[[dict[str, Any]], Any] | None,
    store: dict[str, Any],
) -> StepResult:
    """Poll IMAP for a verification code via SPI (plan §4.3 imap.otp).

    Routes through the ``EmailVerificationProvider`` SPI — the built-in
    impl uses raw-IMAP polling (moved to ``core/spi_builtin_email.py``);
    a plugin impl overrides with its own ``wait_otp``.
    """
    meta = step.meta or {}
    to_key = meta.get("to", "otp.code")
    subject_patterns = [
        p
        for p in (
            meta.get("subject_pattern", ""),
            meta.get("subject_pattern_fallback", ""),
        )
        if p
    ]
    body_regex = meta.get("body_regex", r"\b(\d{6})\b")
    recency_s = int(meta.get("recency_s", 600))
    poll_interval_s = float(meta.get("poll_interval_s", 5))
    timeout_s = int(meta.get("timeout_s", 120))
    code_source = meta.get("code_source", "body")
    subject_code_regex = meta.get("subject_code_regex", "")

    if not imap_config:
        return StepResult(
            step.id, step.kind, False, error="imap.otp: no imap_config provided"
        )

    impl = resolve_email_verification()

    email_addr = imap_config.get("user", "")
    subject_filter = subject_patterns[0] if subject_patterns else ""

    extra_kwargs: dict[str, Any] = {
        "imap_config": imap_config,
        "imap_factory": imap_factory,
        "subject_patterns": subject_patterns,
        "body_regex": body_regex,
        "recency_s": recency_s,
        "poll_interval_s": poll_interval_s,
        "code_source": code_source,
        "subject_code_regex": subject_code_regex,
    }

    # Check if impl.wait_otp accepts **kwargs (built-in does; plugin may not)
    try:
        sig = inspect.signature(impl.wait_otp)
        accepts_kwargs = any(
            p.kind == inspect.Parameter.VAR_KEYWORD
            for p in sig.parameters.values()
        )
    except (ValueError, TypeError):
        accepts_kwargs = False

    call_kwargs = extra_kwargs if accepts_kwargs else {}

    try:
        code = asyncio.run(impl.wait_otp(
            email=email_addr,
            subject_filter=subject_filter,
            code_pattern=body_regex,
            timeout=timeout_s,
            **call_kwargs,
        ))
        if code:
            store[to_key] = code
            return StepResult(step.id, step.kind, True, meta={"to": to_key})
    except Exception as e:  # noqa: BLE001
        logger.debug("imap.otp SPI error: %s", e)

    return StepResult(
        step.id, step.kind, False,
        error="imap.otp: no verification code received within timeout",
    )
