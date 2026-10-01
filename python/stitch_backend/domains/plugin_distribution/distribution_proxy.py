"""Raw distribution-server passthrough on the web app.

The desktop backend and other clients call ``{server_url()}/<raw path>`` on
the public origin.  The edge (Cloudflare tunnel ingress / nginx site config)
routes an allowlist of raw prefixes to the distribution server; everything
else falls through to this app (the SPA catch-all) and dies with 404/405.
The allowlist drifts from the server routers over time, so this app also
forwards the raw client-facing paths verbatim (status + body): the flow
keeps working regardless of edge allowlist state.  ``stitch_server`` keeps
serving the same paths directly for in-network callers.

Forwarded set (client-called on the public origin):
  - ``/deeplink/start|status|exchange`` — deep-link login (public upstream)
  - ``/partner-channels``               — public channel list
  - ``/rights``                         — Bearer-protected upstream; the
    caller's ``Authorization`` header is forwarded verbatim

No auth and no admin key here: upstream enforces its own contract
(public + rate-limited, or Bearer) and its details are client-facing.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Header, HTTPException, Response, status

from stitch_backend.domains.plugin_distribution.config import (
    server_url,
    standalone_mode,
)

router = APIRouter(tags=["Distribution proxy"])

_UPSTREAM_TIMEOUT = 30.0


async def _forward(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    body: dict | None = None,
    authorization: str | None = None,
) -> Response:
    if standalone_mode():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Distribution server disabled",
        )
    headers = {"Authorization": authorization} if authorization else None
    try:
        async with httpx.AsyncClient(timeout=_UPSTREAM_TIMEOUT) as client:
            resp = await client.request(
                method,
                f"{server_url()}{path}",
                params=params,
                json=body,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Distribution server unreachable",
        ) from exc
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
    )


@router.post("/deeplink/start")
async def deeplink_start() -> Response:
    """Passthrough of ``POST {server}/deeplink/start``."""
    return await _forward("POST", "/deeplink/start")


@router.get("/deeplink/status")
async def deeplink_status(token: str) -> Response:
    """Passthrough of ``GET {server}/deeplink/status?token=...``."""
    return await _forward("GET", "/deeplink/status", params={"token": token})


@router.post("/deeplink/exchange")
async def deeplink_exchange(body: dict) -> Response:
    """Passthrough of ``POST {server}/deeplink/exchange``."""
    return await _forward("POST", "/deeplink/exchange", body=body)


@router.get("/partner-channels")
async def partner_channels() -> Response:
    """Passthrough of ``GET {server}/partner-channels`` (public upstream)."""
    return await _forward("GET", "/partner-channels")


@router.get("/rights")
async def rights(authorization: str | None = Header(default=None)) -> Response:
    """Passthrough of ``GET {server}/rights`` (Bearer enforced upstream)."""
    return await _forward("GET", "/rights", authorization=authorization)
