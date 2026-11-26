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


async def _lead_target_and_access_after_probe(
    db_session,
    probe_row: dict,
) -> tuple[RouteTarget, CredentialModelAccess]:
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

    await svc.apply_model_probe_result(
        credential_id=credential.id,
        upstream_model_id=target.upstream_model_id,
        probe_row={"ok": False, "latencyMs": 17, **probe_row},
    )
    access = (await db_session.execute(select(CredentialModelAccess))).scalar_one()
    return target, access


async def test_probe_denial_with_5xx_is_transient_not_terminal(db_session) -> None:
    target, access = await _lead_target_and_access_after_probe(
        db_session,
        {
            "reason": "model_access_denied",
            "errorCode": "token_model_not_allowed",
            "httpStatus": 503,
        },
    )

    assert access.status == "temporarily_unavailable"
    assert access.last_error == "upstream_unavailable"
    assert access.next_probe_at is not None
    await db_session.refresh(target)
    assert target.lifecycle_reason == "upstream_unavailable"


async def test_probe_model_not_found_with_5xx_is_upstream_transient(db_session) -> None:
    _target, access = await _lead_target_and_access_after_probe(
        db_session,
        {"reason": "model_not_found", "errorCode": "model_not_found", "httpStatus": 503},
    )

    assert access.status == "temporarily_unavailable"
    assert access.last_error == "upstream_unavailable"
    assert access.next_probe_at is not None


async def test_probe_server_error_with_5xx_uses_pair_backoff_not_denial(db_session) -> None:
    _target, access = await _lead_target_and_access_after_probe(
        db_session,
        {"reason": "server_error", "httpStatus": 503},
    )

    assert access.status == "temporarily_unavailable"
    assert access.last_error == "upstream_unavailable"
    assert access.next_probe_at is not None


async def test_probe_explicit_model_denial_on_4xx_remains_terminal_for_key(db_session) -> None:
    _target, access = await _lead_target_and_access_after_probe(
        db_session,
        {
            "reason": "model_access_denied",
            "errorCode": "token_model_not_allowed",
            "httpStatus": 403,
        },
    )

    assert access.status == "denied"
    assert access.last_error == "model_access_denied"


async def test_probe_explicit_denial_without_http_status_remains_terminal_for_key(db_session) -> None:
    _target, access = await _lead_target_and_access_after_probe(
        db_session,
        {"reason": "model_access_denied", "errorCode": "token_model_not_allowed"},
    )

    assert access.status == "denied"
    assert access.last_error == "model_access_denied"


