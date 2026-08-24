"""Admin proxy router for the distribution server's activation-code endpoints.

Mounted under ``/api/dist/*`` (via :mod:`stitch_backend.api.router`).  All
endpoints are admin-only (``Depends(require_role("admin"))``) and proxy to
the distribution server's ``/admin/codes`` family of endpoints.

The browser can't hold the distribution-server admin key — that's why this
proxy exists.  The admin key is read from ``STITCH_ADMIN_KEY`` (same env-var
convention as :mod:`stitch_backend.domains.plugin_distribution.config`),
sent upstream as ``X-Admin-Key``.

Error mapping contract:
  - ``STITCH_SERVER_URL`` empty (standalone mode) → 503
    "Distribution server disabled"
  - ``STITCH_ADMIN_KEY`` unset → 503
    "Distribution admin key not configured"
  - upstream 401 → 502 "Distribution server rejected the admin key"
  - network error → 502 "Distribution server unreachable"
  - upstream 404/409 → pass the same status code through with the
    upstream detail
"""

from __future__ import annotations

import logging
import os
from typing import Any, cast

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.auth.router import require_role
from stitch_backend.domains.plugin_distribution.config import server_url, standalone_mode

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/dist",
    tags=["Distribution Admin"],
    dependencies=[Depends(require_role("admin"))],
)

#: Timeout for upstream calls (seconds).  Matches the activation client.
_UPSTREAM_TIMEOUT = 30.0

#: Header name carrying the distribution admin key.
_ADMIN_KEY_HEADER = "X-Admin-Key"


# ── Schemas ───────────────────────────────────────────────────────────────────


class DistCodeInfo(BaseModel):
    """A single activation code as the distribution server returns it."""

    id: int
    code_hash_prefix: str
    entitlements: list[str] = Field(default_factory=list)
    used: bool
    used_at: str | None = None
    token_id: int | None = None
    created_at: str
    expires_at: str | None = None
    revoked: bool
    tg_user_id: int | None = None
    label: str | None = None


class DistCodesResponse(BaseModel):
    codes: list[DistCodeInfo]


class DistIssueRequest(BaseModel):
    """Body for POST /api/dist/issue-code."""

    entitlements: list[str] | None = None
    count: int | None = Field(default=None, ge=1, le=100)
    ttl_minutes: int | None = Field(default=None, ge=0)
    label: str | None = None


class DistIssueResponse(BaseModel):
    codes: list[str]
    entitlements: list[str] = Field(default_factory=list)


class DistRevokeRequest(BaseModel):
    """Body for POST /api/dist/revoke-code."""

    code_id: int


class DistRevokeResponse(BaseModel):
    code_id: int
    revoked: bool


# ── Upstream client factory ───────────────────────────────────────────────────


def _admin_key() -> str:
    """Return the distribution admin key from the environment (or "")."""
    return os.environ.get("STITCH_ADMIN_KEY", "")


def _make_client() -> httpx.AsyncClient:
    """Build a fresh httpx.AsyncClient with the standard upstream timeout.

    A new client per request keeps the proxy stateless — no connection
    pool to drain, no base_url to clash with the test transport.
    """
    return httpx.AsyncClient(timeout=_UPSTREAM_TIMEOUT)


def _upstream_headers() -> dict[str, str]:
    """Build the headers for an upstream admin call."""
    return {
        _ADMIN_KEY_HEADER: _admin_key(),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


# ── Error mapping ─────────────────────────────────────────────────────────────


def _check_preconditions() -> HTTPException | None:
    """Return an HTTPException when the proxy can't reach upstream.

    Checked in order:
      1. Standalone mode (``STITCH_SERVER_URL=""``) → 503 disabled.
      2. Admin key unset → 503 not configured.
    """
    if standalone_mode():
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Distribution server disabled",
        )
    if not _admin_key():
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Distribution admin key not configured",
        )
    return None


