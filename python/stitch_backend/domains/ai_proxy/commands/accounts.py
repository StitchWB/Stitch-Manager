"""Account CRUD + export/import — thin aliases over the unified ai_gateway tables.

Implemented via ``legacy_accounts_api`` over ``ai_gateway_credentials`` /
``CredentialSecret`` / ``ProviderEndpoint``. The response shape is fixed:
the frontend (``aiProxy.ts``) and mcp_server consume it as-is.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_proxy.commands._common import _alias_owner_id

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@register_command("get_ai_proxy_accounts", readonly=True)
async def cmd_get_ai_proxy_accounts(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import list_accounts

    owner_id = _alias_owner_id(params)
    caller_uid = params.get("_caller_user_id")
    caller_role = params.get("_caller_role")

    async def _op(session):
        return await list_accounts(
            session, owner_id=owner_id,
            caller_uid=caller_uid, caller_role=caller_role,
        )

    return await run_in_session(_op)


@command("create_ai_proxy_account")
async def cmd_create_ai_proxy_account(db: AsyncSession, params: dict) -> int:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import create_account
    account = params.get("account", params)
    owner_id = _alias_owner_id(params)

    return await create_account(db, account, owner_id=owner_id)


@command("update_ai_proxy_account")
async def cmd_update_ai_proxy_account(db: AsyncSession, params: dict) -> None:
    from fastapi import HTTPException, status

    from stitch_backend.config import get_settings
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import (
        _caller_can_modify_credential,
        _find_credential_by_legacy_id,
        update_account,
    )
    account = params.get("account", params)
    owner_id = _alias_owner_id(params)
    caller_uid = params.get("_caller_user_id")
    caller_role = params.get("_caller_role")

    legacy_id = account.get("id")
    if legacy_id is not None and get_settings().auth_enabled:
        credential = await _find_credential_by_legacy_id(db, int(legacy_id))
        if credential is not None and not _caller_can_modify_credential(
            credential, caller_uid, caller_role,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the credential owner or an admin may modify this account",
            )
    await update_account(db, account, owner_id=owner_id)


@command("delete_ai_proxy_account")
async def cmd_delete_ai_proxy_account(db: AsyncSession, params: dict) -> None:
    from fastapi import HTTPException, status

    from stitch_backend.config import get_settings
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import (
        _find_credential_by_legacy_id,
        caller_can_delete_credential,
        delete_account,
    )
    account_id = params.get("id", params.get("accountId", 0))
    caller_uid = params.get("_caller_user_id")
    caller_role = params.get("_caller_role")

    if get_settings().auth_enabled:
        credential = await _find_credential_by_legacy_id(db, int(account_id))
        if credential is not None and not await caller_can_delete_credential(
            db, credential, caller_uid, caller_role,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Only the credential owner, a group owner, or an admin "
                    "may delete a group-shared account"
                ),
            )
    await delete_account(db, int(account_id))


@register_command("export_ai_proxy_accounts_payload")
async def cmd_export_ai_proxy_accounts_payload(params: dict) -> str:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import export_payload
    from stitch_backend.domains.auth.permissions import ensure_permission

    await ensure_permission(params, "action.export_accounts")

    fmt = params.get("format", "json")
    include_secrets = params.get("includeSecrets", params.get("include_secrets", False))

    async def _op(session):
        return await export_payload(session, fmt=fmt, include_secrets=include_secrets)

    return await run_in_session(_op)


@register_command("import_ai_proxy_accounts_payload")
async def cmd_import_ai_proxy_accounts_payload(params: dict) -> int:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import import_payload
    from stitch_backend.domains.auth.permissions import ensure_permission

    await ensure_permission(params, "action.export_accounts")

    payload_str = params.get("payload", params.get("payloadStr", "{}"))
    if isinstance(payload_str, dict):
        payload_str = json.dumps(payload_str)

    async def _op(session):
        return await import_payload(session, payload_str)

    imported = await run_in_session(_op)
    return cast("int", imported)  # int
