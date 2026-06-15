"""OAuth domain command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("start_oauth_pkce")
async def cmd_start_oauth_pkce(params: dict) -> dict:
    """Start a PKCE OAuth flow — returns the authorization URL."""
    from stitch_backend.domains.oauth.pkce import PKCEFlow

    flow = PKCEFlow(
        authorize_url=params.get("authorizeUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
        redirect_uri=params.get("redirectUri", "http://localhost:25584/api/oauth/callback"),
        scope=params.get("scope", "openid profile email"),
    )
    auth_url = flow.get_authorization_url(state=params.get("state"))
    return {"authorizationUrl": auth_url, "codeVerifier": flow.code_verifier}


@register_command("exchange_oauth_code")
async def cmd_exchange_oauth_code(params: dict) -> dict:
    """Exchange an authorization code for tokens."""
    from stitch_backend.domains.oauth.pkce import PKCEFlow

    flow = PKCEFlow(
        authorize_url=params.get("authorizeUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
    )
    flow.code_verifier = params.get("codeVerifier", "")
    tokens = await flow.exchange_code(params.get("code", ""))
    return tokens


@register_command("start_device_flow")
async def cmd_start_device_flow(params: dict) -> dict:
    """Start a device authorization flow."""
    from stitch_backend.domains.oauth.device_flow import DeviceFlow

    flow = DeviceFlow(
        device_auth_url=params.get("deviceAuthUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
        scope=params.get("scope", ""),
    )
    device_data = await flow.request_device_code()
    return {
        "userCode": device_data.get("user_code"),
        "verificationUri": device_data.get("verification_uri"),
        "deviceCode": device_data.get("device_code"),
        "expiresIn": device_data.get("expires_in", 900),
        "interval": device_data.get("interval", 5),
    }
