"""REST API for partner channels — ``/api/partners/*`` (Feature 1).

The admin CRUD endpoints proxy to the distribution server's
``/admin/partner-channels`` family (the browser can't hold the server admin
key — same proxy rationale as :mod:`plugin_distribution.admin_router`).

``GET /api/partners/me`` is owner-facing: resolves the caller's channel by
their bound Telegram id and adds local ``partner_members`` counts.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from stitch_backend.database import run_in_read_session
from stitch_backend.domains.auth.router import get_current_user, require_role
from stitch_backend.domains.plugin_distribution.admin_router import (
    _admin_key,
    _check_preconditions,
    _make_client,
    _map_network_error,
    _upstream_headers,
)
from stitch_backend.domains.plugin_distribution.config import (
    server_url,
    standalone_mode,
)

from .partner_service import count_partner_members

if TYPE_CHECKING:
    from stitch_backend.domains.auth.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/partners", tags=["Partners"])
admin_router = APIRouter(
    prefix="/partners/channels",
    tags=["Partners Admin"],
    dependencies=[Depends(require_role("admin"))],
)


def _map_upstream_status(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map an upstream non-2xx to a proxy error, passing 4xx details through."""
    upstream = exc.response.status_code
    if upstream == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Distribution server rejected the admin key",
        )
    if 400 <= upstream < 500:
        detail: Any = None
        try:
            detail = exc.response.json().get("detail")
        except ValueError:
            pass
        return HTTPException(
            status_code=upstream,
            detail=detail or f"Distribution server error: {upstream}",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Distribution server error: {upstream}",
    )


async def _proxy(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> Any:
    """Call the distribution server admin API and return the parsed body."""
    pre = _check_preconditions()
    if pre is not None:
        raise pre
    url = f"{server_url()}{path}"
    async with _make_client() as client:
        try:
            resp = await client.request(
                method, url, json=json_body, params=params, headers=_upstream_headers()
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_status(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc
    return resp.json()


@admin_router.get("")
async def list_channels(owner_tg_id: int | None = Query(default=None)) -> Any:
    """GET /api/partners/channels — proxy to ``GET /admin/partner-channels``."""
    params = {"owner_tg_id": owner_tg_id} if owner_tg_id is not None else None
    return await _proxy("GET", "/admin/partner-channels", params=params)


@admin_router.post("")
async def create_channel(body: dict[str, Any]) -> Any:
    """POST /api/partners/channels — proxy to ``POST /admin/partner-channels``."""
    return await _proxy("POST", "/admin/partner-channels", json_body=body)


@admin_router.put("/{channel_id}")
async def update_channel(channel_id: str, body: dict[str, Any]) -> Any:
    """PUT /api/partners/channels/{id} — proxy to ``PUT /admin/partner-channels/{id}``."""
    return await _proxy("PUT", f"/admin/partner-channels/{channel_id}", json_body=body)


@admin_router.delete("/{channel_id}")
async def delete_channel(channel_id: str) -> Any:
    """DELETE /api/partners/channels/{id} — proxy to ``DELETE /admin/partner-channels/{id}``."""
    return await _proxy("DELETE", f"/admin/partner-channels/{channel_id}")


@router.get("/me")
async def partners_me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    """The caller's owned partner channel + local member stats.

    Returns ``{"channel": None, ...}`` when the user has no bound Telegram
    id, owns no channel, or the server is unreachable — the Friends page
    probes this for every user, so absence is not an error.
    """
    empty: dict[str, Any] = {"channel": None, "member_count": 0, "quota_left": None}
    if user.telegram_id is None or standalone_mode() or not _admin_key():
        return empty

    url = f"{server_url()}/admin/partner-channels"
    async with _make_client() as client:
        try:
            resp = await client.get(
                url,
                params={"owner_tg_id": user.telegram_id},
                headers=_upstream_headers(),
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Partner /me lookup failed: %s", exc)
            return empty

    channels = resp.json().get("channels", [])
    channel = channels[0] if channels else None
    if not isinstance(channel, dict):
        return empty

    channel_id = str(channel["id"])
    member_count = await run_in_read_session(
        lambda db: count_partner_members(db, channel_id)
    )
    max_members = channel.get("max_members")
    quota_left = (max_members - member_count) if isinstance(max_members, int) else None
    return {
        "channel": channel,
        "member_count": member_count,
        "quota_left": quota_left,
    }
