"""Admin endpoints — protected by X-Admin-Key header.

  POST   /admin/issue-code    — issue a one-time activation code
  GET    /admin/codes         — list all activation codes
  POST   /admin/revoke-code   — revoke an unused activation code
  POST   /admin/publish        — upload plugin zip + manifest update
  POST   /admin/deprecate      — kill-switch (manifest deprecated list)
  POST   /admin/revoke         — revoke a token
  PATCH  /admin/device-limit   — update global device limit

Stage → canary → full is controlled by ``rollout_percent``
(0 = staged, 10 = canary, 100 = full). The manifest exposes the number;
cohort selection is CLIENT-side.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import hash_code, require_admin
from stitch_server.config import get_settings
from stitch_server.db import get_db
from stitch_server.models import (
    ActivationCode,
    Deprecation,
    Plugin,
    PluginVariant,
    PluginVersion,
    ServerSetting,
    Token,
)
from stitch_server.timeutils import as_utc

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


# ── Identifier validation (path-traversal guard, plan §3.2 item 9) ────────────

# plugin_id and version are interpolated into filesystem paths
# (``plugins_dir / f"{plugin_id}-{version}.zip"``); reject anything that is
# not a safe dotted identifier to prevent traversal/escape.
_IDENTIFIER_RE: re.Pattern[str] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _validate_identifier(value: str, label: str) -> None:
    """Raise HTTPException(400) if ``value`` is not a safe identifier.

    Used for ``plugin_id`` and ``version`` Form fields that are interpolated
    into filesystem paths.  Mirrors the token convention: never trust raw
    user input past the boundary.
    """
    if not value or not _IDENTIFIER_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must match ^[A-Za-z0-9][A-Za-z0-9._-]*$",
        )


# ── Publish ────────────────────────────────────────────────────────────────────

class PublishResponse(BaseModel):
    plugin_id: str
    version: str
    rollout_percent: int
    stored: bool


@router.post("/publish", response_model=PublishResponse)
async def publish(
    plugin_id: Annotated[str, Form()],
    version: Annotated[str, Form()],
    package: Annotated[UploadFile, File()],
    package_sha256: Annotated[str, Form()],
    package_signature: Annotated[str | None, Form()] = None,
    manifest_signature: Annotated[str | None, Form()] = None,
    rollout_percent: Annotated[int, Form()] = 0,
    variant_index: Annotated[int | None, Form()] = None,
    db: AsyncSession = Depends(get_db),
) -> PublishResponse:
    _validate_identifier(plugin_id, "plugin_id")
    _validate_identifier(version, "version")
    if variant_index is not None and (variant_index < 0 or variant_index > 999):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="variant_index must be between 0 and 999",
        )

    data = await package.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty package")

    actual_sha = hashlib.sha256(data).hexdigest()
    if actual_sha != package_sha256.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Package sha256 mismatch: expected {package_sha256}, got {actual_sha}",
        )

    plugins_dir = get_settings().plugins_path
    plugins_dir.mkdir(parents=True, exist_ok=True)

    result = await db.execute(select(Plugin).where(Plugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if plugin is None:
        plugin = Plugin(id=plugin_id, name=plugin_id)
        db.add(plugin)
        await db.flush()
    plugin.current_version = version

    pv_result = await db.execute(
        select(PluginVersion).where(
            PluginVersion.plugin_id == plugin_id,
            PluginVersion.version == version,
        )
    )
    pv = pv_result.scalar_one_or_none()
    if pv is None:
        pv = PluginVersion(
            plugin_id=plugin_id,
            version=version,
            rollout_percent=rollout_percent,
            package_path="",  # set below
            package_sha256=actual_sha,
            package_signature=package_signature,
        )
        db.add(pv)
        await db.flush()
    else:
        pv.rollout_percent = rollout_percent
        pv.package_signature = package_signature

    if variant_index is not None:
        # Watermarked variant: store as a PluginVariant row.
        # The variant zip is named with the idx suffix to avoid overwriting
        # the legacy package or other variants.
        pkg_path = plugins_dir / f"{plugin_id}-{version}-v{variant_index}.zip"
        pkg_path.write_bytes(data)

        var_result = await db.execute(
            select(PluginVariant).where(
                PluginVariant.plugin_version_id == pv.id,
                PluginVariant.idx == variant_index,
            )
        )
        var = var_result.scalar_one_or_none()
        if var is None:
            var = PluginVariant(
                plugin_version_id=pv.id,
                idx=variant_index,
                package_path=str(pkg_path),
                package_sha256=actual_sha,
                package_signature=package_signature,
            )
            db.add(var)
        else:
            var.package_path = str(pkg_path)
            var.package_sha256 = actual_sha
            var.package_signature = package_signature
    else:
        # Legacy / non-watermarked: store on PluginVersion directly.
        pkg_path = plugins_dir / f"{plugin_id}-{version}.zip"
        pkg_path.write_bytes(data)
        pv.package_path = str(pkg_path)
        pv.package_sha256 = actual_sha

    if manifest_signature is not None:
        sig_result = await db.execute(
            select(ServerSetting).where(ServerSetting.key == "manifest_signature")
        )
        sig_row = sig_result.scalar_one_or_none()
        if sig_row is None:
            db.add(ServerSetting(key="manifest_signature", value=manifest_signature))
        else:
            sig_row.value = manifest_signature

    await db.flush()
    return PublishResponse(
        plugin_id=plugin_id,
        version=version,
        rollout_percent=rollout_percent,
        stored=True,
    )


# ── Deprecate (kill-switch) ────────────────────────────────────────────────────

class DeprecateRequest(BaseModel):
    plugin_id: str
    versions_spec: str  # e.g. "<=1.2.3"


class DeprecateResponse(BaseModel):
    plugin_id: str
    versions_spec: str
    deprecated: bool


@router.post("/deprecate", response_model=DeprecateResponse)
async def deprecate(
    req: DeprecateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeprecateResponse:
    _validate_identifier(req.plugin_id, "plugin_id")
    result = await db.execute(select(Plugin).where(Plugin.id == req.plugin_id))
    plugin = result.scalar_one_or_none()
    if plugin is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown plugin: {req.plugin_id}",
        )
    db.add(Deprecation(plugin_id=req.plugin_id, versions_spec=req.versions_spec))
    await db.flush()
    return DeprecateResponse(
        plugin_id=req.plugin_id, versions_spec=req.versions_spec, deprecated=True
    )


# ── Revoke token ───────────────────────────────────────────────────────────────

class RevokeRequest(BaseModel):
    token_id: int


class RevokeResponse(BaseModel):
    token_id: int
    revoked: bool


@router.post("/revoke", response_model=RevokeResponse)
async def revoke(
    req: RevokeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RevokeResponse:
    result = await db.execute(select(Token).where(Token.id == req.token_id))
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown token id: {req.token_id}",
        )
    token.revoked = True
    await db.flush()
    return RevokeResponse(token_id=req.token_id, revoked=True)


# ── Device limit ───────────────────────────────────────────────────────────────

class DeviceLimitRequest(BaseModel):
    device_limit: int


class DeviceLimitResponse(BaseModel):
    device_limit: int


@router.patch("/device-limit", response_model=DeviceLimitResponse)
async def update_device_limit(
    req: DeviceLimitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeviceLimitResponse:
    if req.device_limit < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_limit must be >= 1",
        )
    result = await db.execute(
        select(ServerSetting).where(ServerSetting.key == "device_limit")
    )
    row = result.scalar_one_or_none()
    if row is None:
        db.add(ServerSetting(key="device_limit", value=str(req.device_limit)))
    else:
        row.value = str(req.device_limit)
    await db.flush()
    return DeviceLimitResponse(device_limit=req.device_limit)


# ── Activation code issuance (plan §3.1 item 3) ───────────────────────────────

class IssueCodeRequest(BaseModel):
    """Body for POST /admin/issue-code.

    Optional attribution + lifecycle fields:
      * ``tg_user_id`` — Telegram user id of the issuer/recipient (None
        for unattributed codes).
      * ``label`` — free-form label for correlation (e.g. a channel-drop
        identifier).
      * ``ttl_minutes`` — expiration TTL.  ``None`` (default) → use
        ``settings.code_ttl_minutes`` (default 60); ``0`` → no expiration
        (``expires_at`` NULL); ``>0`` → ``expires_at = now + ttl``.
    """

    entitlements: list[str] | None = None  # default ["*"] when None
    count: int = 1  # number of codes to issue (1..100)
    tg_user_id: int | None = None
    label: str | None = None
    ttl_minutes: int | None = None
    tg_admin: bool = False  # True when issued by a TG admin (mirrors to /activate)


class IssueCodeResponse(BaseModel):
    codes: list[str]
    entitlements: list[str]


def _compute_expires_at(ttl_minutes: int | None) -> datetime | None:
    """Resolve ``expires_at`` from a per-issue ``ttl_minutes`` override.

    * ``None`` → fall back to ``settings.code_ttl_minutes`` (default 60).
    * ``0`` → no expiration (returns ``None``).
    * ``>0`` → ``now + ttl_minutes``.
    """
    settings = get_settings()
    ttl = settings.code_ttl_minutes if ttl_minutes is None else ttl_minutes
    if ttl <= 0:
        return None
    return datetime.now(UTC) + timedelta(minutes=ttl)


@router.post("/issue-code", response_model=IssueCodeResponse)
async def issue_code(
    req: IssueCodeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IssueCodeResponse:
    """Issue one or more one-time activation codes.

    Each code is a 128-bit random hex string (32 chars).  The codes are
    stored with the requested entitlements (default ``["*"]`` = all plugins)
    and ``used=False``.  The raw code is returned ONCE in this response —
    only its sha256 hash is persisted (same model as tokens, plan §3.1
    item 3).  Raw codes are never retrievable after issuance by design.

    Attribution (``tg_user_id``, ``label``) and lifecycle
    (``ttl_minutes``) are stored on each row; ``expires_at`` is computed
    from ``ttl_minutes`` per the contract.
    """
    if req.count < 1 or req.count > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="count must be between 1 and 100",
        )
    entitlements = req.entitlements if req.entitlements is not None else ["*"]
    expires_at = _compute_expires_at(req.ttl_minutes)

    codes: list[str] = []
    for _ in range(req.count):
        raw = secrets.token_hex(16)  # 128-bit / 32-char hex
        db.add(
            ActivationCode(
                code_hash=hash_code(raw),
                entitlements=entitlements,
                expires_at=expires_at,
                tg_user_id=req.tg_user_id,
                label=req.label,
                tg_admin=req.tg_admin,
            )
        )
        codes.append(raw)
    await db.flush()

    return IssueCodeResponse(codes=codes, entitlements=entitlements)


class CodeInfo(BaseModel):
    """A single activation code's metadata (raw code is never exposed)."""

    id: int
    code_hash_prefix: str
    entitlements: list[str]
    used: bool
    used_at: str | None
    token_id: int | None
    created_at: str
    expires_at: str | None
    revoked: bool
    tg_user_id: int | None
    label: str | None
    tg_admin: bool


