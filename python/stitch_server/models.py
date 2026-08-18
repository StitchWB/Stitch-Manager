"""ORM models for the plugin distribution server.

Tables: tokens, activation_codes, devices, plugins, plugin_versions,
plugin_variants, deprecations, reports, selector_packs, server_settings.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from stitch_server.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Token(Base):
    """An activation token. The raw token is returned once at activation;
    only its sha256 hash is stored."""

    __tablename__ = "ss_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    entitlements: Mapped[list] = mapped_column(JSON, default=list)
    revoked: Mapped[bool] = mapped_column(default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ActivationCode(Base):
    """One-time activation code issued by the TG bot (or admin API).

    The raw code is a 128-bit hex string (32 chars) returned ONCE at
    issuance; only its sha256 hex digest is persisted in ``code_hash``.
    Consumed on first use; second use is refused (409).

    Attribution: ``tg_user_id`` (BigInteger — TG ids exceed 32-bit) and
    ``label`` record who/why a code was issued.  ``expires_at`` is NULL
    for no-expiration codes (``ttl_minutes=0`` at issuance); otherwise
    it is the cutoff after which activation is refused (403 expired).
    ``revoked`` marks a code disabled by an admin before use; revoked
    codes cannot be activated (403 revoked).
    """

    __tablename__ = "ss_activation_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    entitlements: Mapped[list] = mapped_column(JSON, default=lambda: ["*"])
    used: Mapped[bool] = mapped_column(default=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_id: Mapped[int | None] = mapped_column(ForeignKey("ss_tokens.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # ── Attribution + lifecycle (added by hardening pass) ────────────────────
    # NULL → no expiration (ttl_minutes=0 at issuance); otherwise the cutoff
    # after which POST /activate refuses with 403 "Activation code expired".
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    # True when an admin revokes an UNUSED code (POST /admin/revoke-code).
    # Revoked codes cannot be activated (403 "Activation code revoked").
    revoked: Mapped[bool] = mapped_column(default=False, index=True)
    # Telegram user id of the issuer/recipient (BigInteger — TG ids exceed
    # 32-bit signed int range).  NULL for codes issued without attribution.
    tg_user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    # Free-form label (e.g. "channel-drop-2026-08") for correlation.
    label: Mapped[str | None] = mapped_column(String)
    # True when the code was issued by a TG admin (tg_user_id in
    # settings.admin_ids).  Propagated to /activate response so the web
    # backend can promote the local user to role=admin (PROMOTE ONLY).
    tg_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Device(Base):
    """A device (hwid) registered against a token. The device limit is
    enforced per token (default 3, configurable)."""

    __tablename__ = "ss_devices"
    __table_args__ = (UniqueConstraint("token_id", "hwid", name="uq_token_hwid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_id: Mapped[int] = mapped_column(ForeignKey("ss_tokens.id"), index=True)
    hwid: Mapped[str] = mapped_column(String, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Plugin(Base):
    """A plugin package (e.g. kiro-autoreg)."""

    __tablename__ = "ss_plugins"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    current_version: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PluginVersion(Base):
    """A specific version of a plugin, with its pre-signed package and
    rollout percentage (0=staged, 10=canary, 100=full)."""

    __tablename__ = "ss_plugin_versions"
    __table_args__ = (
        UniqueConstraint("plugin_id", "version", name="uq_plugin_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[str] = mapped_column(ForeignKey("ss_plugins.id"), index=True)
    version: Mapped[str] = mapped_column(String, index=True)
    rollout_percent: Mapped[int] = mapped_column(Integer, default=0)
    package_path: Mapped[str] = mapped_column(String)
    package_sha256: Mapped[str] = mapped_column(String(64))
    package_signature: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Deprecation(Base):
    """Kill-switch entry: deprecates a versions_spec for a plugin
    (e.g. '<=1.2.3'). Surfaced in the manifest deprecated list."""

    __tablename__ = "ss_deprecations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[str] = mapped_column(ForeignKey("ss_plugins.id"), index=True)
    versions_spec: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Report(Base):
    """An artifact bundle (crash/telemetry) stored on disk with indexed
    metadata."""

    __tablename__ = "ss_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_id: Mapped[int | None] = mapped_column(ForeignKey("ss_tokens.id"), index=True)
    plugin_id: Mapped[str] = mapped_column(String, index=True)
    version: Mapped[str] = mapped_column(String, index=True)
    step: Mapped[str] = mapped_column(String, index=True)
    bundle_path: Mapped[str] = mapped_column(String)
    bundle_format: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SelectorPack(Base):
    """A selector overlay pack for a plugin@version (plan §8).

    Hot selector updates shipped WITHOUT a plugin version bump. Each pack
    carries a per-(plugin_id, version) monotonic ``selectors_version`` and
    the sha256 of its canonical-JSON ``payload``. The manifest exposes the
    latest pack's version + sha for each plugin entry so clients can decide
    whether to fetch a new overlay.
    """

    __tablename__ = "ss_selector_packs"
    __table_args__ = (
        UniqueConstraint(
            "plugin_id", "version", "selectors_version", name="uq_pack_version"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[str] = mapped_column(String, index=True)
    version: Mapped[str] = mapped_column(String, index=True)
    selectors_version: Mapped[int] = mapped_column(Integer, index=True)
    payload: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PluginVariant(Base):
    """A watermarked variant of a plugin version (plan §3.2 item 7).

    When the publish pipeline generates N variants (each with a unique
    honeypot selector marker + its own valid ed25519 signature), each
    variant is stored as a row here.  The server selects which variant
    to serve per-token via ``int(token.token_hash, 16) % N`` — a
    deterministic mapping that is stable across syncs for the same token
    but distributes different variants across the user base.

    When no variants exist for a plugin version, the server falls back
    to ``PluginVersion.package_path`` (legacy / non-watermarked path).
    """

    __tablename__ = "ss_plugin_variants"
    __table_args__ = (
        UniqueConstraint("plugin_version_id", "idx", name="uq_variant_idx"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_version_id: Mapped[int] = mapped_column(
        ForeignKey("ss_plugin_versions.id"), index=True
    )
    idx: Mapped[int] = mapped_column(Integer, index=True)
    package_path: Mapped[str] = mapped_column(String)
    package_sha256: Mapped[str] = mapped_column(String(64))
    package_signature: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ServerSetting(Base):
    """Mutable server settings (key-value). Overrides config defaults."""

    __tablename__ = "ss_server_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
