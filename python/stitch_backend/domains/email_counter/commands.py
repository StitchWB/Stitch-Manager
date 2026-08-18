"""Email counter command handlers.

6 commands: get, set, reset, increment, diagnostics, test_email_generation.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session


@register_command("get_email_counter", readonly=True)
async def cmd_get_email_counter(params: dict) -> int:
    """Return counter for a provider + strategy pair."""
    from stitch_backend.domains.email_counter.service import EmailCounterService

    provider = (params.get("provider") or "").strip()
    strategy = (params.get("strategy") or "").strip()
    if not provider or not strategy:
        return 0

    async def _op(session):
        svc = EmailCounterService(session)
        return await svc.get_counter(provider, strategy)

    return await run_in_read_session(_op)


@register_command("set_email_counter")
async def cmd_set_email_counter(params: dict) -> dict:
    """Set counter to a specific value."""
    from stitch_backend.domains.email_counter.service import EmailCounterService

    provider = (params.get("provider") or "").strip()
    strategy = (params.get("strategy") or "").strip()
    counter = int(params.get("counter", 0))
    if not provider or not strategy:
        return {"success": False, "error": "provider and strategy required"}

    async def _op(session):
        svc = EmailCounterService(session)
        await svc.set_counter(provider, strategy, counter)
        return {"success": True}

    return await run_in_session(_op)


@register_command("reset_email_counter")
async def cmd_reset_email_counter(params: dict) -> dict:
    """Reset counter to 0."""
    from stitch_backend.domains.email_counter.service import EmailCounterService

    provider = (params.get("provider") or "").strip()
    strategy = (params.get("strategy") or "").strip()
    if not provider or not strategy:
        return {"success": False, "error": "provider and strategy required"}

    async def _op(session):
        svc = EmailCounterService(session)
        await svc.reset_counter(provider, strategy)
        return {"success": True}

    return await run_in_session(_op)


@register_command("increment_email_counter")
async def cmd_increment_email_counter(params: dict) -> int:
    """Increment and return new counter value."""
    from stitch_backend.domains.email_counter.service import EmailCounterService

    provider = (params.get("provider") or "").strip()
    strategy = (params.get("strategy") or "").strip()
    if not provider or not strategy:
        return 0

    async def _op(session):
        svc = EmailCounterService(session)
        return await svc.increment_counter(provider, strategy)

    return await run_in_session(_op)


@register_command("get_email_counter_diagnostics", readonly=True)
async def cmd_get_email_counter_diagnostics(params: dict) -> dict:
    """Return comprehensive email counter diagnostics."""
    from stitch_backend.domains.email_counter.service import EmailCounterService

    async def _op(session):
        svc = EmailCounterService(session)
        return await svc.get_diagnostics()

    return await run_in_read_session(_op)


@register_command("test_email_generation", readonly=True)
async def cmd_test_email_generation(params: dict) -> dict:
    """Test email generation without persisting state changes.

    Simplified port of the Rust test_email_generation command.
    The full Rust implementation uses PersistentEmailGenerator which
    requires complex strategy resolution.  Here we provide the
    counter-level preview.
    """
    from stitch_backend.domains.email_counter.service import EmailCounterService

    provider = (params.get("provider") or "").strip()
    if not provider:
        return {"success": False, "error": "provider required"}

    async def _op(session):
        svc = EmailCounterService(session)

        # Get current strategy
        try:
            from sqlalchemy import text
            result = await session.execute(
                text("SELECT value FROM settings WHERE key = 'email_strategy'")
            )
            row = result.first()
            strategy = row[0] if row else "plus_alias"
        except Exception:
            strategy = "plus_alias"

        counter_before = await svc.get_counter(provider, strategy)

        return {
            "success": True,
            "provider": provider,
            "strategy": strategy,
            "counterBefore": counter_before,
        }

    return await run_in_read_session(_op)
