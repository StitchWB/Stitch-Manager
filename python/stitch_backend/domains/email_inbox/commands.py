"""Email Inbox command handlers — 15 commands.

Ported from Rust ``commands/email_inbox.rs``.
Session commands delegate to ``service`` module-level functions.
DB commands use ``run_in_session`` pattern.
"""

from __future__ import annotations

import asyncio

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session

# ── Session commands (8) ──────────────────────────────────────────────────────

@register_command("email_inbox_connect")
async def cmd_connect(params: dict) -> dict:
    """Connect to a mailbox."""
    from stitch_backend.domains.email_inbox import service
    input_data = params.get("input", params)
    # Thread caller's owner_id for per-user IMAP password resolution.
    if "_caller_user_id" in params:
        input_data = {**input_data, "owner_id": params.get("_caller_user_id")}
    return await service.connect(input_data)


@register_command("email_inbox_disconnect")
async def cmd_disconnect(params: dict) -> dict:
    """Disconnect a session."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    await service.disconnect(session_id)
    return {"success": True}


@register_command("email_inbox_list")
async def cmd_list(params: dict) -> list:
    """List messages in a mailbox."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    query = params.get("query")
    return await service.list_messages(session_id, query)


@register_command("email_inbox_list_folders")
async def cmd_list_folders(params: dict) -> list:
    """List mailbox folders."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    return await service.list_folders(session_id)


@register_command("email_inbox_get_by_id")
async def cmd_get_by_id(params: dict) -> dict | None:
    """Fetch a single message by ID."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    message_id = params.get("messageId", params.get("message_id", ""))
    return await service.get_by_id(session_id, message_id)


@register_command("email_inbox_wait_for_email")
async def cmd_wait_for_email(params: dict) -> dict:
    """Poll for an email matching criteria."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    query = params.get("query", {})
    options = params.get("options")
    return await service.wait_for_email(session_id, query, options)


@register_command("email_inbox_mark_as_read")
async def cmd_mark_as_read(params: dict) -> dict:
    """Mark a message as read."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    message_id = params.get("messageId", params.get("message_id", ""))
    await service.mark_as_read(session_id, message_id)
    return {"success": True}


@register_command("email_inbox_delete")
async def cmd_delete(params: dict) -> dict:
    """Delete a message."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    message_id = params.get("messageId", params.get("message_id", ""))
    await service.delete_message(session_id, message_id)
    return {"success": True}


# ── Capability / catalog commands (2) ─────────────────────────────────────────

@register_command("email_inbox_create_mailtm_account")
async def cmd_create_mailtm_account(params: dict) -> dict:
    """Create a random Mail.tm account and return its credentials."""
    from stitch_backend.domains.email_inbox import mailtm_provider
    base_url = params.get("baseUrl") or params.get("base_url") or None
    return await asyncio.to_thread(mailtm_provider.create_random_account, base_url)


@register_command("email_inbox_get_capabilities")
async def cmd_get_capabilities(params: dict) -> dict:
    """Get provider capabilities for a session."""
    from stitch_backend.domains.email_inbox import service
    session_id = params.get("sessionId", params.get("session_id", ""))
    return service.get_capabilities(session_id)


@register_command("email_inbox_get_provider_catalog")
async def cmd_get_provider_catalog(params: dict) -> list:
    """Get available email providers."""
    from stitch_backend.domains.email_inbox import service
    return service.get_provider_catalog()


# ── Profile commands (5) ─────────────────────────────────────────────────────

@register_command("email_inbox_list_profiles", readonly=True)
async def cmd_list_profiles(params: dict) -> list:
    """List saved inbox profiles."""
    from stitch_backend.domains.email_inbox import service
    owner_id = params.get("_caller_user_id")

    async def _op(db):
        return await service.list_profiles(db, owner_id=owner_id)

    return await run_in_read_session(_op)


@register_command("email_inbox_get_profile", readonly=True)
async def cmd_get_profile(params: dict) -> dict | None:
    """Get a profile by ID."""
    from stitch_backend.domains.email_inbox import service
    profile_id = params.get("profileId", params.get("profile_id", ""))
    owner_id = params.get("_caller_user_id")

    async def _op(db):
        return await service.get_profile(db, profile_id, owner_id=owner_id)

    return await run_in_read_session(_op)


@register_command("email_inbox_upsert_profile")
async def cmd_upsert_profile(params: dict) -> dict:
    """Create or update an inbox profile."""
    from stitch_backend.domains.email_inbox import service
    input_data = params.get("input", params)
    owner_id = params.get("_caller_user_id")

    async def _op(db):
        return await service.upsert_profile(db, input_data, owner_id=owner_id)

    return await run_in_session(_op)


@register_command("email_inbox_delete_profile")
async def cmd_delete_profile(params: dict) -> bool:
    """Delete an inbox profile."""
    from stitch_backend.domains.email_inbox import service
    profile_id = params.get("profileId", params.get("profile_id", ""))
    owner_id = params.get("_caller_user_id")

    async def _op(db):
        return await service.delete_profile(db, profile_id, owner_id=owner_id)

    return await run_in_session(_op)


@register_command("email_inbox_connect_profile", readonly=True)
async def cmd_connect_profile(params: dict) -> dict:
    """Connect using a saved profile."""
    from stitch_backend.domains.email_inbox import service
    profile_id = params.get("profileId", params.get("profile_id", ""))
    owner_id = params.get("_caller_user_id")

    async def _op(db):
        return await service.connect_profile(db, profile_id, owner_id=owner_id)

    return await run_in_read_session(_op)


# ── Sync state commands (2) ──────────────────────────────────────────────────

@register_command("email_inbox_get_sync_state", readonly=True)
async def cmd_get_sync_state(params: dict) -> dict | None:
    """Get sync state for a profile."""
    from stitch_backend.domains.email_inbox import service
    profile_id = params.get("profileId", params.get("profile_id", ""))

    async def _op(db):
        return await service.get_sync_state(db, profile_id)

    return await run_in_read_session(_op)


@register_command("email_inbox_upsert_sync_state")
async def cmd_upsert_sync_state(params: dict) -> dict:
    """Create or update sync state."""
    from stitch_backend.domains.email_inbox import service
    input_data = params.get("input", params)

    async def _op(db):
        return await service.upsert_sync_state(db, input_data)

    return await run_in_session(_op)