async def test_note_upstream_outcome_5xx_denial_shape_does_not_escalate_terminal(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    credential = await _add_credential(db_session, endpoint)
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    target = (await db_session.execute(
        select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead")
        .order_by(RouteTarget.priority.asc())
    )).scalars().first()
    assert target is not None
    access = CredentialModelAccess(
        credential_id=credential.id,
        upstream_model_id=target.upstream_model_id,
        status="temporarily_unavailable",
        created_at=_utcnow(),
    )
    db_session.add(access)
    await db_session.flush()

    await svc.note_upstream_outcome(
        endpoint_id=endpoint.id,
        upstream_model_id=target.upstream_model_id,
        error=ClassifiedError(
            category="model_access_denied",
            is_model_specific=True,
            error_code="token_model_not_allowed",
        ),
        credential_id=credential.id,
        http_status=503,
    )

    await db_session.refresh(access)
    assert access.status == "temporarily_unavailable"
    await db_session.refresh(target)
    assert target.lifecycle_reason == "upstream_unavailable"


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


async def test_role_routing_status_joins_desired_chain_with_runtime_and_probe_counts(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    credential = await _add_credential(db_session, endpoint)
    await RoleCatalogService(db_session).reconcile_all()

    roles = await RoleCatalogService(db_session).role_routing_status()
    assert [role["id"] for role in roles] == list(DEFAULT_ROLE_CHAIN_SPECS)
    lead = next(role for role in roles if role["id"] == "rb/lead")
    assert [step["upstream_model_key"] for step in lead["steps"]] == [
        "gemini-4-carbon", "deepseek-v4-pro", "glm-5.3",
    ]
    assert [step["ordinal"] for step in lead["steps"]] == [0, 1, 2]
    assert all(step["state"] == "probing" for step in lead["steps"])
    assert all(step["endpoint_id"] == endpoint.id for step in lead["steps"])
    assert all(step["route_target_id"] is not None for step in lead["steps"])
    assert lead["state"] == "probing"
    assert lead["active_steps"] == 0

    upstream = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == "gemini-4-carbon",
        ),
    )
    assert upstream is not None
    target = await db_session.scalar(
        select(RouteTarget).where(
            RouteTarget.public_model_id == "rb/lead",
            RouteTarget.upstream_model_id == upstream.id,
        ),
    )
    assert target is not None
    verified_at = datetime.now(UTC)
    target.enabled = True
    target.lifecycle_status = "active"
    target.lifecycle_reason = "positive_exact_model_probe"
    db_session.add(
        CredentialModelAccess(
            credential_id=credential.id,
            upstream_model_id=upstream.id,
            status="available",
            last_verified_at=verified_at,
            next_probe_at=verified_at + timedelta(minutes=30),
        ),
    )
    await db_session.flush()

    roles = await RoleCatalogService(db_session).role_routing_status()
    lead = next(role for role in roles if role["id"] == "rb/lead")
    first = lead["steps"][0]
    assert first["state"] == "active"
    assert first["is_current"] is True
    assert first["access"]["available"] == 1
    assert first["access"]["denied"] == 0
    assert first["access"]["last_verified_at"] is not None
    assert lead["state"] == "active"  # first desired step carries the role; later probes do not degrade it
    assert lead["active_steps"] == 1
    assert lead["probing_steps"] == 2

    second_upstream = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == "deepseek-v4-pro",
        ),
    )
    assert second_upstream is not None
    second_target = await db_session.scalar(
        select(RouteTarget).where(
            RouteTarget.public_model_id == "rb/lead",
            RouteTarget.upstream_model_id == second_upstream.id,
        ),
    )
    assert second_target is not None
    target.enabled = False
    target.lifecycle_status = "demoted"
    second_target.enabled = True
    second_target.lifecycle_status = "active"
    await db_session.flush()

    roles = await RoleCatalogService(db_session).role_routing_status()
    lead = next(role for role in roles if role["id"] == "rb/lead")
    assert lead["state"] == "degraded"
    assert lead["steps"][0]["state"] == "demoted"
    assert lead["steps"][1]["state"] == "active"
    assert lead["steps"][1]["is_current"] is True


async def test_role_routing_status_preserves_manual_override_and_disabled_entries(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    await RoleCatalogService(db_session).reconcile_all()

    entries = list(
        (
            await db_session.execute(
                select(RoleChainEntry)
                .where(RoleChainEntry.public_model_id == "rb/small")
                .order_by(RoleChainEntry.ordinal.asc()),
            )
        ).scalars().all(),
    )
    entries[1].enabled = False
    upstream = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == entries[0].upstream_model_key,
        ),
    )
    assert upstream is not None
    target = await db_session.scalar(
        select(RouteTarget).where(
            RouteTarget.public_model_id == "rb/small",
            RouteTarget.upstream_model_id == upstream.id,
        ),
    )
    assert target is not None
    target.lifecycle_status = "verified"
    target.lifecycle_reason = "manual_override"
    target.managed_by = "manual"
    target.enabled = False
    await db_session.flush()

    roles = await RoleCatalogService(db_session).role_routing_status()
    small = next(role for role in roles if role["id"] == "rb/small")
    assert small["steps"][0]["state"] == "manual"
    assert small["steps"][0]["managed_by"] == "manual"
    assert small["steps"][1]["state"] == "disabled"
    assert small["steps"][1]["desired_enabled"] is False


