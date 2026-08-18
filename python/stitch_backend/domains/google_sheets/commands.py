"""Google Sheets command handlers — registered via ``@register_command``.

Ports all 12 Rust ``google_sheets`` legacy commands to Python.

Commands:
    - test_google_sheets_connection
    - fetch_google_sheets_dataset
    - init_google_sheets_schema
    - upsert_google_sheets_link / delete_google_sheets_link
    - upsert_google_sheets_account_link / delete_google_sheets_account_link
    - upsert_google_sheets_profile_link / delete_google_sheets_profile_link
    - upsert_google_sheets_auth_method / delete_google_sheets_auth_method
    - upsert_google_sheets_account_auth_link / delete_google_sheets_account_auth_link
"""

from __future__ import annotations

import logging
from typing import cast

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.google_sheets.service import (
    SECRET_SENTINEL,
    get_sheets_service,
)

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _resolve_sa_json(provided: str) -> str:
    """Resolve the service account JSON, falling back to the stored value."""
    trimmed = provided.strip()
    if trimmed and trimmed != SECRET_SENTINEL:
        return trimmed

    # Read from settings
    async def _op(session):
        from sqlalchemy import text
        row = (await session.execute(
            text("SELECT value FROM settings WHERE key = 'google_sheets_service_account_json'")
        )).scalar_one_or_none()
        return row or ""

    value = await run_in_session(_op)
    if not value.strip():
        raise ValueError(
            "Google Sheets service account JSON is not configured. "
            "Paste it in Settings → Google Sheets and click Save."
        )
    return cast("str", value)


# ── Connection ───────────────────────────────────────────────────────────────

@register_command("test_google_sheets_connection")
async def cmd_test_connection(params: dict) -> dict:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))

    svc = get_sheets_service()
    status = await svc.test_connection(spreadsheet_id, sa_json)
    return status.to_dict()


@register_command("init_google_sheets_schema")
async def cmd_init_schema(params: dict) -> dict:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))

    svc = get_sheets_service()
    status = await svc.init_schema(spreadsheet_id, sa_json)
    return status.to_dict()


@register_command("fetch_google_sheets_dataset")
async def cmd_fetch_dataset(params: dict) -> dict:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))

    svc = get_sheets_service()
    dataset = await svc.fetch_dataset(spreadsheet_id, sa_json)
    return dataset.to_dict()


# ── Links CRUD ───────────────────────────────────────────────────────────────

@register_command("upsert_google_sheets_link")
async def cmd_upsert_link(params: dict) -> list:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link = params.get("link", [])

    svc = get_sheets_service()
    return await svc.upsert_link(spreadsheet_id, sa_json, link)


@register_command("delete_google_sheets_link")
async def cmd_delete_link(params: dict) -> bool:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link_id = str(params.get("linkId", ""))

    svc = get_sheets_service()
    return await svc.soft_delete_link(spreadsheet_id, sa_json, link_id)


# ── Account Links ────────────────────────────────────────────────────────────

@register_command("upsert_google_sheets_account_link")
async def cmd_upsert_account_link(params: dict) -> list:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link = params.get("link", [])

    svc = get_sheets_service()
    return await svc.upsert_account_link(spreadsheet_id, sa_json, link)


@register_command("delete_google_sheets_account_link")
async def cmd_delete_account_link(params: dict) -> bool:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link_id = str(params.get("accountLinkId", ""))

    svc = get_sheets_service()
    return await svc.soft_delete_account_link(spreadsheet_id, sa_json, link_id)


# ── Profile Links ────────────────────────────────────────────────────────────

@register_command("upsert_google_sheets_profile_link")
async def cmd_upsert_profile_link(params: dict) -> list:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link = params.get("link", [])

    svc = get_sheets_service()
    return await svc.upsert_profile_link(spreadsheet_id, sa_json, link)


@register_command("delete_google_sheets_profile_link")
async def cmd_delete_profile_link(params: dict) -> bool:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link_id = str(params.get("profileLinkId", ""))

    svc = get_sheets_service()
    return await svc.soft_delete_profile_link(spreadsheet_id, sa_json, link_id)


# ── Auth Methods ─────────────────────────────────────────────────────────────

@register_command("upsert_google_sheets_auth_method")
async def cmd_upsert_auth_method(params: dict) -> list:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    method = params.get("method", [])

    svc = get_sheets_service()
    return await svc.upsert_auth_method(spreadsheet_id, sa_json, method)


@register_command("delete_google_sheets_auth_method")
async def cmd_delete_auth_method(params: dict) -> bool:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    method_id = str(params.get("authMethodId", ""))

    svc = get_sheets_service()
    return await svc.soft_delete_auth_method(spreadsheet_id, sa_json, method_id)


# ── Account Auth Links ──────────────────────────────────────────────────────

@register_command("upsert_google_sheets_account_auth_link")
async def cmd_upsert_account_auth_link(params: dict) -> list:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link = params.get("link", [])

    svc = get_sheets_service()
    return await svc.upsert_account_auth_link(spreadsheet_id, sa_json, link)


@register_command("delete_google_sheets_account_auth_link")
async def cmd_delete_account_auth_link(params: dict) -> bool:
    spreadsheet_id = str(params.get("spreadsheetId", ""))
    sa_json = await _resolve_sa_json(str(params.get("serviceAccountJson", "")))
    link_id = str(params.get("accountAuthLinkId", ""))

    svc = get_sheets_service()
    return await svc.soft_delete_account_auth_link(spreadsheet_id, sa_json, link_id)
