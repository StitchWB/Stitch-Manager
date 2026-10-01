"""Provider auth-flow session commands."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("provider_auth_flow_start")
async def cmd_provider_auth_flow_start(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    provider = params.get("provider", "")
    redirect_url = params.get("redirectUrl", params.get("callbackUrl", ""))
    flow_type = params.get("flowType", "oauth")

    auth_url = f"https://{provider}.example.com/oauth/authorize?redirect={redirect_url}"
    session = get_auth_flow_manager().create_session(
        provider=provider, auth_url=auth_url, state="pending", flow_type=flow_type,
    )
    return {
        "sessionId": session.session_id,
        "authUrl": session.auth_url,
        "state": session.state,
        "expiresAt": session.expires_at,
    }


@register_command("provider_auth_flow_status")
async def cmd_provider_auth_flow_status(params: dict) -> dict | None:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    session_id = params.get("sessionId", "")
    session = get_auth_flow_manager().get_session(session_id)
    if not session:
        return None
    return {
        "sessionId": session.session_id,
        "provider": session.provider,
        "phase": session.phase,
        "state": session.state,
        "authUrl": session.auth_url,
        "error": session.error,
        "flowType": session.flow_type,
    }


@register_command("provider_auth_flow_cancel")
async def cmd_provider_auth_flow_cancel(params: dict) -> bool:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    session_id = params.get("sessionId", "")
    return get_auth_flow_manager().remove_session(session_id)