async def test_role_routing_status_exposes_trust_evidence_per_step(db_session) -> None:
    endpoint = await _add_endpoint(db_session)
    await RoleCatalogService(db_session).reconcile_all()

    upstream = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == "gemini-4-carbon",
        ),
    )
    assert upstream is not None
    upstream.capabilities = {
        "source": "probe",
        "probed_at": "2026-01-01T00:00:00+00:00",
        "verification_status": "working",
        "coherence_passed": True,
        "level2_passed": True,
        "usage_sane": True,
        "evidence_tier": "strong",
        "probe_latency_ms": 1234,
    }
    fabricator = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == "deepseek-v4-pro",
        ),
    )
    assert fabricator is not None
    fabricator.capabilities = {
        "source": "probe",
        "probed_at": "2026-01-01T00:00:00+00:00",
        "verification_status": "working",
        "coherence_passed": True,
        "usage_sane": False,
        "usage_reason": "cached_exceeds_prompt",
    }
    failed = await db_session.scalar(
        select(UpstreamModel).where(
            UpstreamModel.provider_endpoint_id == endpoint.id,
            UpstreamModel.upstream_model_id == "glm-5.3",
        ),
    )
    assert failed is not None
    failed.capabilities = {
        "source": "probe",
        "probed_at": "2026-01-01T00:00:00+00:00",
        "verification_status": "failed",
        "coherence_passed": False,
    }
    await db_session.flush()

    roles = await RoleCatalogService(db_session).role_routing_status()
    lead = next(role for role in roles if role["id"] == "rb/lead")
    first, second, third = lead["steps"][0], lead["steps"][1], lead["steps"][2]

    assert first["trust_state"] == "verified_coherent"
    assert first["coherence_passed"] is True
    assert first["level2_passed"] is True
    assert first["usage_sane"] is True
    assert first["evidence_tier"] == "strong"
    assert first["probe_latency_ms"] == 1234
    assert first["probed_at"] == "2026-01-01T00:00:00+00:00"
    assert first["usage_suspicion_count"] == 0

    assert second["trust_state"] == "usage_fabrication_suspect"
    assert second["usage_sane"] is False
    assert second["usage_reason"] == "cached_exceeds_prompt"

    assert third["trust_state"] == "degraded"

    # Supplier integrity aggregates across all probed models of the endpoint:
    # three probed here, one fabricating.
    integrity = first["supplier_integrity"]
    assert integrity is not None
    assert integrity["probed_models"] == 3
    assert integrity["fabrication_suspect_models"] == 1
    assert integrity["fabrication_share"] == pytest.approx(1 / 3)

    # A step whose upstream row has no probe evidence at all is untested.
    small = next(role for role in roles if role["id"] == "rb/small")
    untested = [
        step
        for step in small["steps"]
        if step["upstream_model_key"] not in {"gemini-4-carbon", "deepseek-v4-pro", "glm-5.3"}
    ]
    assert untested, "expected at least one never-probed chain step"
    assert all(step["trust_state"] == "untested" for step in untested)
    assert all(step["coherence_passed"] is None for step in untested)


async def test_role_routing_status_surfaces_usage_suspicion_registry_counts(db_session) -> None:
    from stitch_backend.domains.ai_gateway.usage_integrity import usage_integrity_tracker

    usage_integrity_tracker.reset()
    try:
        endpoint = await _add_endpoint(db_session)
        await RoleCatalogService(db_session).reconcile_all()

        upstream = await db_session.scalar(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint.id,
                UpstreamModel.upstream_model_id == "gemini-4-carbon",
            ),
        )
        assert upstream is not None

        usage_integrity_tracker.record(
            endpoint.id,
            upstream.id,
            "cached_exceeds_prompt",
            detail="cached=9 > prompt=3",
        )
        usage_integrity_tracker.record(endpoint.id, upstream.id, "cached_exceeds_prompt")
        usage_integrity_tracker.record(endpoint.id, upstream.id, "implausibly_low_prompt_tokens")

        roles = await RoleCatalogService(db_session).role_routing_status()
        lead = next(role for role in roles if role["id"] == "rb/lead")
        first = lead["steps"][0]
        assert first["upstream_model_key"] == "gemini-4-carbon"
        assert first["usage_suspicion_count"] == 3
        assert first["usage_suspicion_reasons"] == [
            "cached_exceeds_prompt",
            "implausibly_low_prompt_tokens",
        ]

        # Other steps on the same endpoint carry no suspicion counts.
        assert all(step["usage_suspicion_count"] == 0 for step in lead["steps"][1:])
    finally:
        usage_integrity_tracker.reset()


def test_derive_trust_state_priority_order() -> None:
    from stitch_backend.domains.ai_gateway.model_evidence import derive_trust_state

    assert derive_trust_state(None) == "untested"
    assert derive_trust_state({}) == "untested"
    assert derive_trust_state({"probed_at": "x"}) == "untested"
    assert derive_trust_state({"coherence_passed": True}) == "verified_coherent"
    assert derive_trust_state({"coherence_passed": False}) == "degraded"
    assert derive_trust_state({"verification_status": "failed"}) == "degraded"
    # Fabrication is more specific than generic coherence and must win.
    assert (
        derive_trust_state({"coherence_passed": True, "usage_sane": False})
        == "usage_fabrication_suspect"
    )
    # Negative probe evidence outranks everything.
    assert derive_trust_state({"coherence_passed": False, "usage_sane": False}) == "degraded"
