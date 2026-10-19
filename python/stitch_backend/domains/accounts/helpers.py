"""Shared helpers for the accounts service."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from stitch_backend.domains.accounts.schemas import AccountResponse

if TYPE_CHECKING:
    from stitch_backend.domains.accounts.models import Account


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_response(
    account: Account,
    caller_uid: int | None = None,
    group_ids: list[str] | None = None,
    group_names: list[str] | None = None,
) -> AccountResponse:
    """Convert an ORM model → Pydantic response DTO.

    Delegates to the ``@model_validator`` on AccountResponse which handles
    datetime→ISO-string, JSON→string, and field-name mismatches.

    When ``caller_uid`` is given, additive ``mine`` and ``shared`` fields
    are set on the response: ``mine`` = account.owner_id == caller_uid,
    ``shared`` = account.owner_id is None.

    When ``group_ids`` / ``group_names`` are given, they are set on the
    response so the frontend can show which groups the account belongs to.
    """
    resp = AccountResponse.model_validate(account)
    if caller_uid is not None:
        resp.mine = (account.owner_id == caller_uid)
        resp.shared = (account.owner_id is None)
    if group_ids is not None:
        resp.group_ids = group_ids
    if group_names is not None:
        resp.group_names = group_names
    return resp
