"""SQLAlchemy ORM models for the groups domain.

Five tables on the shared :class:`stitch_backend.database.Base`:

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
  - ``group_usage``               — (group_id, user_id, day) composite
    PK.  Both FKs CASCADE.
  - ``group_shares``              — (group_id, resource_type,
    resource_id) composite PK, shared_by (nullable, no FK), created_at.
    Generic resource→group share table (accounts, future resource types).
    ``group_id`` FK CASCADEs; ``resource_type`` is a free-form string
    (``'account'``, …); ``resource_id`` is the stringified PK of the
    shared row.  Non-unique index on ``(resource_type, resource_id)``
    for reverse lookups (which groups is this resource shared into?).

``credential_group_shares`` has moved to
:mod:`stitch_backend.domains.ai_gateway.models` (``CredentialGroupShare``)
to break the ``ai_gateway ↔ groups`` import cycle — the routing engine
needs the share table but the groups domain must not be imported by
``ai_gateway`` at module load time.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
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
# GroupUsage
# ═══════════════════════════════════════════════════════════════════════════


class GroupUsage(Base):
    """Per-member daily usage accounting for a group's shared pool.

    Composite PK ``(group_id, user_id, day)`` — one row per member per day.
    Both FKs CASCADE: deleting a group or a user drops their usage rows.
    ``day`` is ``'YYYY-MM-DD'`` (UTC).

    Superseded by :class:`GroupUsageByModel` (which adds the model
    dimension).  Rows are copied forward at startup; this table is kept
    for history only and is no longer written.
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


# ═══════════════════════════════════════════════════════════════════════════
# GroupUsageByModel — per (member, model, day) usage
# ═══════════════════════════════════════════════════════════════════════════


class GroupUsageByModel(Base):
    """Per-member per-model daily usage for quota enforcement.

    Composite PK ``(group_id, user_id, model, day)``.  ``model`` is the
    *public* model id requested by the caller (``''`` for rows written
    before the model dimension existed).  Pool-wide and all-models totals
    are derived by SUM aggregation — no separate rows are stored.
    """

    __tablename__ = "group_usage_by_model"

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
    model: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        comment="Public model id; '' for pre-migration rows",
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


# ═══════════════════════════════════════════════════════════════════════════
# GroupQuotaRule — flexible per-member / per-pool quota rules
# ═══════════════════════════════════════════════════════════════════════════


class GroupQuotaRule(Base):
    """A single quota rule on a group's shared pool.

    ``subject='member'`` caps each matching member individually
    (``user_id NULL`` = every member); ``subject='pool'`` caps the whole
    group's combined consumption.  ``model`` matches a public model id
    exactly, as a ``'prefix-*'`` glob, or everything when NULL.
    ``amount NULL`` = explicit unlimited (used to override a broader rule
    for a specific member/model).  ``period='daily'`` resets at UTC
    midnight; ``'total'`` sums over all time.
    """

    __tablename__ = "group_quota_rules"
    __table_args__ = (
        Index("ix_group_quota_rules_group", "group_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    subject: Mapped[str] = mapped_column(
        String, nullable=False, default="member",
        comment="member | pool",
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=True,
        comment="member rules only: NULL = every member",
    )
    model: Mapped[str | None] = mapped_column(
        String, nullable=True,
        comment="Public model id, 'prefix-*' glob, or NULL = all models",
    )
    unit: Mapped[str] = mapped_column(
        String, nullable=False, default="requests",
        comment="requests | tokens",
    )
    amount: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="NULL = unlimited (overrides broader rules)",
    )
    period: Mapped[str] = mapped_column(
        String, nullable=False, default="daily",
        comment="daily | total",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<GroupQuotaRule id={self.id!r} group_id={self.group_id!r} "
            f"subject={self.subject!r} user_id={self.user_id} "
            f"model={self.model!r} unit={self.unit!r} amount={self.amount} "
            f"period={self.period!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# GroupShare (generic resource→group share)
# ═══════════════════════════════════════════════════════════════════════════


class GroupShare(Base):
    """Generic resource→group share (accounts, future resource types).

    Composite PK ``(group_id, resource_type, resource_id)`` enforces
    uniqueness — a resource can be shared into a given group at most once.
    ``group_id`` FK CASCADEs (deleting a group drops its shares);
    ``shared_by`` is the user who created the share (nullable, no FK —
    survives even if the user is deleted, since it's informational only).

    A non-unique index on ``(resource_type, resource_id)`` backs the
    reverse lookup "which groups is this resource shared into?" used by
    ``resource_shares()`` and the accounts-list visibility query.
    """

    __tablename__ = "group_shares"
    __table_args__ = (
        Index(
            "ix_group_shares_resource",
            "resource_type",
            "resource_id",
        ),
    )

    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    resource_type: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        comment="account | credential | … (free-form resource type tag)",
    )
    resource_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        comment="Stringified PK of the shared row",
    )
    shared_by: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="User id who created the share (no FK — informational)",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<GroupShare group_id={self.group_id!r} "
            f"resource_type={self.resource_type!r} "
            f"resource_id={self.resource_id!r}>"
        )
