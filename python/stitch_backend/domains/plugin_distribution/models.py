"""Plugin entitlement grant ORM models.

Four tables on the shared :class:`stitch_backend.database.Base`:

  - ``role_plugin_grants``  — composite PK ``(role, plugin_id)``.  A row
    means *role* is granted *plugin_id*.  ``"*"`` means all plugins.
  - ``user_plugin_grants``  — composite PK ``(user_id, plugin_id)``.
    Per-user override: ``granted=True`` adds, ``granted=False`` revokes
    (wins over a role grant).  FK → ``auth_users.id`` CASCADE.
  - ``group_plugin_grants`` — composite PK ``(group_id, plugin_id)``.
    A row means every member of *group_id* is granted *plugin_id*
    (additive on top of role grants).  FK → ``groups.id`` CASCADE.
  - ``plugin_grant_audit``  — append-only audit log of every grant/revoke
    /seed action, with ``admin_user_id``, ``action``, ``scope``,
    ``target``, ``plugin_id``, ``granted``.

Grants are version-independent (keyed by plugin id, not version).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RolePluginGrant(Base):
    """A (role, plugin_id) grant — role-level entitlement.

    Composite PK ``(role, plugin_id)``.  ``plugin_id == "*"`` means the
    role is entitled to all plugins.  ``role == "admin"`` is always
    treated as ``{"*"}`` by the entitlement service regardless of rows
    here (hard rule), but explicit rows may still be stored for audit.
    """

    __tablename__ = "role_plugin_grants"

    role: Mapped[str] = mapped_column(
        String, primary_key=True, nullable=False, comment="Role name (user/vip/...)"
    )
    plugin_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        comment="Plugin package id or '*' for all",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        comment="Admin user id who last touched this row",
    )

    def __repr__(self) -> str:
        return (
            f"<RolePluginGrant role={self.role!r} plugin_id={self.plugin_id!r}>"
        )


class UserPluginGrant(Base):
    """A per-user (user_id, plugin_id) override.

    Composite PK ``(user_id, plugin_id)``.  ``granted=True`` adds the
    plugin on top of the role grant set; ``granted=False`` revokes it
    (wins over a role grant).  FK → ``auth_users.id`` CASCADE so deleting
    a user drops their overrides.
    """

    __tablename__ = "user_plugin_grants"

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    plugin_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        comment="Plugin package id or '*' for all",
    )
    granted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        comment="True = add; False = revoke (wins over role grant)",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        comment="Admin user id who last touched this row",
    )

    def __repr__(self) -> str:
        return (
            f"<UserPluginGrant user_id={self.user_id} "
            f"plugin_id={self.plugin_id!r} granted={self.granted}>"
        )


class GroupPluginGrant(Base):
    """A (group_id, plugin_id) grant — every member of the group is entitled.

    Composite PK ``(group_id, plugin_id)``.  Additive on top of role grants:
    a user belonging to the group gains the plugin.  Per-user revocation via
    :class:`UserPluginGrant` (``granted=False``) still wins.  FK →
    ``groups.id`` CASCADE so deleting a group drops its plugin grants.
    """

    __tablename__ = "group_plugin_grants"

    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    plugin_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        comment="Plugin package id or '*' for all",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        comment="Admin user id who last touched this row",
    )

    def __repr__(self) -> str:
        return (
            f"<GroupPluginGrant group_id={self.group_id!r} "
            f"plugin_id={self.plugin_id!r}>"
        )


class PluginGrantAudit(Base):
    """Append-only audit log for every grant/revoke/seed action.

    ``action``  ∈ {'grant', 'revoke', 'seed'}.
    ``scope``   ∈ {'role', 'user', 'group'}.
    ``target``  — role name (scope='role'), ``str(user_id)`` (scope='user'),
      or ``group_id`` (scope='group').
    ``granted`` — True/False for user overrides; NULL for role/group grants
      (role/group grants are always additive, so the boolean is meaningless).
    """

    __tablename__ = "plugin_grant_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    admin_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        comment="Admin who performed the action (NULL for seed/env)",
    )
    action: Mapped[str] = mapped_column(
        String, nullable=False, comment="'grant'/'revoke'/'seed'"
    )
    scope: Mapped[str] = mapped_column(
        String, nullable=False, comment="'role'/'user'"
    )
    target: Mapped[str] = mapped_column(
        Text, nullable=False, comment="Role name or str(user_id)"
    )
    plugin_id: Mapped[str] = mapped_column(
        String, nullable=False, comment="Plugin package id or '*'"
    )
    granted: Mapped[bool | None] = mapped_column(
        Boolean,
        nullable=True,
        comment="True/False for user overrides; NULL for role grants",
    )

    def __repr__(self) -> str:
        return (
            f"<PluginGrantAudit id={self.id} action={self.action!r} "
            f"scope={self.scope!r} target={self.target!r} "
            f"plugin_id={self.plugin_id!r}>"
        )
