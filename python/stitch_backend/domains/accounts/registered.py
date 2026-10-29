"""Auto-registered account persistence leaf for AccountService."""


from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from stitch_backend.domains.accounts.helpers import _utcnow

if TYPE_CHECKING:
    from stitch_backend.domains.accounts.models import Account
    from stitch_backend.domains.accounts.service import AccountService

# Pin the original module's logger name: log routing keys on it.
logger = logging.getLogger("stitch_backend.domains.accounts.service")


async def add_registered_account(
    self: AccountService,
    *,
    provider: str,
    email: str,
    password: str | None = None,
    token: str | None = None,
    refresh_token: str | None = None,
    api_key: str | None = None,
    display_name: str | None = None,
    account_type: str | None = None,
    ref_code: str | None = None,
    ref_url: str | None = None,
    ref_max_count: int = 40,
    referred_by_id: str | None = None,
) -> Account:
    """Persist an auto-registered account (registration_source='auto').

    Schema-adaptive: introspects the ``accounts`` table via
    ``PRAGMA table_info`` to detect whether it uses the legacy Rust-era
    schema (``id INTEGER PRIMARY KEY AUTOINCREMENT``, ``quota_used``
    column present) or the newer Python ORM schema (``id`` String/UUID,
    no ``quota_used``), then builds the INSERT to match.  On the legacy
    schema the ``id`` column is omitted so SQLite auto-assigns the next
    integer rowid; the actual assigned id is read back via
    ``last_insert_rowid()``.
    """
    from sqlalchemy import text as _text

    now_str = _utcnow().isoformat()
    new_uuid = str(uuid.uuid4())

    # ── Introspect the accounts table schema ───────────────────────
    pragma_result = await self._db.execute(
        _text("PRAGMA table_info(accounts)")
    )
    col_rows = pragma_result.fetchall()
    col_types = {row[1]: (row[2] or "") for row in col_rows}

    id_type_upper = col_types.get("id", "").upper()
    is_legacy_id = "INT" in id_type_upper
    has_quota_used = "quota_used" in col_types
    has_quota_limit = "quota_limit" in col_types
    has_login_count = "login_count" in col_types
    has_error_count = "error_count" in col_types

    # Constant values inline as SQL literals; variable values use named parameters (:name).
    col_value_pairs: list[tuple[str, str]] = []

    if not is_legacy_id:
        # ORM schema: id is String/UUID NOT NULL — supply it.
        col_value_pairs.append(("id", ":id"))

    col_value_pairs.extend([
        ("provider", ":provider"),
        ("email", ":email"),
        ("password", ":password"),
        ("token", ":token"),
        ("refresh_token", ":refresh_token"),
        ("status", "'active'"),
        ("display_name", ":display_name"),
        ("api_key", ":api_key"),
        ("registration_source", "'auto'"),
        ("ref_code", ":ref_code"),
        ("ref_url", ":ref_url"),
        ("ref_used_count", "0"),
        ("ref_max_count", ":ref_max_count"),
        ("referred_by_id", ":referred_by_id"),
        ("notes", ":notes"),
        ("tags", "'[]'"),
        ("use_count", "0"),
        ("success_rate", "1.0"),
        ("created_at", ":created_at"),
    ])

    if has_quota_used:
        col_value_pairs.append(("quota_used", "0"))

    if has_quota_limit:
        col_value_pairs.append(("quota_limit", "0"))

    if has_login_count:
        col_value_pairs.append(("login_count", "0"))

    if has_error_count:
        col_value_pairs.append(("error_count", "0"))

    col_names = ", ".join(pair[0] for pair in col_value_pairs)
    col_values = ", ".join(pair[1] for pair in col_value_pairs)

    params: dict[str, str | int | None] = {
        "provider": provider,
        "email": email,
        "password": password or "",
        "token": token,
        "refresh_token": refresh_token,
        "display_name": display_name or email,
        "api_key": api_key,
        "ref_code": ref_code,
        "ref_url": ref_url,
        "ref_max_count": ref_max_count,
        "referred_by_id": referred_by_id,
        "notes": (f"plan={account_type}" if account_type else None),
        "created_at": now_str,
    }
    if not is_legacy_id:
        params["id"] = new_uuid

    insert_sql = (
        f"INSERT INTO accounts ({col_names}) VALUES ({col_values})"
    )
    await self._db.execute(_text(insert_sql), params)

    # ── Determine the actual assigned id ──────────────────────────
    if is_legacy_id:
        # SQLite auto-assigned the next INTEGER rowid — read it back.
        row_result = await self._db.execute(
            _text("SELECT last_insert_rowid()")
        )
        actual_id = row_result.scalar()
    else:
        actual_id = new_uuid

    await self._db.flush()

    logger.info(
        "Registered account saved: %s (%s) id=%s referred_by=%s",
        email, provider, actual_id, referred_by_id,
    )

    # SimpleNamespace not Account.__new__: the latter bypasses SQLAlchemy instrumentation and breaks attr access.
    from types import SimpleNamespace
    account = SimpleNamespace(
        id=actual_id,
        email=email,
        provider=provider,
        status="active",
        display_name=display_name or email,
        token=token,
        refresh_token=refresh_token,
        api_key=api_key,
        registration_source="auto",
        ref_code=ref_code,
        ref_url=ref_url,
        ref_used_count=0,
        ref_max_count=ref_max_count,
        referred_by_id=referred_by_id,
    )
    return account  # type: ignore[return-value]