def _map_upstream_error(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map an upstream non-2xx response to a proxy HTTPException.

    - 401 → 502 "Distribution server rejected the admin key"
    - 404/409 → same status code with a FIXED detail (raw upstream detail
      is never forwarded to the browser — no internal-state leakage)
    - other 4xx/5xx → 502 with a generic detail
    """
    upstream_status = exc.response.status_code

    if upstream_status == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Distribution server rejected the admin key",
        )
    if upstream_status == status.HTTP_404_NOT_FOUND:
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Code not found"
        )
    if upstream_status == status.HTTP_409_CONFLICT:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Code already used"
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Distribution server error: {upstream_status}",
    )


def _map_network_error(exc: Exception) -> HTTPException:
    """Map a transport-level error to a 502."""
    logger.warning("Distribution server unreachable: %s", exc)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Distribution server unreachable",
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/codes", response_model=DistCodesResponse)
async def list_codes(unused_only: bool = Query(default=False)) -> DistCodesResponse:
    """GET /api/dist/codes — proxy to upstream ``GET /admin/codes``.

    Query param ``unused_only`` is forwarded; the upstream returns
    ``{codes: [...]}``.
    """
    pre = _check_preconditions()
    if pre is not None:
        raise pre

    url = f"{server_url()}/admin/codes"
    params = {"unused_only": "true" if unused_only else "false"}
    async with _make_client() as client:
        try:
            resp = await client.get(url, params=params, headers=_upstream_headers())
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc

    body = resp.json()
    return DistCodesResponse(codes=body.get("codes", []))


@router.post("/issue-code", response_model=DistIssueResponse)
async def issue_code(body: DistIssueRequest) -> DistIssueResponse:
    """POST /api/dist/issue-code — proxy to upstream ``POST /admin/issue-code``.

    Forwards ``entitlements``, ``count``, ``ttl_minutes``, ``label`` as given.
    """
    pre = _check_preconditions()
    if pre is not None:
        raise pre

    url = f"{server_url()}/admin/issue-code"
    payload: dict[str, Any] = {}
    if body.entitlements is not None:
        payload["entitlements"] = body.entitlements
    if body.count is not None:
        payload["count"] = body.count
    if body.ttl_minutes is not None:
        payload["ttl_minutes"] = body.ttl_minutes
    if body.label is not None:
        payload["label"] = body.label

    async with _make_client() as client:
        try:
            resp = await client.post(url, json=payload, headers=_upstream_headers())
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc

    body_json = resp.json()
    return DistIssueResponse(
        codes=list(body_json.get("codes", [])),
        entitlements=list(body_json.get("entitlements", [])),
    )


@router.post("/revoke-code", response_model=DistRevokeResponse)
async def revoke_code(body: DistRevokeRequest) -> DistRevokeResponse:
    """POST /api/dist/revoke-code — proxy to upstream ``POST /admin/revoke-code``.

    Forwards ``{code_id: int}``.  Upstream 404 (unknown code) and 409
    (already used) are passed through with the same status code.
    """
    pre = _check_preconditions()
    if pre is not None:
        raise pre

    url = f"{server_url()}/admin/revoke-code"
    payload = {"code_id": body.code_id}
    async with _make_client() as client:
        try:
            resp = await client.post(url, json=payload, headers=_upstream_headers())
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc

    body_json = resp.json()
    return DistRevokeResponse(
        code_id=body_json.get("code_id", body.code_id),
        revoked=bool(body_json.get("revoked", False)),
    )


@router.get("/monitoring")
async def get_monitoring() -> dict[str, Any]:
    """GET /api/dist/monitoring — proxy to upstream ``GET /admin/monitoring``.

    Returns the distribution server's aggregated health snapshot (services,
    bot heartbeat, TG proxy liveness) verbatim for the admin Monitoring page.
    """
    pre = _check_preconditions()
    if pre is not None:
        raise pre

    url = f"{server_url()}/admin/monitoring"
    async with _make_client() as client:
        try:
            resp = await client.get(url, headers=_upstream_headers())
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc

    return cast("dict[str, Any]", resp.json())


@register_command("ack_monitoring_alerts")
async def cmd_ack_monitoring_alerts(params: dict) -> dict:
    """Silence monitoring alerts for ``hours`` (admin-only dispatcher command).

    Params: ``{hours: float}`` (default 1). Proxies to upstream
    ``POST /admin/alerts/ack``.
    """
    pre = _check_preconditions()
    if pre is not None:
        raise pre

    hours = float(params.get("hours", 1) or 1)
    url = f"{server_url()}/admin/alerts/ack"
    async with _make_client() as client:
        try:
            resp = await client.post(
                url, json={"hours": hours}, headers=_upstream_headers()
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _map_upstream_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_network_error(exc) from exc

    return cast("dict[Any, Any]", resp.json())
