"""Account SQLAlchemy ORM model — single source of truth.

Field groups:
  - Base             (id, email, password, provider, status, display_name, timestamps)
  - Tokens           (token, refresh_token, expires_at, token_type, kiro_*, api_key)
  - Machine          (machine_id, patch_config, hardware_fingerprint)
  - Browser          (profile_path, cookies, session_data, fingerprint, user_agent)
  - Proxy            (proxy_id, proxy_config)
  - Provider Meta    (provider_metadata — JSON bag for provider-specific extras, e.g.
                      Kiro v2/v3 client_id + client_secret)
  - Meta             (notes, tags, use_count, success_rate, last_used_at, last_checked_at,
                      registration_source)
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base
from stitch_backend.security.fernet_at_rest import EncryptedText


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Account(Base):
    """Single source of truth for every managed account."""

    __tablename__ = "accounts"

    # ═══════ Base ═══════════════════════════════════════════════════════════
    id: Mapped[str] = mapped_column(
        String, primary_key=True, comment="UUID"
    )
    email: Mapped[str] = mapped_column(
        String, nullable=False, index=True
    )
    password: Mapped[str | None] = mapped_column(
        EncryptedText, comment="Encrypted at rest"
    )
    provider: Mapped[str] = mapped_column(
        String, nullable=False, index=True, comment="kiro, windsurf, openai, ..."
    )
    status: Mapped[str] = mapped_column(
        String, default="active", comment="active|disabled|expired|banned|pending"
    )
    display_name: Mapped[str | None] = mapped_column(
        String, comment="User-friendly label"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow
    )

    # ═══════ Tokens ═════════════════════════════════════════════════════════
    token: Mapped[str | None] = mapped_column(
        EncryptedText, comment="Primary access token"
    )
    refresh_token: Mapped[str | None] = mapped_column(
        EncryptedText, comment="OAuth refresh token"
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Token expiration"
    )
    token_type: Mapped[str | None] = mapped_column(
        String, comment="bearer, api_key, ..."
    )
    kiro_session_id: Mapped[str | None] = mapped_column(
        String, comment="Kiro-specific session ID"
    )
    kiro_device_id: Mapped[str | None] = mapped_column(
        String, comment="Kiro device binding"
    )
    api_key: Mapped[str | None] = mapped_column(
        EncryptedText, comment="For API-key providers (OpenAI, Fireworks)"
    )

    # ═══════ Machine ════════════════════════════════════════════════════════
    machine_id: Mapped[str | None] = mapped_column(
        String, comment="Generated machine UUID for IDE binding"
    )
    patch_config: Mapped[dict | None] = mapped_column(
        JSON, comment="IDE-specific patch metadata"
    )
    hardware_fingerprint: Mapped[str | None] = mapped_column(
        String, comment="HWID for device binding"
    )

    # ═══════ Browser ════════════════════════════════════════════════════════
    profile_path: Mapped[str | None] = mapped_column(
        String, comment="Browser profile directory on disk"
    )
    cookies: Mapped[str | None] = mapped_column(
        EncryptedText, comment="JSON-serialised cookies"
    )
    session_data: Mapped[str | None] = mapped_column(
        EncryptedText, comment="localStorage / sessionStorage dump"
    )
    fingerprint: Mapped[dict | None] = mapped_column(
        JSON, comment="Browser fingerprint config (UA, WebGL, canvas, ...)"
    )
    user_agent: Mapped[str | None] = mapped_column(
        String, comment="Custom User-Agent string"
    )
    browser_engine: Mapped[str | None] = mapped_column(
        String,
        comment="Engine the account was registered/opened with: cloakbrowser|shardbrowser",
    )
    shard_profile_id: Mapped[str | None] = mapped_column(
        String,
        comment="ShardX saved profile id (persistent fingerprint + cookies)",
    )

    # ═══════ Proxy ══════════════════════════════════════════════════════════
    proxy_id: Mapped[str | None] = mapped_column(
        String, comment="FK → proxy_library.id"
    )
    proxy_config: Mapped[dict | None] = mapped_column(
        JSON, comment="Override proxy settings for this account"
    )

    # ═══════ Meta ═══════════════════════════════════════════════════════════
    notes: Mapped[str | None] = mapped_column(
        Text, comment="Free-form user notes"
    )
    tags: Mapped[list | None] = mapped_column(
        JSON, default=list, comment='["premium", "backup", ...]'
    )
    use_count: Mapped[int] = mapped_column(
        Integer, default=0, comment="Times used for LLM requests"
    )
    success_rate: Mapped[float] = mapped_column(
        Float, default=1.0, comment="0.0–1.0 rolling success ratio"
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last successful LLM use"
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last health check"
    )
    registration_source: Mapped[str | None] = mapped_column(
        String, comment="manual | auto | import"
    )

    # ═══════ Owner (per-user isolation) ═════════════════════════════════════
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="NULL = shared pool (legacy, visible to all callers)",
    )

    # ═══════ Quota ═════════════════════════════════════════════════════════
    quota_used: Mapped[int] = mapped_column(
        Integer, default=0, comment="Provider quota used (credits/tokens)"
    )
    quota_limit: Mapped[int] = mapped_column(
        Integer, default=0, comment="Provider quota limit (0 = unknown)"
    )
    quota_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last time quota was fetched from provider"
    )

    # ═══════ Usage stats ═════════════════════════════════════════════════════
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last successful login (profile session confirm)"
    )
    login_count: Mapped[int] = mapped_column(
        Integer, default=0, comment="Total successful logins"
    )
    error_count: Mapped[int] = mapped_column(
        Integer, default=0, comment="Total failed check/refresh attempts"
    )
    last_error: Mapped[str | None] = mapped_column(
        Text, comment="Last error message from a failed check/refresh"
    )

    # ═══════ Referral (v0 quota system) ═════════════════════════════════════
    ref_code: Mapped[str | None] = mapped_column(
        String, comment="Referral code granted to this account"
    )
    ref_url: Mapped[str | None] = mapped_column(
        Text, comment="Full referral invite URL"
    )
    ref_used_count: Mapped[int] = mapped_column(
        Integer, default=0, comment="How many signups used this account as donor"
    )
    ref_max_count: Mapped[int] = mapped_column(
        Integer, default=40, comment="Referral cap before donor is exhausted"
    )
    referred_by_id: Mapped[str | None] = mapped_column(
        String, comment="FK → accounts.id of the donor that referred this account"
    )

    # ═══════ Cooldown ═══════════════════════════════════════════════════════
    cooldown_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="When this account becomes selectable again after a failure (UTC)",
    )

    # ═══════ Provider Metadata ══════════════════════════════════════════════
    provider_metadata: Mapped[dict | None] = mapped_column(
        JSON,
        comment=(
            "Provider-specific extras stored as JSON. "
            "For Kiro v2/v3: {client_id, client_secret, region}. "
            "Keys match provider_metadata in AccountResponse / generated.ts."
        ),
    )

    # ── Repr ─────────────────────────────────────────────────────────────────

    def __repr__(self) -> str:
        return (
            f"<Account id={self.id!r} provider={self.provider!r} "
            f"email={self.email!r} status={self.status!r}>"
        )
