"""Google Sheets OAuth command handlers — registered via ``@register_command``.

Commands:
    - start_google_oauth          → {authUrl, state, port}
    - handle_google_oauth_callback → {success, email}
    - check_google_oauth_callback  → {received, success, email}
    - disconnect_google_oauth     → {success}
    - get_google_oauth_status      → {connected, email}
"""

from __future__ import annotations

import logging

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.google_sheets.oauth_service import get_oauth_service

logger = logging.getLogger(__name__)


@register_command("start_google_oauth")
async def cmd_start_google_oauth(params: dict) -> dict:
    """Start a Google OAuth PKCE flow — returns the authorization URL."""
    svc = get_oauth_service()
    return await svc.start_oauth_flow()


@register_command("handle_google_oauth_callback")
async def cmd_handle_google_oauth_callback(params: dict) -> dict:
    """Exchange the OAuth callback code for tokens and persist them.

    params: {code: str, state: str}
    """
    code = str(params.get("code", ""))
    state = str(params.get("state", ""))
    if not code or not state:
        return {"success": False, "error": "code and state are required"}

    svc = get_oauth_service()
    return await svc.handle_callback(code, state)


@register_command("check_google_oauth_callback")
async def cmd_check_google_oauth_callback(params: dict) -> dict:
    """Check if loopback server received OAuth callback.

    params: {state: str}
    Returns: {received: bool, success: bool, email: str | None}
    """
    state = str(params.get("state", ""))
    if not state:
        return {"received": False, "success": False, "email": None, "error": "state is required"}

    svc = get_oauth_service()
    return await svc.check_loopback_callback(state)


@register_command("disconnect_google_oauth")
async def cmd_disconnect_google_oauth(params: dict) -> dict:
    """Remove all stored Google OAuth tokens."""
    svc = get_oauth_service()
    return await svc.disconnect()


@register_command("get_google_oauth_status")
async def cmd_get_google_oauth_status(params: dict) -> dict:
    """Return {connected: bool, email: str | null}."""
    svc = get_oauth_service()
    return await svc.get_status()
