"""SQLAlchemy ORM models for the groups domain.

Four tables on the shared :class:`stitch_backend.database.Base`:

  - ``groups``                    — id PK, name, owner_id FK→auth_users.id
    (CASCADE, NOT NULL), created_at.  Owner is duplicated as a member row
    in ``group_members`` with role='owner'.
  - ``group_members``             — (group_id, user_id) composite PK,
    role 'owner'|'member', joined_at.  Both FKs CASCADE.
  - ``group_invites``             — id PK, group_id FK CASCADE,
    invitee_username, invited_by FK→auth_users, status
    'pending'|'accepted'|'declined'|'revoked', created_at, resolved_at.
    Uniqueness of a pending invite per (group, invitee) is enforced in
    service logic (anti-enumeration + SQLite-friendly).
  - ``credential_group_shares``    — (credential_id, group_id) composite
    PK.  Both FKs CASCADE; credentials survive group deletion because
    only the share row cascades, not the credential itself.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return uuid.uuid4().hex


# ═══════════════════════════════════════════════════════════════════════════
# Group
# ═══════════════════════════════════════════════════════════════════════════


class Group(Base):
    """A named group with pooled AI Gateway keys.

    The creator is the owner (role='owner' in ``group_members``).  Groups
    are deleted when the owner is deleted (``owner_id`` ONDELETE CASCADE).
    """

    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Group dies with owner (cascade); owner is also a member row",
    )
    max_requests_per_member_daily: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Per-member fair-use cap (NULL=unlimited)",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Group id={self.id!r} name={self.name!r} owner_id={self.owner_id}>"


# ═══════════════════════════════════════════════════════════════════════════
# GroupMember
# ═══════════════════════════════════════════════════════════════════════════


class GroupMember(Base):
    """Membership row: (group_id, user_id) with role 'owner'|'member'."""

    __tablename__ = "group_members"

    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String, nullable=False, default="member",
        comment="owner | member",
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<GroupMember group_id={self.group_id!r} user_id={self.user_id} "
            f"role={self.role!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# GroupInvite
# ═══════════════════════════════════════════════════════════════════════════


class GroupInvite(Base):
    """An invitation to join a group.

    Uniqueness of a pending invite per (group_id, invitee_username) is
    enforced in service logic (``groups_invite`` checks before creating).
    """

    __tablename__ = "group_invites"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invitee_username: Mapped[str] = mapped_column(
        String, nullable=False, index=True,
        comment="Normalized username (strip @, lower) of the invitee",
    )
    invited_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending", index=True,
        comment="pending | accepted | declined | revoked",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="When the invite was accepted/declined/revoked",
    )

    def __repr__(self) -> str:
        return (
            f"<GroupInvite id={self.id!r} group_id={self.group_id!r} "
            f"invitee={self.invitee_username!r} status={self.status!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# CredentialGroupShare
# ═══════════════════════════════════════════════════════════════════════════


class CredentialGroupShare(Base):
    """M:N join between a Credential and a Group (the shared pool).

    Both FKs CASCADE: deleting a group drops its shares (credentials
    survive); deleting a credential drops its shares (group pool shrinks).
    """

    __tablename__ = "credential_group_shares"

    credential_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_credentials.id", ondelete="CASCADE"),
        primary_key=True,
    )
    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<CredentialGroupShare credential_id={self.credential_id!r} "
            f"group_id={self.group_id!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# GroupUsage
# ═══════════════════════════════════════════════════════════════════════════


class GroupUsage(Base):
    """Per-member daily usage accounting for a group's shared pool.

    Composite PK ``(group_id, user_id, day)`` — one row per member per day.
    Both FKs CASCADE: deleting a group or a user drops their usage rows.
    ``day`` is ``'YYYY-MM-DD'`` (UTC).
    """

    __tablename__ = "group_usage"

    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    day: Mapped[str] = mapped_column(
        String(10),
        primary_key=True,
        comment="YYYY-MM-DD (UTC)",
    )
    requests: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0,
    )
    tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0,
    )

    def __repr__(self) -> str:
        return (
            f"<GroupUsage group_id={self.group_id!r} user_id={self.user_id} "
            f"day={self.day!r} requests={self.requests} tokens={self.tokens}>"
        )
