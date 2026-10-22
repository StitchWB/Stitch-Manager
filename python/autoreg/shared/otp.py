"""Shared OTP glue for registration providers (Zone-1 provider kit).

Distilled from the Wave-2 provider ports (apodex, notion, abliteration,
kauz, intern): strategy verifier first — ``verify(context=...)`` when an
EmailContext is available, else ``get_verification_code(...)`` — with the
IMAP-config helper as fallback and ``None`` when everything is absent.
Verifier failures degrade to the IMAP path instead of raising, so a
half-configured strategy never kills a registration run.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .email_verification import get_verification_code_from_imap

if TYPE_CHECKING:
    from collections.abc import Callable

    from autoreg.email_providers.base import EmailContext

logger = logging.getLogger(__name__)


def _log(log: Callable[[str], None] | None, message: str) -> None:
    if log is None:
        return
    try:
        log(message)
    except Exception:  # noqa: BLE001 - the kit must never raise
        logger.debug("otp log callback failed", exc_info=True)


def fetch_otp(
    strategy: Any,
    imap_config: dict[str, Any] | None,
    *,
    email: str,
    email_ctx: EmailContext | None = None,
    sender_keywords: list[str],
    max_wait: int = 120,
    code_pattern: str | None = None,
    subject_pattern: str | None = None,
    log: Callable[[str], None] | None = None,
) -> str | None:
    """Read the OTP through the strategy verifier, falling back to IMAP.

    Returns ``None`` when neither a verifier nor an IMAP config is
    available. Verifier exceptions are logged and degrade to the IMAP
    path; the function itself never raises.
    """
    verifier = getattr(strategy, "verifier", None) if strategy is not None else None
    if verifier is not None:
        try:
            if email_ctx is not None and hasattr(verifier, "verify"):
                return verifier.verify(
                    context=email_ctx,
                    sender_keywords=sender_keywords,
                    max_wait=max_wait,
                )
            kwargs: dict[str, Any] = {
                "target_email": email,
                "sender_keywords": sender_keywords,
                "max_wait": max_wait,
            }
            if code_pattern is not None:
                kwargs["code_pattern"] = code_pattern
            if subject_pattern is not None:
                kwargs["subject_pattern"] = subject_pattern
            return verifier.get_verification_code(**kwargs)
        except Exception as exc:  # noqa: BLE001 - fall through to IMAP config
            _log(log, f"email strategy verifier failed: {exc}")
    if imap_config:
        return get_verification_code_from_imap(
            imap_config=imap_config,
            sender_keywords=sender_keywords,
            subject_pattern=subject_pattern,
            max_wait=max_wait,
            target_email=email,
            code_pattern=code_pattern,
        )
    return None


def generate_email(
    strategy: Any, description: str
) -> tuple[EmailContext | None, str | None]:
    """Generate a mailbox through the strategy generator.

    Returns ``(email_ctx, email)``; ``(None, None)`` when the strategy or
    its generator is absent. Generator failures propagate — the caller's
    error handling decides how to report them.
    """
    generator = getattr(strategy, "generator", None) if strategy is not None else None
    if generator is None:
        return None, None
    email_ctx = generator.generate(description)
    return email_ctx, email_ctx.email


def cleanup_email(
    strategy: Any,
    email_ctx: EmailContext | None,
    log: Callable[[str], None] | None = None,
) -> None:
    """Best-effort alias cleanup for a generated mailbox; never raises."""
    if email_ctx is None or not email_ctx.should_cleanup:
        return
    generator = getattr(strategy, "generator", None) if strategy is not None else None
    if generator is None:
        return
    try:
        generator.cleanup(email_ctx)
    except Exception as exc:  # noqa: BLE001 - cleanup must not mask the error
        _log(log, f"email cleanup failed: {exc}")


__all__ = ["cleanup_email", "fetch_otp", "generate_email"]
