"""Caller-authorization predicates for legacy account CRUD over gateway credentials."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import select

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import Credential


def _should_mask_secret(credential: Credential, caller_uid: int | None, caller_role: str | None) -> bool:
    """True when the caller must NOT see the raw secret.

    Raw secret visible when:
    - caller is admin, OR
    - credential.owner_id is None AND caller is admin (instance-shared → admin only raw), OR
    - credential.owner_id == caller_uid (own credential).

    Masked when:
    - credential.owner_id is None (instance-shared) and caller is non-admin, OR
    - credential.owner_id is not None and differs from caller_uid.
    """
    if caller_role == "admin":
        return False
    if credential.owner_id is None:
        # Instance-shared: mask for non-admin callers.
        return True
    return credential.owner_id != caller_uid


def _caller_can_modify_credential(
    credential: Credential, caller_uid: int | None, caller_role: str | None,
) -> bool:
    """True when the caller may update/delete *credential*.

    Same authz model as :func:`_should_mask_secret` but for write
    operations:

    - admin → always allowed (also covers desktop where the dispatcher
      sets ``caller_role="admin"``), OR
    - credential.owner_id is None (instance-shared) → admin only
      (non-admin cannot modify shared rows), OR
    - credential.owner_id == caller_uid (own credential).

    Unauthenticated callers (``caller_uid is None``, non-admin role)
    are denied — the command handler guards desktop mode via
    ``auth_enabled`` before calling this helper.
    """
    if caller_role == "admin":
        return True
    if caller_uid is None:
        return False  # auth on but not authenticated → deny
    if credential.owner_id is None:
        return False  # instance-shared → admin only
    return credential.owner_id == caller_uid


async def caller_can_delete_credential(
    session: Any,
    credential: Credential,
    caller_uid: int | None,
    caller_role: str | None,
) -> bool:
    """Deletion policy: delete anything EXCEPT group-shared rows you neither
    added nor administer.

    - app admin → always;
    - unauthenticated (web guest) → never (desktop guests resolve to admin
      upstream via STITCH_DESKTOP_MODE);
    - own credential → yes;
    - not shared into any group → yes (delete anything);
    - shared into a group → only its owner (above), an app admin (above), or
      the owner of a group it is shared into.
    """
    if caller_role == "admin":
        return True
    if caller_uid is None:
        return False
    if credential.owner_id == caller_uid:
        return True

    from sqlalchemy import and_

    from stitch_backend.domains.ai_gateway.models import CredentialGroupShare
    from stitch_backend.domains.groups.models import Group

    shares = (
        await session.execute(
            select(CredentialGroupShare).where(
                CredentialGroupShare.credential_id == credential.id
            )
        )
    ).scalars().all()
    if not shares:
        return True  # not group-shared → free to delete

    group_ids = [s.group_id for s in shares]
    owned = (
        await session.execute(
            select(Group.id).where(
                and_(Group.id.in_(group_ids), Group.owner_id == caller_uid)
            )
        )
    ).first()
    return owned is not None
