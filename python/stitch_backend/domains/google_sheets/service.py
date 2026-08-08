"""Google Sheets integration — Identity Graph CRUD via Google Sheets API v4.

Ports the Rust ``services/google_sheets.rs`` module to Python.
Uses the Google Sheets REST API with a service account (JWT flow).

Responsibilities:
    - Test connection (spreadsheet metadata)
    - Fetch & normalise the Accounts Graph dataset (IDENTITIES, LINKS, SVC_*)
    - Init/repair schema (create required sheets + headers)
    - CRUD for LINKS, ACCOUNT_LINKS, PROFILE_LINKS, AUTH_METHODS, ACCOUNT_AUTH_LINKS

The service account JSON is stored in ``settings`` and resolved lazily.

Dependencies:
    - ``httpx`` for HTTP
    - ``google-auth`` (or manual JWT) for service account auth

If ``google-auth`` is not installed, falls back to manual JWT signing.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, cast

import httpx

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
SECRET_SENTINEL = "********"

# Required sheets and their header rows
SCHEMA_SHEETS: dict[str, list[str]] = {
    "INDEX": ["key", "value", "updated_at"],
    "ENUMS": ["name", "values", "description"],
    "IDENTITIES": [
        "identity_id", "display_name", "email", "status", "tags",
        "created_at", "updated_at",
    ],
    "LINKS": [
        "link_id", "identity_id", "provider", "account_id", "role",
        "status", "is_primary", "metadata", "created_at", "updated_at",
    ],
    "SVC_ACCOUNT_LINKS": [
        "account_link_id", "account_id", "provider", "email", "status",
        "token_type", "metadata", "created_at", "updated_at",
    ],
    "SVC_PROFILE_LINKS": [
        "profile_link_id", "account_id", "profile_name", "fingerprint_id",
        "status", "metadata", "created_at", "updated_at",
    ],
    "SVC_AUTH_METHODS": [
        "auth_method_id", "provider", "method_type", "client_id",
        "status", "metadata", "created_at", "updated_at",
    ],
    "SVC_ACCOUNT_AUTH_LINKS": [
        "account_auth_link_id", "account_id", "auth_method_id",
        "status", "metadata", "created_at", "updated_at",
    ],
}

# Map of SVC_* sheet name → AccountsGraphDataset field (camelCase)
SVC_FIELD_MAP: dict[str, str] = {
    "SVC_ACCOUNT_LINKS": "accountLinks",
    "SVC_PROFILE_LINKS": "profileLinks",
    "SVC_AUTH_METHODS": "authMethods",
    "SVC_ACCOUNT_AUTH_LINKS": "accountAuthLinks",
}


# ── Data classes ─────────────────────────────────────────────────────────────


@dataclass
class KeyValue:
    """A key-value pair used in the Sheets API. Value is coerced to string."""

    key: str
    value: Any

    def to_dict(self) -> dict:
        return {"key": self.key, "value": "" if self.value is None else str(self.value)}


@dataclass
class GoogleSheetsConnectionStatus:
    """Result of testing a Google Sheets connection.

    TS contract: { ok: boolean; spreadsheetId: string; title: string | null;
                   sheets: SheetDescriptor[]; warnings: string[] }
    """
    ok: bool
    spreadsheet_id: str
    title: str | None = None
    sheets: list[dict] = field(default_factory=list)  # [{title, sheetId}]
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "spreadsheetId": self.spreadsheet_id,
            "title": self.title,
            "sheets": self.sheets,
            "warnings": self.warnings,
        }


@dataclass
class AccountsGraphDataset:
    """Normalised dataset fetched from Google Sheets.

    TS contract: { spreadsheetId: string; title: string | null;
                   identities: NormalizedRow[]; links: NormalizedRow[];
                   accountLinks: NormalizedRow[]; profileLinks: NormalizedRow[];
                   authMethods: NormalizedRow[]; accountAuthLinks: NormalizedRow[];
                   services: ServiceSheetDataset[]; invalidRows: InvalidRow[];
                   schemaIssues: SchemaIssue[] }
    """
    spreadsheet_id: str = ""
    title: str | None = None
    identities: list[dict] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    account_links: list[dict] = field(default_factory=list)
    profile_links: list[dict] = field(default_factory=list)
    auth_methods: list[dict] = field(default_factory=list)
    account_auth_links: list[dict] = field(default_factory=list)
    services: list[dict] = field(default_factory=list)
    invalid_rows: list[dict] = field(default_factory=list)
    schema_issues: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "spreadsheetId": self.spreadsheet_id,
            "title": self.title,
            "identities": self.identities,
            "links": self.links,
            "accountLinks": self.account_links,
            "profileLinks": self.profile_links,
            "authMethods": self.auth_methods,
            "accountAuthLinks": self.account_auth_links,
            "services": self.services,
            "invalidRows": self.invalid_rows,
            "schemaIssues": self.schema_issues,
        }


# ── Auth helper ──────────────────────────────────────────────────────────────

# ponytail: module-level dict cache with TTL — simplest correct cache.
# Upgrade path: per-account locks + LRU eviction if token churn or concurrency matters.
_token_cache: dict[str, tuple[str, float]] = {}
_TOKEN_TTL = 3300.0  # seconds (Google tokens expire in 3600; refresh early)


def _fetch_new_token(service_account_json: str) -> str:
    """Fetch a fresh OAuth2 access token (no cache)."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account as sa

        creds = sa.Credentials.from_service_account_info(
            json.loads(service_account_json),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        creds.refresh(Request())
        return cast("str", creds.token)
    except ImportError:
        pass

    # Manual JWT flow (lightweight fallback)
    import base64

    sa_info = json.loads(service_account_json)
    now = int(time.time())

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "RS256", "typ": "JWT"}).encode()
    ).rstrip(b"=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": sa_info["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }).encode()).rstrip(b"=")

    signing_input = header + b"." + payload

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        private_key = cast("Any", serialization.load_pem_private_key(
            sa_info["private_key"].encode(), password=None,
        ))
        signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    except ImportError:
        raise RuntimeError(
            "Neither google-auth nor cryptography is installed. "
            "Install one: pip install google-auth cryptography"
        ) from None

    sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")
    jwt_token = (signing_input + b"." + sig_b64).decode()

    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt_token,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return cast("str", resp.json()["access_token"])


def _get_access_token(service_account_json: str) -> str:
    """Obtain an OAuth2 access token from a service account JSON (cached)."""
    cache_key = hashlib.sha256(service_account_json.encode()).hexdigest()
    cached = _token_cache.get(cache_key)
    if cached and cached[1] > time.time():
        return cached[0]

    token = _fetch_new_token(service_account_json)
    _token_cache[cache_key] = (token, time.time() + _TOKEN_TTL)
    return token


async def _resolve_access_token(service_account_json: str) -> str:
    """Prefer stored OAuth user tokens; fall back to service-account JWT.

    OAuth tokens (when a user has connected their Google account) take
    priority over the service-account JSON flow.  If no OAuth tokens are
    stored or the refresh fails, the caller's service-account JSON is used.
    """
    from stitch_backend.domains.google_sheets.oauth_service import get_oauth_service

    # ponytail: swallow OAuth errors — if the DB or OAuth service is
    # unavailable, fall back to the service-account flow silently.
    try:
        oauth_token = await get_oauth_service().get_access_token()
        if oauth_token:
            return oauth_token
    except Exception:
        pass
    return _get_access_token(service_account_json)


# ── Normalization helpers ────────────────────────────────────────────────────


def _normalize_row(row_number: int, headers: list[str], raw_row: list[str]) -> dict:
    """Convert a raw sheet row to NormalizedRow dict: {rowNumber, cells: [{key, value}]}."""
    cells = []
    for i, header in enumerate(headers):
        value = raw_row[i] if i < len(raw_row) else ""
        cells.append(KeyValue(key=header, value=value).to_dict())
    return {"rowNumber": row_number, "cells": cells}


def _get_cell_value(normalized_row: dict, key: str) -> str:
    """Extract a cell value from a NormalizedRow by key."""
    for cell in normalized_row.get("cells", []):
        if cell["key"] == key:
            return cast("str", cell["value"])
    return ""


# ── Service ──────────────────────────────────────────────────────────────────


class GoogleSheetsService:
    """Thin wrapper around the Google Sheets REST API v4."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # ── Connection test ──────────────────────────────────────────────────────

    async def test_connection(
        self, spreadsheet_id: str, service_account_json: str
    ) -> GoogleSheetsConnectionStatus:
        token = await _resolve_access_token(service_account_json)
        client = self._get_client()

        try:
            resp = await client.get(
                f"{SHEETS_API_BASE}/{spreadsheet_id}",
                params={"includeGridData": "false"},
                headers=self._headers(token),
            )
            resp.raise_for_status()
            data = resp.json()

            sheets = [
                {"title": s["properties"]["title"], "sheetId": s["properties"]["sheetId"]}
                for s in data.get("sheets", [])
            ]
            return GoogleSheetsConnectionStatus(
                ok=True,
                spreadsheet_id=spreadsheet_id,
                title=data.get("properties", {}).get("title"),
                sheets=sheets,
            )
        except Exception as exc:
            return GoogleSheetsConnectionStatus(
                ok=False,
                spreadsheet_id=spreadsheet_id,
                title=None,
                sheets=[],
                warnings=[str(exc)[:300]],
            )

    # ── Schema init ─────────────────────────────────────────────────────────

    async def init_schema(
        self, spreadsheet_id: str, service_account_json: str
    ) -> GoogleSheetsConnectionStatus:
        """Create required sheets + headers if missing."""
        token = await _resolve_access_token(service_account_json)
        client = self._get_client()

        # Fetch current sheets
        resp = await client.get(
            f"{SHEETS_API_BASE}/{spreadsheet_id}",
            params={"includeGridData": "false"},
            headers=self._headers(token),
        )
        resp.raise_for_status()
        existing = {s["properties"]["title"] for s in resp.json().get("sheets", [])}

        requests: list[dict] = []
        for sheet_name in SCHEMA_SHEETS:
            if sheet_name not in existing:
                requests.append({"addSheet": {"properties": {"title": sheet_name}}})

        if requests:
            await client.post(
                f"{SHEETS_API_BASE}/{spreadsheet_id}:batchUpdate",
                json={"requests": requests},
                headers=self._headers(token),
            )

        # Write headers for each sheet
        for sheet_name, headers in SCHEMA_SHEETS.items():
            range_str = f"{sheet_name}!A1:{chr(64 + len(headers))}1"
            await client.put(
                f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{range_str}",
                params={"valueInputOption": "RAW"},
                json={"values": [headers]},
                headers=self._headers(token),
            )

        # Return updated status
        return await self.test_connection(spreadsheet_id, service_account_json)

    # ── Dataset fetch ───────────────────────────────────────────────────────

    async def fetch_dataset(
        self, spreadsheet_id: str, service_account_json: str
    ) -> AccountsGraphDataset:
        token = await _resolve_access_token(service_account_json)
        client = self._get_client()

        dataset = AccountsGraphDataset(spreadsheet_id=spreadsheet_id)

        # Get spreadsheet metadata (title + sheet list with sheetIds)
        try:
            resp = await client.get(
                f"{SHEETS_API_BASE}/{spreadsheet_id}",
                params={"includeGridData": "false"},
                headers=self._headers(token),
            )
            resp.raise_for_status()
            data = resp.json()
            dataset.title = data.get("properties", {}).get("title")
            sheet_list = data.get("sheets", [])
            sheet_map = {
                s["properties"]["title"]: s["properties"].get("sheetId", 0)
                for s in sheet_list
            }
            sheet_names = list(sheet_map.keys())
        except Exception:
            return dataset

        # Fetch IDENTITIES
        if "IDENTITIES" in sheet_names:
            dataset.identities = await self._fetch_sheet(
                client, token, spreadsheet_id, "IDENTITIES"
            )

        # Fetch LINKS
        if "LINKS" in sheet_names:
            dataset.links = await self._fetch_sheet(
                client, token, spreadsheet_id, "LINKS"
            )

        # Fetch SVC_* sheets
        for name in sheet_names:
            if not name.startswith("SVC_"):
                continue
            rows = await self._fetch_sheet(client, token, spreadsheet_id, name)
            sheet_id = sheet_map.get(name, 0)

            # Build ServiceSheetDataset entry for every SVC_* sheet
            dataset.services.append({
                "sheetName": name,
                "sheetId": sheet_id,
                "rows": rows,
            })

            # Also populate the explicit camelCase field if it's a standard sheet
            field = SVC_FIELD_MAP.get(name)
            if field == "accountLinks":
                dataset.account_links = rows
            elif field == "profileLinks":
                dataset.profile_links = rows
            elif field == "authMethods":
                dataset.auth_methods = rows
            elif field == "accountAuthLinks":
                dataset.account_auth_links = rows

        # Schema issues: warn about missing required sheets
        for required in ("IDENTITIES", "LINKS"):
            if required not in sheet_names:
                dataset.schema_issues.append({
                    "level": "warning",
                    "sheetName": required,
                    "message": f"Required sheet '{required}' is missing",
                })

        return dataset

    async def _fetch_sheet(
        self, client: httpx.AsyncClient, token: str, spreadsheet_id: str, sheet_name: str
    ) -> list[dict]:
        """Fetch a sheet and return rows as NormalizedRow dicts: {rowNumber, cells}."""
        resp = await client.get(
            f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{sheet_name}",
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return []

        values = resp.json().get("values", [])
        if len(values) < 2:
            return []

        headers = values[0]
        rows = []
        for i, row in enumerate(values[1:]):
            row_number = i + 2  # 1-indexed, header is row 1
            rows.append(_normalize_row(row_number, headers, row))
        return rows

    # ── Row CRUD helpers ─────────────────────────────────────────────────────

    async def _upsert_row(
        self,
        token: str,
        spreadsheet_id: str,
        sheet_name: str,
        row: list[dict],
        id_column: str,
    ) -> list[dict]:
        """Upsert a row by its ID column. Returns the normalised row cells."""
        client = self._get_client()
        row_dict = {kv["key"]: kv["value"] for kv in row}

        # Generate ID if missing
        row_id = row_dict.get(id_column, "")
        if not row_id:
            row_id = str(uuid.uuid4())
            row_dict[id_column] = row_id

        # Read existing to find row index
        existing = await self._fetch_sheet(client, token, spreadsheet_id, sheet_name)
        headers = SCHEMA_SHEETS.get(sheet_name, list(row_dict.keys()))

        # Find matching row
        row_index = -1
        for i, existing_row in enumerate(existing):
            if _get_cell_value(existing_row, id_column) == row_id:
                row_index = i
                break

        values_row = [str(row_dict.get(h, "")) for h in headers]

        if row_index >= 0:
            # Update existing row (1-indexed, +2 for header)
            range_str = f"{sheet_name}!A{row_index + 2}:{chr(64 + len(headers))}{row_index + 2}"
        else:
            # Append new row
            range_str = f"{sheet_name}!A:{chr(64 + len(headers))}"

        await client.post(
            f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{range_str}:append" if row_index < 0
            else f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{range_str}",
            params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"} if row_index < 0 else {"valueInputOption": "RAW"},
            json={"values": [values_row]},
            headers=self._headers(token),
        )

        return [KeyValue(key=k, value=row_dict.get(k, "")).to_dict() for k in headers]

    async def _soft_delete_row(
        self,
        token: str,
        spreadsheet_id: str,
        sheet_name: str,
        row_id: str,
        id_column: str,
    ) -> bool:
        """Soft-delete a row by setting status=deleted."""
        client = self._get_client()
        existing = await self._fetch_sheet(client, token, spreadsheet_id, sheet_name)
        headers = SCHEMA_SHEETS.get(sheet_name, [])

        for i, row in enumerate(existing):
            if _get_cell_value(row, id_column) == row_id:
                # Build update with status=deleted
                values_row = [str(_get_cell_value(row, h)) for h in headers]
                status_idx = headers.index("status") if "status" in headers else -1
                is_primary_idx = headers.index("is_primary") if "is_primary" in headers else -1

                if status_idx >= 0:
                    values_row[status_idx] = "deleted"
                if is_primary_idx >= 0:
                    values_row[is_primary_idx] = "FALSE"

                range_str = f"{sheet_name}!A{i + 2}:{chr(64 + len(headers))}{i + 2}"
                await client.put(
                    f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{range_str}",
                    params={"valueInputOption": "RAW"},
                    json={"values": [values_row]},
                    headers=self._headers(token),
                )
                return True

        return False

    # ── Public CRUD methods ──────────────────────────────────────────────────

    async def upsert_link(self, spreadsheet_id: str, sa_json: str, link: list[dict]) -> list[dict]:
        token = await _resolve_access_token(sa_json)
        return await self._upsert_row(token, spreadsheet_id, "LINKS", link, "link_id")

    async def soft_delete_link(self, spreadsheet_id: str, sa_json: str, link_id: str) -> bool:
        token = await _resolve_access_token(sa_json)
        return await self._soft_delete_row(token, spreadsheet_id, "LINKS", link_id, "link_id")

    async def upsert_account_link(self, spreadsheet_id: str, sa_json: str, link: list[dict]) -> list[dict]:
        token = await _resolve_access_token(sa_json)
        return await self._upsert_row(token, spreadsheet_id, "SVC_ACCOUNT_LINKS", link, "account_link_id")

    async def soft_delete_account_link(self, spreadsheet_id: str, sa_json: str, link_id: str) -> bool:
        token = await _resolve_access_token(sa_json)
        return await self._soft_delete_row(token, spreadsheet_id, "SVC_ACCOUNT_LINKS", link_id, "account_link_id")

    async def upsert_profile_link(self, spreadsheet_id: str, sa_json: str, link: list[dict]) -> list[dict]:
        token = await _resolve_access_token(sa_json)
        return await self._upsert_row(token, spreadsheet_id, "SVC_PROFILE_LINKS", link, "profile_link_id")

    async def soft_delete_profile_link(self, spreadsheet_id: str, sa_json: str, link_id: str) -> bool:
        token = await _resolve_access_token(sa_json)
        return await self._soft_delete_row(token, spreadsheet_id, "SVC_PROFILE_LINKS", link_id, "profile_link_id")

    async def upsert_auth_method(self, spreadsheet_id: str, sa_json: str, method: list[dict]) -> list[dict]:
        token = await _resolve_access_token(sa_json)
        return await self._upsert_row(token, spreadsheet_id, "SVC_AUTH_METHODS", method, "auth_method_id")

    async def soft_delete_auth_method(self, spreadsheet_id: str, sa_json: str, method_id: str) -> bool:
        token = await _resolve_access_token(sa_json)
        return await self._soft_delete_row(token, spreadsheet_id, "SVC_AUTH_METHODS", method_id, "auth_method_id")

    async def upsert_account_auth_link(self, spreadsheet_id: str, sa_json: str, link: list[dict]) -> list[dict]:
        token = await _resolve_access_token(sa_json)
        return await self._upsert_row(token, spreadsheet_id, "SVC_ACCOUNT_AUTH_LINKS", link, "account_auth_link_id")

    async def soft_delete_account_auth_link(self, spreadsheet_id: str, sa_json: str, link_id: str) -> bool:
        token = await _resolve_access_token(sa_json)
        return await self._soft_delete_row(token, spreadsheet_id, "SVC_ACCOUNT_AUTH_LINKS", link_id, "account_auth_link_id")


# ── Singleton ────────────────────────────────────────────────────────────────

_service: GoogleSheetsService | None = None


def get_sheets_service() -> GoogleSheetsService:
    global _service
    if _service is None:
        _service = GoogleSheetsService()
    return _service
