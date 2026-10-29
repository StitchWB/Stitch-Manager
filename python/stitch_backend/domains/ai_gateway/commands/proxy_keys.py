"""User proxy key commands (per-user auth tokens for /v1/*)."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import func, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.commands._common import _caller_uid
from stitch_backend.domains.ai_gateway.models import Credential, CredentialGroupShare
from stitch_backend.domains.ai_gateway.schemas import (
    ProxyKeyCreatedResponse,
    ProxyKeyCreateRequest,
    ProxyKeyListResponse,
    ProxyKeyPoolGroupEntry,
    ProxyKeyResponse,
    ProxyKeyRevokeRequest,
)
from stitch_backend.domains.ai_gateway.service import UserProxyKeyService


def _mask_proxy_key_hash(token_hash: str) -> str:
    """Mask a proxy key hash for display: first4+****+last4.

    The raw key is never stored (only its SHA256), so the hash is used as
    a fingerprint for identification — the raw key itself is shown ONCE at
    creation time and never again.
    """
    if len(token_hash) < 8:
        return "****"
    return token_hash[:4] + "****" + token_hash[-4:]


def _gateway_base_url() -> str:
    """The gateway base URL the app advertises to clients."""
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


@register_command("proxy_keys_list")
async def cmd_proxy_keys_list(params: dict) -> dict:
    """List the caller's proxy keys + pool summary + gateway base URL.

    When the caller is authenticated (uid is not None) and has no enabled
    keys, a default key is auto-created (and committed).  When uid is
    None (auth disabled / desktop), returns ``keys: []`` with only the
    base URL.  Not marked ``readonly`` because of the auto-create side
    effect.
    """
    uid = _caller_uid(params)
    base_url = _gateway_base_url()

    if uid is None:
        return ProxyKeyListResponse(
            base_url=base_url,
            keys=[],
            pool={"personal": 0, "legacy": 0, "groups": []},
        ).model_dump(mode="json", by_alias=True)

    async def _op(session):
        svc = UserProxyKeyService(session)
        keys = await svc.list_proxy_keys(uid)

        # Auto-create a default key when the user has no enabled keys.
        if not any(k.enabled for k in keys):
            new_key, _raw = await svc.create_proxy_key(
                uid, label="default", is_default=True,
            )
            keys = [*keys, new_key]

        # Pool summary: personal credentials, legacy (instance-shared), groups.
        personal_result = await session.execute(
            select(func.count()).select_from(Credential).where(
                Credential.owner_id == uid
            )
        )
        personal = int(personal_result.scalar_one())

        legacy_result = await session.execute(
            select(func.count()).select_from(Credential).where(
                Credential.owner_id.is_(None)
            )
        )
        legacy = int(legacy_result.scalar_one())

        # Lazy import — avoids a top-level ``ai_gateway → groups`` edge.
        from stitch_backend.domains.groups.models import Group, GroupMember

        groups_stmt = (
            select(
                Group.id,
                Group.name,
                func.count(CredentialGroupShare.credential_id).label("keys"),
            )
            .select_from(Group)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .outerjoin(
                CredentialGroupShare,
                CredentialGroupShare.group_id == Group.id,
            )
            .where(GroupMember.user_id == uid)
            .group_by(Group.id, Group.name)
            .order_by(Group.created_at.desc())
        )
        groups_result = await session.execute(groups_stmt)
        groups = [
            ProxyKeyPoolGroupEntry(
                id=row.id, name=row.name, keys=row.keys,
            )
            for row in groups_result.all()
        ]

        key_responses = [
            ProxyKeyResponse(
                id=k.id,
                label=k.label,
                masked_key=_mask_proxy_key_hash(k.token_hash),
                enabled=k.enabled,
                created_at=k.created_at,
                last_used_at=k.last_used_at,
                is_default=k.is_default,
            )
            for k in keys
        ]

        return ProxyKeyListResponse(
            base_url=base_url,
            keys=key_responses,
            pool={
                "personal": personal,
                "legacy": legacy,
                "groups": [g.model_dump(mode="json", by_alias=True) for g in groups],
            },
        )

    result = await run_in_session(_op)
    return cast("dict[Any, Any]", result.model_dump(mode="json", by_alias=True))


@register_command("proxy_keys_create")
async def cmd_proxy_keys_create(params: dict) -> dict:
    """Create a new proxy key for the caller. Raw key is shown ONCE."""
    req = ProxyKeyCreateRequest.model_validate(params)
    uid = _caller_uid(params)
    if uid is None:
        raise StitchError("proxy_keys_create requires an authenticated user")

    async def _op(session):
        svc = UserProxyKeyService(session)
        record, raw = await svc.create_proxy_key(uid, label=req.label)
        return ProxyKeyCreatedResponse(key=raw, id=record.id)

    result = await run_in_session(_op)
    return cast("dict[Any, Any]", result.model_dump(mode="json", by_alias=True))


@register_command("proxy_keys_revoke")
async def cmd_proxy_keys_revoke(params: dict) -> dict:
    """Revoke a proxy key (own only; default guarded)."""
    req = ProxyKeyRevokeRequest.model_validate(params)
    uid = _caller_uid(params)
    if uid is None:
        raise StitchError("proxy_keys_revoke requires an authenticated user")

    async def _op(session):
        svc = UserProxyKeyService(session)
        return await svc.revoke_proxy_key(req.id, uid)

    await run_in_session(_op)
    return {"success": True}