class CodesListResponse(BaseModel):
    codes: list[CodeInfo]


@router.get("/codes", response_model=CodesListResponse)
async def list_codes(
    db: Annotated[AsyncSession, Depends(get_db)],
    unused_only: Annotated[bool, Query()] = False,
) -> CodesListResponse:
    """List all activation codes (used + unused).

    Raw codes are never returned — they are not persisted (only the sha256
    hash is).  Each entry exposes a 12-char ``code_hash_prefix`` so admins
    can correlate an issued code (known only from the issuance response)
    with a row by matching the prefix of ``sha256(raw_code)``.

    When ``unused_only=True``, only codes that are still redeemable are
    returned: ``used == False AND revoked == False AND not expired``
    (``expires_at`` is NULL or in the future).
    """
    now = datetime.now(UTC)
    result = await db.execute(select(ActivationCode).order_by(ActivationCode.id))
    rows = result.scalars().all()
    if unused_only:
        rows = [
            r
            for r in rows
            if not r.used
            and not r.revoked
            and (r.expires_at is None or as_utc(r.expires_at) > now)
        ]
    return CodesListResponse(
        codes=[
            CodeInfo(
                id=r.id,
                code_hash_prefix=r.code_hash[:12],
                entitlements=r.entitlements if r.entitlements is not None else [],
                used=r.used,
                used_at=as_utc(r.used_at).isoformat() if r.used_at else None,
                token_id=r.token_id,
                created_at=as_utc(r.created_at).isoformat(),
                expires_at=as_utc(r.expires_at).isoformat() if r.expires_at else None,
                revoked=bool(r.revoked),
                tg_user_id=r.tg_user_id,
                label=r.label,
                tg_admin=bool(r.tg_admin),
            )
            for r in rows
        ]
    )


