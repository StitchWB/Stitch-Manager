"""Phase 2 role catalog: virtual rb/* public models and desired chain materialization."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    DEFAULT_ROLE_CHAIN_SPECS,
    PROVEN_LIVE_MODELS,
    REFORMBOSS_BASE_URL,
    RETIRED_UPSTREAM_MODELS,
    RoleCatalogService,
)
from stitch_backend.domains.auth.models import User

_DOMAIN_TABLES = [
    User.__table__,
    ProviderEndpoint.__table__,
    Credential.__table__,
    UpstreamModel.__table__,
    CredentialModelAccess.__table__,
    PublicModel.__table__,
    RoleChainEntry.__table__,
    RouteTarget.__table__,
]

HARD_EXCLUSIONS = {
    "glm-5.3-flash",
    "minimax-m3.1-flash",
    "muse-ember",
    "claude-opus-5-5",
    "qwen4-max",
    "gemini-3.8-flash",
}


@pytest.fixture
async def db_session(tmp_path: Path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'role_catalog.db'}",
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(sync_conn, tables=_DOMAIN_TABLES),
        )
    async with factory() as session:
        yield session
    await engine.dispose()


async def _add_endpoint(
    session,
    *,
    base_url: str = REFORMBOSS_BASE_URL,
    health_policy: dict | None = None,
) -> ProviderEndpoint:
    endpoint = ProviderEndpoint(
        name="ReformBoss",
        adapter_type="openai_compatible",
        base_url=base_url,
        enabled=True,
        health_policy=health_policy,
        owner_id=None,
        created_at=_utcnow(),
    )
    session.add(endpoint)
    await session.flush()
    return endpoint


async def _add_credential(session, endpoint: ProviderEndpoint, label: str = "key") -> Credential:
    credential = Credential(
        provider_endpoint_id=endpoint.id,
        label=label,
        auth_type="api_key",
        fingerprint=f"fp-{endpoint.id}-{label}",
        enabled=True,
        runtime_status="active",
        owner_id=None,
        created_at=_utcnow(),
    )
    session.add(credential)
    await session.flush()
    return credential


def _chain_length() -> int:
    return sum(len(chain) for chain in DEFAULT_ROLE_CHAIN_SPECS.values())


def test_default_role_chain_specs_match_product_input() -> None:
    assert list(DEFAULT_ROLE_CHAIN_SPECS) == [
        "rb/lead",
        "rb/planner",
        "rb/researcher",
        "rb/builder",
        "rb/builder-fast",
        "rb/reviewer-correctness",
        "rb/reviewer-adversarial",
        "rb/verifier",
        "rb/small",
    ]
    assert [step[0] for step in DEFAULT_ROLE_CHAIN_SPECS["rb/lead"]] == [
        "gemini-4-carbon", "deepseek-v4-pro", "glm-5.3",
    ]
    assert [step[0] for step in DEFAULT_ROLE_CHAIN_SPECS["rb/researcher"]] == [
        "deepseek-v4-pro", "qwen3.8-max", "glm-5.3", "gpt-6-luna",
    ]
    assert [step[0] for step in DEFAULT_ROLE_CHAIN_SPECS["rb/builder-fast"]] == [
        "deepseek-v4.1-flash", "gpt-6-luna", "glm-5.3",
    ]
    assert [step[0] for step in DEFAULT_ROLE_CHAIN_SPECS["rb/small"]] == [
        "deepseek-v4.1-flash", "glm-5.3",
    ]

    all_upstreams = {
        upstream for chain in DEFAULT_ROLE_CHAIN_SPECS.values() for upstream, _family in chain
    }
    assert HARD_EXCLUSIONS.isdisjoint(all_upstreams)
    assert "effort" not in " ".join(sorted(all_upstreams))

    families = {
        upstream: family
        for chain in DEFAULT_ROLE_CHAIN_SPECS.values()
        for upstream, family in chain
    }
    assert families["deepseek-v4-pro"] == "deepseek"
    assert families["deepseek-v4.1-flash"] == "deepseek"
    assert families["glm-5.3"] == "zhipu"
    assert families["gemini-4-carbon"] == "google"
    assert families["gpt-6-luna"] == "openai"
    assert families["claude-fable-5-2"] == "anthropic"
    assert families["qwen3.8-max"] == "qwen"

    # Product invariant: builder and the two reviewers start in different families.
    assert DEFAULT_ROLE_CHAIN_SPECS["rb/builder"][0][1] == "zhipu"
    assert DEFAULT_ROLE_CHAIN_SPECS["rb/reviewer-correctness"][0][1] == "google"
    assert DEFAULT_ROLE_CHAIN_SPECS["rb/reviewer-adversarial"][0][1] == "openai"


# Regression guard for the 2026-11-26 live inventory: upstream-retired models
# (model_not_found for every key class) must never re-enter desired chains —
# dead entries only cost probe budget.  Access-denied models are per-key
# entitlement and may stay, but never as a chain's only or last hope.
RETIRED_UPSTREAM = {
    "kimi-k3",
    "glm-5.4",
    "gemini-4-argon",
    "deepseek-v4.1-flash-1017",
}
ACCESS_DENIED_KEY_CLASS = {
    "gemini-4-carbon",
    "qwen3.8-max",
    "claude-fable-5-2",
}


def test_every_chain_ends_with_proven_live_tail() -> None:
    assert PROVEN_LIVE_MODELS, "live-anchor set must be configurable and non-empty"
    for role, chain in DEFAULT_ROLE_CHAIN_SPECS.items():
        upstreams = [step[0] for step in chain]
        assert chain, f"{role} chain must not be empty"
        assert chain[-1][0] in PROVEN_LIVE_MODELS, (
            f"{role} must end with a proven-live tail, got {chain[-1][0]}"
        )
        assert any(upstream in PROVEN_LIVE_MODELS for upstream in upstreams), (
            f"{role} has no proven-live anchor at all"
        )


def test_retired_upstream_models_are_not_in_any_chain() -> None:
    all_upstreams = {
        upstream for chain in DEFAULT_ROLE_CHAIN_SPECS.values() for upstream, _family in chain
    }
    assert RETIRED_UPSTREAM.isdisjoint(all_upstreams), (
        f"upstream-retired models still desired: {RETIRED_UPSTREAM & all_upstreams}"
    )
    # The service constant and the test-side snapshot must not drift apart.
    assert RETIRED_UPSTREAM == set(RETIRED_UPSTREAM_MODELS)


def test_access_denied_entries_are_never_the_only_or_last_hope() -> None:
    for role, chain in DEFAULT_ROLE_CHAIN_SPECS.items():
        upstreams = [step[0] for step in chain]
        denied = [upstream for upstream in upstreams if upstream in ACCESS_DENIED_KEY_CLASS]
        if not denied:
            continue
        assert len(upstreams) > len(denied), f"{role} is entirely access-denied"
        assert upstreams[-1] not in ACCESS_DENIED_KEY_CLASS, (
            f"{role} ends on an access-denied model"
        )
        live = [upstream for upstream in upstreams if upstream in PROVEN_LIVE_MODELS]
        assert live, f"{role} carries access-denied entries without any live backup"


async def test_reconcile_endpoint_absent_creates_roles_and_entries_but_no_targets(db_session) -> None:
    stats = await RoleCatalogService(db_session).reconcile_all()
    assert stats["public_models_created"] == 9
    assert stats["role_entries_created"] == _chain_length()
    assert stats["endpoints_matched"] == 0

    public_ids = set((await db_session.execute(select(PublicModel.id))).scalars().all())
    assert public_ids == set(DEFAULT_ROLE_CHAIN_SPECS)
    publics = list((await db_session.execute(select(PublicModel))).scalars().all())
    assert all(p.owner_id is None and p.enabled for p in publics)

    entry_count = await db_session.scalar(select(func.count()).select_from(RoleChainEntry))
    assert entry_count == _chain_length()
    assert await db_session.scalar(select(func.count()).select_from(UpstreamModel)) == 0
    assert await db_session.scalar(select(func.count()).select_from(RouteTarget)) == 0

    again = await RoleCatalogService(db_session).reconcile_all()
    assert again["public_models_created"] == 0
    assert again["role_entries_created"] == 0
    assert await db_session.scalar(select(func.count()).select_from(RoleChainEntry)) == _chain_length()


async def test_reconcile_materializes_exact_upstream_rows_and_quarantined_targets(db_session) -> None:
    endpoint = await _add_endpoint(db_session, base_url="https://api.reformboss.com/v1/")

    stats = await RoleCatalogService(db_session).reconcile_all()
    assert stats["endpoints_matched"] == 1
    assert stats["route_targets_created"] == _chain_length()

    unique_upstreams = {
        upstream for chain in DEFAULT_ROLE_CHAIN_SPECS.values() for upstream, _ in chain
    }
    assert await db_session.scalar(select(func.count()).select_from(UpstreamModel)) == len(unique_upstreams)
    upstream_rows = list((await db_session.execute(select(UpstreamModel))).scalars().all())
    assert all(row.provider_endpoint_id == endpoint.id for row in upstream_rows)
    assert {row.discovery_source for row in upstream_rows} == {"role_catalog"}

    rows = (await db_session.execute(
        select(RouteTarget, UpstreamModel.upstream_model_id, RoleChainEntry.family)
        .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
        .join(
            RoleChainEntry,
            (RoleChainEntry.public_model_id == RouteTarget.public_model_id)
            & (RoleChainEntry.upstream_model_key == UpstreamModel.upstream_model_id),
        )
        .where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).all()
    assert [row[1] for row in rows] == [
        "gemini-4-carbon", "deepseek-v4-pro", "glm-5.3",
    ]
    assert [row[0].priority for row in rows] == [10, 20, 30]
    assert all(row[0].enabled is False for row in rows)
    assert all(row[0].managed_by == "role_catalog" for row in rows)
    assert all(row[0].lifecycle_status == "quarantined" for row in rows)
    assert all(row[0].lifecycle_updated_at is not None for row in rows)
    assert [row[2] for row in rows] == ["google", "deepseek", "zhipu"]

    again = await RoleCatalogService(db_session).reconcile_all()
    assert again["route_targets_created"] == 0
    assert await db_session.scalar(select(func.count()).select_from(RouteTarget)) == _chain_length()


async def test_reconcile_accepts_operator_tagged_endpoint(db_session) -> None:
    endpoint = await _add_endpoint(
        db_session,
        base_url="https://relay.example.test/custom",
        health_policy={"roleCatalog": "reformboss"},
    )

    stats = await RoleCatalogService(db_session).reconcile_all()
    assert stats["endpoints_matched"] == 1
    rows = list((await db_session.execute(select(UpstreamModel))).scalars().all())
    assert rows
    assert {row.provider_endpoint_id for row in rows} == {endpoint.id}


async def test_manual_entry_is_never_rewritten_and_tombstone_disables_target(db_session) -> None:
    await _add_endpoint(db_session)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()

    entry = (await db_session.execute(
        select(RoleChainEntry).where(
            RoleChainEntry.public_model_id == "rb/lead",
            RoleChainEntry.upstream_model_key == "gemini-4-carbon",
        )
    )).scalar_one()
    entry.source = "manual"
    entry.ordinal = 99
    entry.family = "operator-family"
    entry.enabled = False
    await db_session.flush()

    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    target.enabled = True
    target.lifecycle_status = "active"
    await db_session.flush()

    await svc.reconcile_all()
    await db_session.refresh(entry)
    await db_session.refresh(target)
    assert entry.ordinal == 99
    assert entry.family == "operator-family"
    assert entry.enabled is False
    assert entry.source == "manual"
    assert target.enabled is False
    assert target.lifecycle_reason == "desired_disabled"


async def test_manual_or_legacy_target_is_never_touched(db_session) -> None:
    await _add_endpoint(db_session)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()

    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    target.managed_by = None
    target.lifecycle_status = None
    target.lifecycle_reason = None
    target.enabled = True
    target.priority = 999
    await db_session.flush()

    await svc.reconcile_all()
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.priority == 999
    assert target.managed_by is None
    assert target.lifecycle_status is None


async def test_owner_conflicting_role_is_skipped_not_merged(db_session) -> None:
    user = User(username="owner", password_hash="x", role="user", created_at=_utcnow())
    db_session.add(user)
    await db_session.flush()
    db_session.add(PublicModel(
        id="rb/lead", display_name="mine", enabled=True, owner_id=user.id, created_at=_utcnow(),
    ))
    await db_session.flush()
    await _add_endpoint(db_session)

    stats = await RoleCatalogService(db_session).reconcile_all()
    assert stats["conflicts"] >= 1
    public = await db_session.get(PublicModel, "rb/lead")
    assert public is not None
    assert public.owner_id == user.id
    lead_entries = (await db_session.execute(
        select(func.count()).select_from(RoleChainEntry).where(
            RoleChainEntry.public_model_id == "rb/lead"
        )
    )).scalar_one()
    assert lead_entries == 0
    lead_targets = (await db_session.execute(
        select(func.count()).select_from(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
    )).scalar_one()
    assert lead_targets == 0


async def test_service_flushes_but_never_commits(db_session, monkeypatch) -> None:
    commit = AsyncMock()
    monkeypatch.setattr(db_session, "commit", commit)
    await RoleCatalogService(db_session).reconcile_all()
    commit.assert_not_awaited()


async def test_apply_model_probe_result_success_activates_desired_target(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    credential = await _add_credential(db_session, endpoint)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()

    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None

    await svc.apply_model_probe_result(
        credential_id=credential.id,
        upstream_model_id=target.upstream_model_id,
        probe_row={"ok": True, "reason": "ok", "latencyMs": 42},
    )

    access = (await db_session.execute(select(CredentialModelAccess))).scalar_one()
    assert access.status == "available"
    assert access.probe_failures == 0
    assert access.next_probe_at is None
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"
    assert target.lifecycle_reason == "probe_success"


async def test_apply_model_probe_result_model_failure_demotes_and_backs_off(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    credential = await _add_credential(db_session, endpoint)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    target.enabled = True
    target.lifecycle_status = "active"
    await db_session.flush()

    before = datetime.now(UTC)
    await svc.apply_model_probe_result(
        credential_id=credential.id,
        upstream_model_id=target.upstream_model_id,
        probe_row={"ok": False, "reason": "model_not_found", "latencyMs": 17},
    )

    access = (await db_session.execute(select(CredentialModelAccess))).scalar_one()
    assert access.status == "temporarily_unavailable"
    assert access.probe_failures == 1
    assert access.next_probe_at is not None
    next_probe_at = access.next_probe_at
    if next_probe_at.tzinfo is None:
        next_probe_at = next_probe_at.replace(tzinfo=UTC)
    assert next_probe_at >= before + timedelta(seconds=299)
    await db_session.refresh(target)
    assert target.enabled is False
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "model_not_found"


async def test_note_upstream_outcome_demotes_only_when_no_usable_access_remains(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    credential = await _add_credential(db_session, endpoint)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    target.enabled = True
    target.lifecycle_status = "active"
    access = CredentialModelAccess(
        credential_id=credential.id,
        upstream_model_id=target.upstream_model_id,
        status="temporarily_unavailable",
        created_at=_utcnow(),
    )
    db_session.add(access)
    await db_session.flush()

    error = ClassifiedError("model_not_found", is_model_specific=True, error_code="no_channel")
    await svc.note_upstream_outcome(
        endpoint_id=endpoint.id,
        upstream_model_id=target.upstream_model_id,
        error=error,
    )
    await db_session.refresh(target)
    assert target.enabled is False
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "no_channel"


async def test_note_upstream_outcome_ignores_non_model_errors_and_legacy_targets(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    target.enabled = True
    target.lifecycle_status = "active"
    await db_session.flush()

    await svc.note_upstream_outcome(
        endpoint_id=endpoint.id,
        upstream_model_id=target.upstream_model_id,
        error=ClassifiedError("server_error", is_model_specific=False),
    )
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"

    target.managed_by = None
    await db_session.flush()
    await svc.note_upstream_outcome(
        endpoint_id=endpoint.id,
        upstream_model_id=target.upstream_model_id,
        error=ClassifiedError("model_not_found", is_model_specific=True),
    )
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"
