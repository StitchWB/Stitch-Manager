"""Enterprise profile ARN fetching via CodeWhisperer ListAvailableProfiles API.

Reference: kiroApi.ts fetchEnterpriseProfileArn (~2256).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.upstream.models import ProxyAccount


def _get_codewhisperer_endpoint(region: str | None) -> str:
    if region and region.startswith("eu-"):
        return "https://codewhisperer.eu-central-1.amazonaws.com"
    return "https://codewhisperer.us-east-1.amazonaws.com"


def _region_fallback_arn(region: str | None) -> str:
    r = region or "us-east-1"
    return f"arn:aws:codewhisperer:{r}:610548660232:profile/VNECVYCYYAWN"


def _make_headers(account: ProxyAccount) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {account['accessToken']}",
        "x-amz-user-agent": "aws-sdk-js/1.0.34 KiroIDE 0.12.155",
        "user-agent": (
            "aws-sdk-js/1.0.34 ua/2.1 os/win32#10.0.19043 "
            "lang/js md/nodejs#22.22.0 api/codewhispererstreaming#"
            "1.0.34 m/E KiroIDE-0.12.155"
        ),
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "amz-sdk-request": "attempt=1; max=1",
    }


async def fetch_enterprise_profile_arn(
    account: ProxyAccount,
    client: httpx.AsyncClient | None = None,
) -> str | None:
    """Fetch enterprise profile ARN via POST ListAvailableProfiles.

    Returns the first profile ARN or a region-aware fallback on 403.
    """
    base_url = _get_codewhisperer_endpoint(account.get("region"))
    url = f"{base_url}/ListAvailableProfiles"
    headers = _make_headers(account)
    fallback = _region_fallback_arn(account.get("region"))

    if client is None:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        proxy_url = _get_outbound_proxy()
        resolved_client = httpx.AsyncClient(proxy=proxy_url)
    else:
        resolved_client = client

    async def _do_request() -> str | None:
        try:
            resp = await resolved_client.post(url, headers=headers, json={})
            if resp.status_code == 403:
                return fallback
            if not resp.is_success:
                return None
            data = resp.json()
            profiles = data.get("profiles") or []
            if profiles:
                return profiles[0].get("arn") or None
            return None
        finally:
            if client is None:
                await resolved_client.aclose()

    return await _do_request()