# ── Revoke activation code (unused codes only) ────────────────────────────────

class RevokeCodeRequest(BaseModel):
    code_id: int


class RevokeCodeResponse(BaseModel):
    code_id: int
    revoked: bool


@router.post("/revoke-code", response_model=RevokeCodeResponse)
async def revoke_code(
    req: RevokeCodeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RevokeCodeResponse:
    """Revoke an UNUSED activation code.

    Sets ``revoked=True`` only when the code is unused.  Already-used
    codes cannot be revoked (409 ``Code already used``); unknown ids → 404.

    The mark-revoked step is an atomic conditional UPDATE
    (``WHERE id=? AND used=0``) so a concurrent /activate racing the
    revoke cannot end up with a code that is both used and revoked.
    """
    result = await db.execute(
        select(ActivationCode).where(ActivationCode.id == req.code_id)
    )
    code = result.scalar_one_or_none()
    if code is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown activation code id: {req.code_id}",
        )
    if code.used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Code already used",
        )
    upd = await db.execute(
        update(ActivationCode)
        .where(ActivationCode.id == code.id, ActivationCode.used == False)  # noqa: E712 — SQLAlchemy column expr
        .values(revoked=True)
    )
    if upd.rowcount == 0:
        # Lost the race: the code was activated between SELECT and UPDATE.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Code already used",
        )
    await db.flush()
    return RevokeCodeResponse(code_id=req.code_id, revoked=True)
