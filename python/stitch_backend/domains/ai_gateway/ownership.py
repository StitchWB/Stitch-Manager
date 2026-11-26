"""Ownership semantics and data migrations for AI Gateway resources."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from sqlalchemy import update

from stitch_backend.config import get_settings
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    ProviderEndpoint,
    PublicModel,
)

if TYPE_CHECKING:
    from sqlalchemy.engine import CursorResult
    from sqlalchemy.ext.asyncio import AsyncSession


def owner_uid_for_create(caller_uid: int | None) -> int | None:
    """Owner to stamp on a newly created gateway row.

    Desktop mode is a single-user machine trust domain even when the operator
    is logged in: the login identifies the operator/account, but it is not a
    routing boundary.  New rows therefore default to instance-shared
    (``owner_id=NULL``) so machine-scoped install keys can serve what the
    desktop UI just saved.  Hosted mode (``desktop_mode=False``) keeps strict
    authenticated-user ownership for multi-user isolation.
    """
    if caller_uid is not None and get_settings().desktop_mode:
        return None
    return caller_uid


async def backfill_desktop_instance_shared(session: AsyncSession) -> dict[str, int]:
    """Make pre-existing desktop gateway rows instance-shared.

    Desktop backends are a single-user trust domain.  Rows written before the
    desktop creation semantic was corrected could nevertheless carry the
    operator's authenticated user id, which made them invisible to machine-
    scoped install keys.  This one-time backfill clears those owners.  It is
    invoked only when ``desktop_mode`` is enabled; hosted multi-user backends
    never run it.
    """
    models: tuple[
        tuple[str, type[ProviderEndpoint] | type[Credential] | type[PublicModel]],
        ...,
    ] = (
        ("endpoints", ProviderEndpoint),
        ("credentials", Credential),
        ("public_models", PublicModel),
    )
    counts: dict[str, int] = {}
    for key, model in models:
        result = cast(
            "CursorResult",
            await session.execute(
                update(model)
                .where(model.owner_id.is_not(None))
                .values(owner_id=None)
            ),
        )
        counts[key] = max(result.rowcount or 0, 0)
    await session.flush()
    return counts
