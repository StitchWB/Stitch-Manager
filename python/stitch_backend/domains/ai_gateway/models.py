"""AI Gateway SQLAlchemy ORM models — unified provider/credential/model catalog.

This is the single source of truth for everything the native AI gateway needs
to route a request: which endpoints exist, which credentials belong to them,
which upstream models each credential can actually reach, and what publicly
exposed model aliases resolve to which upstream targets.

Bounded-context entities (see architecture discussion — Stage 1):

    ProviderEndpoint
        A concrete API instance (not just "OpenAI" but "OpenAI production",
        "My self-hosted vLLM", "DashScope Singapore", ...). ``adapter_type``
        selects the protocol implementation from ``domains/ai_gateway/adapters/``.

    Credential
        One concrete authorization against a ``ProviderEndpoint``. Operational
        metadata only (status, retry timers, failure counts) — the actual
        secret lives in ``CredentialSecret`` so health/listing queries never
        need to touch (or accidentally leak) it.

    CredentialSecret
        1:1 with ``Credential``. Isolated so secret values never show up in
        joins used for health/monitoring/listing.

    UpstreamModel
        A model as it exists on one specific ``ProviderEndpoint``. The same
        model name on two different endpoints is two different rows — no
        model is assumed canonical across endpoints.

    CredentialModelAccess
        Many-to-many: which credentials can actually reach which upstream
        models, and with what verified status. This is what makes "ключ A
        видит Qwen, ключ B не видит" representable.

    PublicModel
        The stable, user-facing model alias exposed by Stitch's own
        OpenAI-compatible surface (``/v1/models``, chat completions, ...).

    RouteTarget
        Ordered/weighted mapping from a ``PublicModel`` to the
        ``UpstreamModel`` candidates that can serve it, with priority/weight
        for the routing engine (built in a later stage).

Naming/columns follow the conventions in ``domains/accounts/models.py`` and
``domains/key_health/models.py`` (``Mapped`` columns, ``JSON`` type for free
-form bags, a shared ``_utcnow`` default helper, docstring comments per
column group).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base
from stitch_backend.security.fernet_at_rest import EncryptedText


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return uuid.uuid4().hex


# ═══════════════════════════════════════════════════════════════════════════
# ProviderEndpoint
# ═══════════════════════════════════════════════════════════════════════════

class ProviderEndpoint(Base):
    """A concrete, addressable API instance — not a generic provider name.

    Two endpoints can share the same ``adapter_type`` (e.g. two
    ``openai_compatible`` endpoints with different ``base_url``s), so
    "adding a new provider" for anything OpenAI-compatible never requires a
    code change — only a new row here.
    """

    __tablename__ = "ai_gateway_provider_endpoints"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(
        String, nullable=False, comment='User-facing label, e.g. "Fireworks main"',
    )
    adapter_type: Mapped[str] = mapped_column(
        String, nullable=False, index=True,
        comment="Protocol adapter key: openai_compatible | anthropic | gemini | kiro | ...",
    )
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_headers: Mapped[dict | None] = mapped_column(
        JSON, comment="Extra headers sent with every request to this endpoint",
    )
    discovery_policy: Mapped[dict | None] = mapped_column(
        JSON,
        comment=(
            "How to discover models on this endpoint, e.g. "
            '{"mode": "list_models_endpoint", "path": "/v1/models"} '
            'or {"mode": "manual"}'
        ),
    )
    health_policy: Mapped[dict | None] = mapped_column(
        JSON,
        comment=(
            "Adapter-specific health-check policy overrides, e.g. "
            '{"probe_path": "/v1/models", "interval_seconds": 300}'
        ),
    )
    # ── Circuit breaker (endpoint-level, distinct from per-credential state) ──
    circuit_state: Mapped[str] = mapped_column(
        String, default="closed", comment="closed | open | half_open",
    )
    circuit_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    circuit_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Earliest time to probe half_open",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )
    # ── Owner (per-user isolation) ───────────────────────────────────────────
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="NULL = shared pool (legacy, visible to all callers)",
    )

    def __repr__(self) -> str:
        return f"<ProviderEndpoint id={self.id!r} name={self.name!r} adapter={self.adapter_type!r}>"


# ═══════════════════════════════════════════════════════════════════════════
# Credential
# ═══════════════════════════════════════════════════════════════════════════

class Credential(Base):
    """One authorization against a ``ProviderEndpoint`` — operational state only.

    The secret itself lives in :class:`CredentialSecret`. This table is safe
    to join into health/monitoring/listing queries without ever exposing a
    raw key.
    """

    __tablename__ = "ai_gateway_credentials"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    provider_endpoint_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_provider_endpoints.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    label: Mapped[str | None] = mapped_column(
        String, comment="User-facing label, e.g. \"team key #3\"",
    )
    auth_type: Mapped[str] = mapped_column(
        String, nullable=False, default="api_key",
        comment="api_key | oauth | session",
    )
    fingerprint: Mapped[str] = mapped_column(
        String, nullable=False, unique=True,
        comment="SHA256(endpoint_id + '\\0' + secret) — dedup key, never the raw secret",
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # ── Runtime state machine ───────────────────────────────────────────────
    runtime_status: Mapped[str] = mapped_column(
        String, default="unknown",
        comment=(
            "unknown | active | cooldown | rate_limited | quota_exhausted | "
            "auth_failed | degraded | disabled"
        ),
    )
    status_reason: Mapped[str | None] = mapped_column(Text)
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Earliest retry time (from Retry-After, backoff, etc.)",
    )
    quota_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )
    # ── Owner (per-user isolation) ───────────────────────────────────────────
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="NULL = shared pool (legacy, visible to all callers)",
    )

    def __repr__(self) -> str:
        return (
            f"<Credential id={self.id!r} endpoint={self.provider_endpoint_id!r} "
            f"status={self.runtime_status!r}>"
        )


class CredentialSecret(Base):
    """1:1 secret storage for a :class:`Credential`, isolated from operational state.

    Kept in its own table (rather than a column on ``Credential``) so that
    any query selecting operational/health columns for display or routing
    decisions structurally cannot pull the secret along with it.
    """

    __tablename__ = "ai_gateway_credential_secrets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    credential_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_credentials.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    # ponytail: encrypted at rest via EncryptedText TypeDecorator (Fernet).
    # Previously plaintext — see plan §3.5 decision 13.  Swap the key
    # (TOKEN_ENCRYPTION_KEY env or .db_key file) and all values become
    # unreadable; back up the key before rotating.
    secret_value: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    secret_type: Mapped[str] = mapped_column(
        String, default="api_key", comment="api_key | oauth_access_token | session_token",
    )
    refresh_token: Mapped[str | None] = mapped_column(Text, comment="OAuth refresh token, if any")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )

    def __repr__(self) -> str:
        return f"<CredentialSecret credential_id={self.credential_id!r}>"


# ═══════════════════════════════════════════════════════════════════════════
# UpstreamModel
# ═══════════════════════════════════════════════════════════════════════════

class UpstreamModel(Base):
    """A model as it exists on one specific ``ProviderEndpoint``.

    Identical upstream model IDs on two different endpoints are two
    different rows here — capability data is never assumed to transfer
    across endpoints.
    """

    __tablename__ = "ai_gateway_upstream_models"
    __table_args__ = (
        UniqueConstraint(
            "provider_endpoint_id", "upstream_model_id",
            name="uq_upstream_model_per_endpoint",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    provider_endpoint_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_provider_endpoints.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    upstream_model_id: Mapped[str] = mapped_column(
        String, nullable=False,
        comment="Exact string to send upstream, e.g. accounts/fireworks/models/qwen2p5-vl-72b-instruct",
    )
    display_name: Mapped[str | None] = mapped_column(String)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    discovery_source: Mapped[str] = mapped_column(
        String, default="manual",
        comment="manual | probe | litellm_catalog",
    )
    last_discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ── Capabilities ─────────────────────────────────────────────────────────
    # Each boolean capability is tri-state (True/False/unknown-via-NULL) and
    # is always accompanied by where the value came from and when it was
    # last confirmed, per the agreed "capabilities are per-deployment, not
    # per-model-name" design.
    capabilities: Mapped[dict | None] = mapped_column(
        JSON,
        comment=(
            "Capability bag, e.g. {"
            '"supports_vision": true, "supports_function_calling": true, '
            '"supports_reasoning": false, "supports_streaming": true, '
            '"supports_json_mode": true, "max_input_tokens": 128000, '
            '"max_output_tokens": 8192, '
            '"source": "manual|probe|provider_metadata|litellm_catalog|heuristic", '
            '"verified_at": "2026-01-01T00:00:00Z", '
            '"extra": {}}  — "extra" is a free-form bag for capabilities not '
            "yet modeled as first-class fields."
        ),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )

    def __repr__(self) -> str:
        return (
            f"<UpstreamModel id={self.id!r} endpoint={self.provider_endpoint_id!r} "
            f"model={self.upstream_model_id!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# CredentialModelAccess (many-to-many)
# ═══════════════════════════════════════════════════════════════════════════

class CredentialModelAccess(Base):
    """Whether a specific credential can reach a specific upstream model.

    This is the join table that makes per-key model visibility representable
    — e.g. "key A on Fireworks can see Qwen, key B on Fireworks cannot".
    """

    __tablename__ = "ai_gateway_credential_model_access"
    __table_args__ = (
        UniqueConstraint(
            "credential_id", "upstream_model_id",
            name="uq_credential_model_access",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    credential_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_credentials.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    upstream_model_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_upstream_models.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    status: Mapped[str] = mapped_column(
        String, default="unknown",
        comment="unknown | available | denied | temporarily_unavailable",
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )

    def __repr__(self) -> str:
        return (
            f"<CredentialModelAccess credential={self.credential_id!r} "
            f"model={self.upstream_model_id!r} status={self.status!r}>"
        )


# ═══════════════════════════════════════════════════════════════════════════
# PublicModel
# ═══════════════════════════════════════════════════════════════════════════

class PublicModel(Base):
    """A stable, user-facing model alias exposed by Stitch's own API.

    ``id`` is a user-chosen slug (e.g. ``"vision-best"``), not a generated
    UUID, because it doubles as the literal string clients pass as
    ``model`` when calling Stitch's OpenAI-compatible endpoints.
    """

    __tablename__ = "ai_gateway_public_models"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, comment="Slug used as the public `model` value, e.g. vision-best",
    )
    display_name: Mapped[str | None] = mapped_column(String)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    contract: Mapped[dict | None] = mapped_column(
        JSON,
        comment=(
            "Guarantees this public model promises callers, e.g. "
            '{"inputModalities": ["text", "image"], "tools": true, '
            '"streaming": true, "minContextTokens": 64000}'
        ),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )
    # ── Owner (per-user isolation) ───────────────────────────────────────────
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="NULL = shared pool (legacy, visible to all callers)",
    )

    def __repr__(self) -> str:
        return f"<PublicModel id={self.id!r} enabled={self.enabled!r}>"


# ═══════════════════════════════════════════════════════════════════════════
# RouteTarget
# ═══════════════════════════════════════════════════════════════════════════

class RouteTarget(Base):
    """Ordered/weighted candidate upstream model for a ``PublicModel``.

    Credentials are deliberately NOT referenced here — the routing engine
    picks a specific credential at request time via
    :class:`CredentialModelAccess`, so a route target says "which upstream
    model", not "which specific key".
    """

    __tablename__ = "ai_gateway_route_targets"
    __table_args__ = (
        UniqueConstraint(
            "public_model_id", "upstream_model_id",
            name="uq_route_target",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_model_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_public_models.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    upstream_model_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("ai_gateway_upstream_models.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(
        Integer, default=100, comment="Lower = tried first",
    )
    weight: Mapped[float] = mapped_column(
        Float, default=1.0, comment="Relative weight within the same priority tier",
    )
    cost_modifier: Mapped[float] = mapped_column(
        Float, default=1.0, comment="Multiplier applied to cost-aware routing decisions",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )

    def __repr__(self) -> str:
        return (
            f"<RouteTarget public={self.public_model_id!r} "
            f"upstream={self.upstream_model_id!r} priority={self.priority!r}>"
        )
