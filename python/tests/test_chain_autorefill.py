"""Regression tests for chain auto-refill phases 0-3."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway import probe_worker as pw
from stitch_backend.domains.ai_gateway import routing_engine as re_mod
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError, ProbeResult
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,  # noqa: F401
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    DEFAULT_ROLE_CHAIN_SPECS,
    REFORMBOSS_BASE_URL,
    RoleCatalogService,
)
from stitch_backend.domains.ai_gateway.routing_engine import RoutingEngine
from stitch_backend.domains.ai_gateway.service import CredentialService, ProviderEndpointService
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.models import Group, GroupMember  # noqa: F401

_DOMAIN_TABLES = [
    User.__table__,
    Group.__table__,
    GroupMember.__table__,
    CredentialGroupShare.__table__,
    ProviderEndpoint.__table__,
    Credential.__table__,
    CredentialSecret.__table__,
    UpstreamModel.__table__,
    CredentialModelAccess.__table__,
    PublicModel.__table__,
    RoleChainEntry.__table__,
    RouteTarget.__table__,
]


@pytest.fixture
async def db_session(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'chain_autorefill.db'}",
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


async def _seed_catalog(session):
    endpoint = await ProviderEndpointService(session).create_endpoint(
        name="RB", adapter_type="openai_compatible", base_url=REFORMBOSS_BASE_URL,
    )
    credential = await CredentialService(session).create_credential(
        endpoint.id, "key-1", "api_key", "sk-test",
    )
    await session.commit()
    await RoleCatalogService(session).reconcile_all()
    await session.commit()
    return endpoint, credential


def _evidence_caps(
    *,
    tier: str = "strong",
    latency: int = 1_000,
    usage_sane: bool = True,
    failed_at: datetime | None = None,
) -> dict[str, Any]:
    caps: dict[str, Any] = {
        "coherence_passed": True,
        "usage_sane": usage_sane,
        "probe_latency_ms": latency,
        "evidence_tier": tier,
        "level2_passed": tier in {"strong", "mid"},
        "probed_at": datetime.now(UTC).isoformat(),
        "verification_status": "working",
    }
    if failed_at is not None:
        caps["last_model_failure_at"] = failed_at.isoformat()
    return caps


async def _add_evidence_upstream(
    session,
    endpoint: ProviderEndpoint,
    model_id: str,
    *,
    tier: str = "strong",
    latency: int = 1_000,
    usage_sane: bool = True,
    failed_at: datetime | None = None,
) -> UpstreamModel:
    row = UpstreamModel(
        provider_endpoint_id=endpoint.id,
        upstream_model_id=model_id,
        display_name=model_id,
        enabled=True,
        discovery_source="probe",
        canonical_model_key=model_id,
        capabilities=_evidence_caps(
            tier=tier, latency=latency, usage_sane=usage_sane, failed_at=failed_at,
        ),
        last_seen_at=_utcnow(),
        created_at=_utcnow(),
    )
    session.add(row)
    await session.flush()
    return row


async def _demote_all_role_targets(session, role: str = "rb/lead") -> None:
    rows = list(
        (
            await session.execute(
                select(RouteTarget).where(RouteTarget.public_model_id == role),
            )
        ).scalars().all(),
    )
    assert rows
    for target in rows:
        target.enabled = False
        target.lifecycle_status = "demoted"
        target.lifecycle_reason = "model_not_found"
        target.lifecycle_updated_at = _utcnow()
    await session.flush()


async def _activate_role_targets(session, role: str = "rb/lead") -> list[RouteTarget]:
    rows = list(
        (
            await session.execute(
                select(RouteTarget).where(RouteTarget.public_model_id == role),
            )
        ).scalars().all(),
    )
    assert rows
    for target in rows:
        target.enabled = True
        target.lifecycle_status = "active"
        target.lifecycle_reason = "probe_success"
        target.lifecycle_updated_at = _utcnow()
    await session.flush()
    return rows


async def _demote_upstream_everywhere(
    session,
    endpoint: ProviderEndpoint,
    upstream_model_key: str,
    *,
    reason: str = "model_not_found",
) -> None:
    upstream = (
        await session.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint.id,
                UpstreamModel.upstream_model_id == upstream_model_key,
            ),
        )
    ).scalar_one()
    rows = list(
        (
            await session.execute(
                select(RouteTarget).where(RouteTarget.upstream_model_id == upstream.id),
            )
        ).scalars().all(),
    )
    assert rows
    for target in rows:
        target.enabled = False
        target.lifecycle_status = "demoted"
        target.lifecycle_reason = reason
        target.lifecycle_updated_at = _utcnow()
    await session.flush()


async def _add_unknown_upstream(
    session,
    endpoint: ProviderEndpoint,
    model_id: str,
) -> UpstreamModel:
    row = UpstreamModel(
        provider_endpoint_id=endpoint.id,
        upstream_model_id=model_id,
        display_name=model_id,
        enabled=True,
        discovery_source="probe",
        canonical_model_key=model_id,
        capabilities={},
        last_seen_at=_utcnow(),
        created_at=_utcnow(),
    )
    session.add(row)
    await session.flush()
    return row


async def _activate_lead_with_catalog_available_access(
    session,
    credential: Credential,
    *,
    access_at: datetime,
) -> list[UpstreamModel]:
    """Activate rb/lead while mirroring catalog admission without exact evidence.

    Catalog discovery can mark the exact pair ``available`` without writing any
    upstream probe evidence.  That state is the live prioritization gap: the
    member is serving, but the evidence trickle treats it like inventory.
    """
    targets = await _activate_role_targets(session, "rb/lead")
    upstream_rows = list(
        (
            await session.execute(
                select(UpstreamModel).where(
                    UpstreamModel.id.in_([target.upstream_model_id for target in targets]),
                ),
            )
        ).scalars().all(),
    )
    assert len(upstream_rows) == len(targets)
    for upstream in upstream_rows:
        session.add(
            CredentialModelAccess(
                credential_id=credential.id,
                upstream_model_id=upstream.id,
                status="available",
                last_verified_at=access_at,
                created_at=access_at,
                updated_at=access_at,
            ),
        )
    await session.flush()
    return upstream_rows


async def _seed_active_vs_inventory_priority_scenario(
    session,
    *,
    inventory_count: int = 12,
) -> tuple[ProviderEndpoint, Credential, list[UpstreamModel], list[UpstreamModel]]:
    """One active chain with catalog-only access plus older untested inventory."""
    endpoint, credential = await _seed_catalog(session)
    now = _utcnow()
    active_rows = await _activate_lead_with_catalog_available_access(
        session,
        credential,
        access_at=now,
    )
    inventory_rows: list[UpstreamModel] = []
    for index in range(inventory_count):
        row = await _add_unknown_upstream(
            session,
            endpoint,
            f"inventory-candidate-{index:02d}",
        )
        row.created_at = now - timedelta(days=2, minutes=index)
        inventory_rows.append(row)
    await session.commit()
    return endpoint, credential, active_rows, inventory_rows


async def _force_mass_model_rotation(
    session,
    endpoint: ProviderEndpoint,
    *,
    reasons: tuple[str, str] = ("model_not_found", "token_model_not_allowed"),
) -> None:
    targets = await _activate_role_targets(session, "rb/lead")
    assert len(targets) >= 3
    # Populate the durable previously-active baseline before killing models:
    # Signal A is explicitly about previously-active models, not first-probe
    # failures of never-active quarantined seeds.
    await _chain_service(session).detect_rotation()
    upstream_rows = list(
        (
            await session.execute(
                select(UpstreamModel).where(
                    UpstreamModel.id.in_([target.upstream_model_id for target in targets[:2]]),
                ),
            )
        ).scalars().all(),
    )
    assert len(upstream_rows) == 2
    for upstream, reason in zip(upstream_rows, reasons, strict=True):
        await _demote_upstream_everywhere(
            session,
            endpoint,
            upstream.upstream_model_id,
            reason=reason,
        )


def _chain_service(session):
    from stitch_backend.domains.ai_gateway.chain_refill_service import ChainRefillService

    return ChainRefillService(session)


async def test_seed_reconciler_never_rewrites_or_retires_auto_rows(db_session) -> None:
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    factory_upstream = DEFAULT_ROLE_CHAIN_SPECS["rb/lead"][0][0]
    db_session.add(
        RoleChainEntry(
            public_model_id="rb/lead",
            endpoint_selector="reformboss",
            upstream_model_key="new-auto-model",
            family="unknown",
            ordinal=77,
            enabled=True,
            source="auto",
            created_at=_utcnow(),
        ),
    )
    overlapping = await svc._entry_by_key("rb/lead", "reformboss", factory_upstream)
    assert overlapping is not None
    overlapping.source = "auto"
    overlapping.ordinal = 66
    overlapping.enabled = False
    await db_session.flush()

    await svc.reconcile_all()

    extra = await svc._entry_by_key("rb/lead", "reformboss", "new-auto-model")
    assert extra is not None
    assert extra.enabled is True
    assert extra.ordinal == 77
    assert overlapping.enabled is False
    assert overlapping.ordinal == 66


async def test_role_routing_status_displays_entry_source(db_session) -> None:
    await _seed_catalog(db_session)
    entry = await RoleCatalogService(db_session)._entry_by_key(
        "rb/lead", "reformboss", DEFAULT_ROLE_CHAIN_SPECS["rb/lead"][0][0],
    )
    assert entry is not None
    entry.source = "auto"
    await db_session.flush()

    roles = await RoleCatalogService(db_session).role_routing_status()
    lead = next(row for row in roles if row["id"] == "rb/lead")
    assert lead["steps"][0]["source"] == "auto"


async def test_rescue_triggers_only_at_zero_active_plus_probing(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert actions
    assert actions[0]["upstream_model_key"] == "zminimax-m25"


async def test_one_probing_entry_counts_live_but_leaves_deficit(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    await _demote_all_role_targets(db_session)
    first = (
        await db_session.execute(
            select(RouteTarget).where(RouteTarget.public_model_id == "rb/lead"),
        )
    ).scalars().first()
    assert first is not None
    first.lifecycle_status = "quarantined"
    await db_session.flush()

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert len(actions) == 1
    assert actions[0]["upstream_model_key"] == "zminimax-m25"


async def test_zero_live_deficit_adds_at_most_two_per_pass(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    for index in range(4):
        await _add_evidence_upstream(db_session, endpoint, f"evidence-candidate-{index}")
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert len(actions) == 2


async def test_deficit_refill_respects_four_auto_entries_per_role_total_cap(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    for index in range(4):
        db_session.add(
            RoleChainEntry(
                public_model_id="rb/lead",
                endpoint_selector="reformboss",
                upstream_model_key=f"old-auto-{index}",
                family="unknown",
                ordinal=20 + index,
                enabled=True,
                source="auto",
                created_at=_utcnow(),
            ),
        )
    await db_session.flush()
    await _demote_all_role_targets(db_session)

    assert await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead") == []


async def test_manual_entries_keep_ordinal_precedence_over_auto_rescue(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    svc = RoleCatalogService(db_session)
    manual = await svc.upsert_entry(
        public_model_id="rb/lead",
        upstream_model_key="operator-choice",
        ordinal=9,
        enabled=True,
    )
    assert manual.source == "manual"
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert actions
    assert min(action["ordinal"] for action in actions) > 9


async def test_autorefill_false_contract_opts_role_out(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    public = await db_session.get(PublicModel, "rb/lead")
    assert public is not None
    contract = dict(public.contract or {})
    contract["autoRefill"] = False
    public.contract = contract
    await _demote_all_role_targets(db_session)

    assert await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead") == []


async def test_recent_model_failure_is_sticky_within_decay_window(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(
        db_session,
        endpoint,
        "zminimax-m25",
        failed_at=datetime.now(UTC) - timedelta(hours=1),
    )
    await _demote_all_role_targets(db_session)

    assert await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead") == []


async def test_expired_model_failure_does_not_erase_tier_memory(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(
        db_session,
        endpoint,
        "zminimax-m25",
        failed_at=datetime.now(UTC) - timedelta(hours=7),
    )
    caps = dict(upstream.capabilities or {})
    caps["verification_status"] = "failed"
    caps["verification_error_code"] = "model_not_found"
    upstream.capabilities = caps
    await db_session.flush()
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert any(action["upstream_model_key"] == "zminimax-m25" for action in actions)


async def test_shadow_mode_logs_without_writing(db_session, caplog) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    await _demote_all_role_targets(db_session)

    with caplog.at_level(logging.INFO):
        actions = await _chain_service(db_session).shadow_rescue_refill(public_model_id="rb/lead")

    assert actions
    assert "shadow" in caplog.text.lower()
    assert "would add" in caplog.text.lower()
    assert "zminimax-m25" in caplog.text
    assert await RoleCatalogService(db_session)._entry_by_key(
        "rb/lead", "reformboss", "zminimax-m25",
    ) is None


async def test_deficit_refill_triggers_at_one_live_candidate(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    targets = await _activate_role_targets(db_session, "rb/lead")
    for target in targets[1:]:
        target.enabled = False
        target.lifecycle_status = "demoted"
        target.lifecycle_reason = "model_not_found"
        target.lifecycle_updated_at = _utcnow()
    await db_session.flush()

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert len(actions) == 1
    assert actions[0]["upstream_model_key"] == "zminimax-m25"


async def test_deficit_refill_does_not_trigger_at_two_live_candidates(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    targets = await _activate_role_targets(db_session, "rb/lead")
    targets[1].enabled = False
    targets[1].lifecycle_status = "quarantined"
    targets[1].lifecycle_reason = "probe_pending"
    targets[1].lifecycle_updated_at = _utcnow()
    for target in targets[2:]:
        target.enabled = False
        target.lifecycle_status = "demoted"
        target.lifecycle_reason = "model_not_found"
        target.lifecycle_updated_at = _utcnow()
    await db_session.flush()

    assert await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead") == []


async def test_rotation_signal_a_fires_on_mass_model_scoped_demotions(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _force_mass_model_rotation(db_session, endpoint)

    event = await _chain_service(db_session).detect_rotation()

    assert event is not None
    assert event["signal"] == "health"
    assert event["demoted_count"] >= 2
    await db_session.refresh(endpoint)
    policy = endpoint.health_policy or {}
    assert policy["chainRotation"]["signal"] == "health"
    roles = await RoleCatalogService(db_session).role_routing_status()
    lead = next(row for row in roles if row["id"] == "rb/lead")
    assert lead["rotation_detected"] is True
    assert lead["rotation"]["signal"] == "health"
    from stitch_backend.domains.ai_gateway.schemas import RoleRoutingStatusResponse

    assert RoleRoutingStatusResponse.model_validate(lead).rotation_detected is True


async def test_rotation_signal_a_ignores_key_scoped_failures(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _force_mass_model_rotation(
        db_session,
        endpoint,
        reasons=("quota_exceeded", "auth_failed"),
    )

    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def test_rotation_hysteresis_single_flap_does_not_trigger(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    targets = await _activate_role_targets(db_session, "rb/lead")
    await _chain_service(db_session).detect_rotation()
    first_upstream = (
        await db_session.execute(
            select(UpstreamModel).where(UpstreamModel.id == targets[0].upstream_model_id),
        )
    ).scalar_one()
    await _demote_upstream_everywhere(
        db_session,
        endpoint,
        first_upstream.upstream_model_id,
        reason="model_not_found",
    )

    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def test_rotation_signal_a_ignores_never_active_seed_demotions(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    first_two = [step[0] for step in DEFAULT_ROLE_CHAIN_SPECS["rb/lead"][:2]]
    for upstream_key in first_two:
        await _demote_upstream_everywhere(
            db_session,
            endpoint,
            upstream_key,
            reason="model_not_found",
        )

    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def _simulate_fetch_pass(session, endpoint, model_ids, *, pass_time) -> None:
    """Simulate one successful discovery pass returning exactly ``model_ids``.

    Rows present in the pass get ``last_seen_at = pass_time`` (new rows are
    created with ``created_at = pass_time``); rows absent from the pass keep
    their older timestamps — exactly what DiscoveryWorker persistence does.
    """
    rows = list(
        (
            await session.execute(
                select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id),
            )
        ).scalars().all(),
    )
    by_key = {row.upstream_model_id: row for row in rows}
    for mid in model_ids:
        row = by_key.get(mid)
        if row is None:
            row = UpstreamModel(
                provider_endpoint_id=endpoint.id,
                upstream_model_id=mid,
                display_name=mid,
                enabled=True,
                discovery_source="probe",
                canonical_model_key=mid,
                capabilities={},
                created_at=pass_time,
                last_seen_at=pass_time,
            )
            session.add(row)
        else:
            row.last_seen_at = pass_time
    await session.flush()


async def test_rotation_rotating_subset_upstream_does_not_fire(db_session) -> None:
    """Volatile rotating-subset upstreams must not trip the detector.

    Regression for the production 76.7% false positive: fetch A={m-1..m-100}
    then fetch B={m-51..m-150} — a half-overlapping subset shift carries no
    mass-replacement signature and must never fire, even though 50 ids
    disappeared and 50 new ids appeared.
    """
    endpoint, _cred = await _seed_catalog(db_session)
    now = _utcnow()
    t0 = now - timedelta(minutes=70)
    await _simulate_fetch_pass(
        db_session, endpoint, [f"m-{i}" for i in range(1, 101)], pass_time=t0,
    )
    # First-ever evaluation records the baseline snapshot and never fires.
    assert await _chain_service(db_session).detect_rotation() is None

    await _simulate_fetch_pass(
        db_session, endpoint, [f"m-{i}" for i in range(51, 151)], pass_time=now,
    )
    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def test_rotation_true_rotation_fires_on_mass_replacement(db_session) -> None:
    """Full lineup replacement (A={1..100} → B={101..200}) is a real rotation."""
    endpoint, _cred = await _seed_catalog(db_session)
    now = _utcnow()
    t0 = now - timedelta(minutes=70)
    await _simulate_fetch_pass(
        db_session, endpoint, [f"m-{i}" for i in range(1, 101)], pass_time=t0,
    )
    assert await _chain_service(db_session).detect_rotation() is None

    await _simulate_fetch_pass(
        db_session, endpoint, [f"m-{i}" for i in range(101, 201)], pass_time=now,
    )
    event = await _chain_service(db_session).detect_rotation()

    assert event is not None
    assert event["signal"] == "catalog"
    assert event["missing_count"] >= 80
    assert event["new_count"] >= 80


def _patched_chain_clock(monkeypatch, start: datetime) -> dict[str, datetime]:
    """Patch only the chain service clock; the test then advances it forward."""
    from stitch_backend.domains.ai_gateway import chain_refill_service as chain_mod

    box = {"now": start}
    monkeypatch.setattr(chain_mod, "_utcnow", lambda: box["now"])
    return box


async def test_rotation_no_refire_without_fresh_evidence(db_session, monkeypatch) -> None:
    """Re-detection is tied to fresh evidence, not a fixed clock.

    The clock moves only forward: a fetch is observed first, then the detector
    runs moments later.  After a fire, natural expiry of the burst window must
    not re-fire while no new successful fetch has happened; a fresh fetch of
    the SAME post-rotation lineup must not re-fire either, because that
    snapshot is already consumed.  A second genuine rotation does fire again.
    """
    endpoint, _cred = await _seed_catalog(db_session)
    clock = _patched_chain_clock(monkeypatch, _utcnow())
    lineup_a = [f"m-{i}" for i in range(1, 101)]
    lineup_b = [f"m-{i}" for i in range(101, 201)]
    lineup_c = [f"m-{i}" for i in range(201, 301)]

    await _simulate_fetch_pass(db_session, endpoint, lineup_a, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    assert await _chain_service(db_session).detect_rotation() is None

    clock["now"] += timedelta(hours=1)
    await _simulate_fetch_pass(db_session, endpoint, lineup_b, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "catalog"

    # Let the bounded burst expire naturally.  No fresh discovery pass since
    # the fire → no byte-identical re-fire.
    clock["now"] += timedelta(minutes=16)
    assert await _chain_service(db_session).detect_rotation() is None

    # The next hourly pass returning the SAME post-rotation lineup → still no
    # re-fire, because that post-rotation snapshot is already consumed.
    clock["now"] += timedelta(minutes=44)
    await _simulate_fetch_pass(db_session, endpoint, lineup_b, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    assert await _chain_service(db_session).detect_rotation() is None

    # A later genuine mass replacement is a new rotation and fires again.
    clock["now"] += timedelta(hours=1)
    await _simulate_fetch_pass(db_session, endpoint, lineup_c, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "catalog"


async def test_rotation_second_rotation_without_intervening_fetch_fires(
    db_session, monkeypatch,
) -> None:
    """A post-R1 baseline must never cause the first R2 diff to be swallowed.

    Realistic ordering: the post-R1 catalog fetch is observed moments before
    R1 is written, so its ``fetchedAt`` is earlier than ``detectedAt``.  R2
    then happens before the next hourly discovery pass — there is no
    intervening same-lineup fetch to advance the snapshot timestamp.  The first
    fetch that observes R2 is nevertheless a NEW event because the diff is
    computed against R1's aftermath, not against the pre-R1 world.
    """
    endpoint, _cred = await _seed_catalog(db_session)
    clock = _patched_chain_clock(monkeypatch, _utcnow())
    lineup_a = [f"m-{i}" for i in range(1, 101)]
    lineup_b = [f"m-{i}" for i in range(101, 201)]
    lineup_c = [f"m-{i}" for i in range(201, 301)]

    await _simulate_fetch_pass(db_session, endpoint, lineup_a, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    assert await _chain_service(db_session).detect_rotation() is None

    clock["now"] += timedelta(hours=1)
    await _simulate_fetch_pass(db_session, endpoint, lineup_b, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "catalog"

    # The very next hourly fetch is already the post-R2 world.  No intervening
    # fetch had a chance to advance the post-R1 snapshot beyond detectedAt.
    clock["now"] += timedelta(hours=1)
    await _simulate_fetch_pass(db_session, endpoint, lineup_c, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "catalog"


async def test_rotation_signal_a_fire_does_not_refire_via_catalog(db_session, monkeypatch) -> None:
    """Signal-A-owned rotation must not duplicate-fire via the catalog signal.

    Regression with realistic ordering: the health signal fires first while
    the persisted catalog snapshot still describes the PRE-rotation lineup.
    Discovery is hourly while the burst window is minutes, so the first
    post-rotation fetch lands after the window expires naturally — diffing
    the stale pre-rotation baseline against the post-rotation lineup is the
    SAME rotation's echo and must not fire a second event restarting the burst.
    """
    endpoint, _cred = await _seed_catalog(db_session)
    clock = _patched_chain_clock(monkeypatch, _utcnow())

    # Pre-rotation catalog: every seed key plus filler, consumed as the baseline.
    existing_keys = [
        row.upstream_model_id
        for row in (
            await db_session.execute(
                select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id),
            )
        ).scalars().all()
    ]
    lineup_a = sorted(set(existing_keys) | {f"m-{i}" for i in range(1, 11)})
    await _simulate_fetch_pass(db_session, endpoint, lineup_a, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    assert await _chain_service(db_session).detect_rotation() is None

    # Signal A owns the rotation event before any post-rotation catalog fetch.
    await _force_mass_model_rotation(db_session, endpoint)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "health"

    # Discovery is hourly; the first post-rotation fetch lands after the
    # burst window has expired naturally.
    clock["now"] += timedelta(hours=1)
    lineup_b = [f"post-{i}" for i in range(1, 11)]
    await _simulate_fetch_pass(db_session, endpoint, lineup_b, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)

    # Pre-rotation baseline diffed against the post-rotation lineup is the
    # same rotation's echo — no duplicate event, no burst restart.
    assert await _chain_service(db_session).detect_rotation() is None

    # Once that echo has advanced the baseline into the post-R1 world, a
    # genuine second rotation on the next hourly pass is still detected.
    clock["now"] += timedelta(hours=1)
    lineup_c = [f"third-{i}" for i in range(1, 11)]
    await _simulate_fetch_pass(db_session, endpoint, lineup_c, pass_time=clock["now"])
    clock["now"] += timedelta(seconds=1)
    event = await _chain_service(db_session).detect_rotation()
    assert event is not None and event["signal"] == "catalog"


async def test_rotation_first_snapshot_never_fires(db_session) -> None:
    """Conservative escape: with no prior snapshot there is nothing to diff."""
    endpoint, _cred = await _seed_catalog(db_session)
    now = _utcnow()
    await _simulate_fetch_pass(
        db_session, endpoint, [f"m-{i}" for i in range(1, 101)], pass_time=now,
    )
    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def test_rotation_mass_absence_without_replacement_does_not_trigger(db_session) -> None:
    """Mass disappearance alone (no substantial NEW ids) is a flap, not rotation."""
    endpoint, _cred = await _seed_catalog(db_session)
    now = _utcnow()
    lineup_a = [f"m-{i}" for i in range(1, 11)]
    await _simulate_fetch_pass(db_session, endpoint, lineup_a, pass_time=now - timedelta(minutes=70))
    assert await _chain_service(db_session).detect_rotation() is None

    # 80% of the snapshot vanished but nothing new appeared — degraded fetch
    # or subset flap, not a lineup rotation.
    await _simulate_fetch_pass(db_session, endpoint, lineup_a[:2], pass_time=now)
    assert await _chain_service(db_session).detect_rotation() is None
    await db_session.refresh(endpoint)
    assert "chainRotation" not in (endpoint.health_policy or {})


async def test_rotation_burst_raises_candidate_probe_budget(db_session, monkeypatch) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _force_mass_model_rotation(db_session, endpoint)
    for index in range(5):
        await _add_unknown_upstream(db_session, endpoint, f"rotation-candidate-{index}")
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    await pw.ProbeWorker._run_chain_refill()
    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )

    candidate_picks = [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    assert len(candidate_picks) == 5


async def test_rotation_burst_expires_after_bounded_window(db_session, monkeypatch) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _force_mass_model_rotation(db_session, endpoint)
    for index in range(5):
        await _add_unknown_upstream(db_session, endpoint, f"rotation-candidate-{index}")
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    await pw.ProbeWorker._run_chain_refill()
    await db_session.refresh(endpoint)
    policy = dict(endpoint.health_policy or {})
    rotation = dict(policy["chainRotation"])
    rotation["detectedAt"] = (_utcnow() - timedelta(seconds=901)).isoformat()
    policy["chainRotation"] = rotation
    endpoint.health_policy = policy
    await db_session.flush()

    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )
    candidate_picks = [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    assert len(candidate_picks) == 1


async def test_rotation_burst_never_overrides_endpoint_backoff(db_session, monkeypatch) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _force_mass_model_rotation(db_session, endpoint)
    for index in range(5):
        await _add_unknown_upstream(db_session, endpoint, f"rotation-candidate-{index}")
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)
    pw._reset_role_probe_backoff()

    await pw.ProbeWorker._run_chain_refill()
    pw.ProbeWorker._arm_endpoint_probe_backoff(endpoint.id)
    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )

    assert not [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    pw._reset_role_probe_backoff()


async def test_reviewer_family_diversity_is_best_effort(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "deepseek-rotation-a", latency=500)
    await _add_evidence_upstream(db_session, endpoint, "deepseek-rotation-b", latency=600)
    await _add_evidence_upstream(db_session, endpoint, "qwen-rotation-a", latency=700)
    await _demote_all_role_targets(db_session, "rb/reviewer-correctness")

    actions = await _chain_service(db_session).plan_rescue_refill(
        public_model_id="rb/reviewer-correctness",
    )

    assert [action["upstream_model_key"] for action in actions] == [
        "deepseek-rotation-a",
        "qwen-rotation-a",
    ]
    assert [action["family"] for action in actions] == ["deepseek", "qwen"]


async def test_reviewer_family_diversity_skips_gracefully_when_unknown(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "kestrel-a", latency=500)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25", latency=600)
    await _demote_all_role_targets(db_session, "rb/reviewer-correctness")

    actions = await _chain_service(db_session).plan_rescue_refill(
        public_model_id="rb/reviewer-correctness",
    )

    assert [action["upstream_model_key"] for action in actions] == [
        "kestrel-a",
        "zminimax-m25",
    ]
    assert all(action["family"] == "unknown" for action in actions)


async def test_production_refill_logs_one_line_per_role_when_no_rescue(
    db_session, monkeypatch, caplog,
) -> None:
    await _seed_catalog(db_session)
    _patch_worker_db(monkeypatch, db_session)

    with caplog.at_level(logging.INFO):
        await pw.ProbeWorker._run_chain_refill()

    for role in DEFAULT_ROLE_CHAIN_SPECS:
        assert f"Chain refill state: {role}" in caplog.text
    assert "active/probing=" in caplog.text


async def test_production_refill_logs_applied_rescue_summary(
    db_session, monkeypatch, caplog,
) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    await _demote_all_role_targets(db_session, "rb/lead")
    _patch_worker_db(monkeypatch, db_session)

    with caplog.at_level(logging.INFO):
        await pw.ProbeWorker._run_chain_refill()

    assert "deficit-filled with auto entry zminimax-m25" in caplog.text
    assert "Chain refill: applied 1 refill entries across 1 roles" in caplog.text


class _EvidenceAdapter:
    def __init__(self) -> None:
        self.models: list[str] = []

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        self.models.append(model)
        prompt = messages[0]["content"]
        if "third word" in prompt:
            content = "gammagamma"
        else:
            content = prompt.split('"')[1]
        return {
            "choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 18, "completion_tokens": 2, "total_tokens": 20},
        }

    def classify_error(self, exc, **_kwargs):
        raise AssertionError("no errors expected")


class _TimeoutAdapter:
    """Exact-probe adapter whose first-level call always times out."""

    def __init__(self) -> None:
        self.models: list[str] = []

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        self.models.append(model)
        raise TimeoutError("probe budget elapsed")

    def classify_error(self, exc, **_kwargs):
        raise AssertionError("timeout is handled before error classification")


class _EndpointFailureAdapter:
    """Exact-probe adapter whose every call fails at endpoint scope."""

    def __init__(self) -> None:
        self.models: list[str] = []

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        self.models.append(model)
        raise RuntimeError("upstream bad gateway")

    def classify_error(self, exc, **_kwargs):
        return ClassifiedError(
            category="server_error",
            is_endpoint_wide=True,
            is_model_specific=False,
            scope="endpoint",
            error_code="bad_gateway",
        )


class _Level2Adapter:
    """Exact-probe adapter with a scripted level-2 answer."""

    def __init__(self, level2_content: str) -> None:
        self.level2_content = level2_content

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        prompt = messages[0]["content"]
        if "third word" in prompt:
            content = self.level2_content
        else:
            content = prompt.split('"')[1]
        return {
            "choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 18, "completion_tokens": 2, "total_tokens": 20},
        }

    def classify_error(self, exc, **_kwargs):
        raise AssertionError("no errors expected")


def _exact_probe_target(endpoint, cred, upstream, *, evidence_probe: bool = True) -> dict[str, Any]:
    return {
        "credential_id": cred.id,
        "endpoint_id": endpoint.id,
        "adapter_type": endpoint.adapter_type,
        "base_url": endpoint.base_url,
        "default_headers": endpoint.default_headers,
        "secret": "sk-test",
        "upstream_row_id": upstream.id,
        "upstream_model_id": upstream.upstream_model_id,
        "evidence_probe": evidence_probe,
    }


@pytest.mark.parametrize(
    "level2_content",
    [
        "gammagamma",
        "  GAMMA gamma!  ",
        "\"Gamma, gamma.\"",
        "gamma and gamma",
    ],
)
async def test_level2_canary_accepts_instruction_noise(
    db_session, monkeypatch, level2_content: str,
) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: _Level2Adapter(level2_content))

    result = await pw.ProbeWorker._probe_exact_model(
        _exact_probe_target(endpoint, cred, upstream),
    )

    assert result["outcome"] == "ok"
    assert result["level2_passed"] is True


@pytest.mark.parametrize("level2_content", ["deltadelta", "the model is unavailable", ""])
async def test_level2_canary_rejects_wrong_or_empty_content(
    db_session, monkeypatch, level2_content: str,
) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: _Level2Adapter(level2_content))

    result = await pw.ProbeWorker._probe_exact_model(
        _exact_probe_target(endpoint, cred, upstream),
    )

    assert result["outcome"] == "ok"
    assert result["level2_passed"] is False


def _patch_worker_db(monkeypatch, session) -> None:
    async def fake_run_in_session(op):
        return await op(session)

    monkeypatch.setattr(pw, "run_in_session", fake_run_in_session)
    monkeypatch.setattr(pw, "run_in_read_session", fake_run_in_session)


async def test_trickle_candidate_probe_is_lowest_priority_and_writes_evidence(
    db_session, monkeypatch,
) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    candidate = UpstreamModel(
        provider_endpoint_id=endpoint.id,
        upstream_model_id="zminimax-m25",
        display_name="zminimax-m25",
        enabled=True,
        discovery_source="probe",
        canonical_model_key="zminimax-m25",
        capabilities={},
        last_seen_at=_utcnow(),
        created_at=_utcnow(),
    )
    db_session.add(candidate)
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    picked = await pw.ProbeWorker._load_role_probe_candidates(cold_start_budget=None)
    kinds = [row["probe_kind"] for row in picked]
    assert "candidate_evidence" in kinds
    assert kinds.index("candidate_evidence") == len(kinds) - 1
    assert sum(kind == "candidate_evidence" for kind in kinds) == 1

    adapter = _EvidenceAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)
    await pw.ProbeWorker._probe_role_model_candidates(cold_start_budget=None)
    await db_session.commit()
    await db_session.refresh(candidate)
    caps = candidate.capabilities or {}
    assert caps["coherence_passed"] is True
    assert caps["usage_sane"] is True
    assert caps["probe_latency_ms"] >= 0
    assert caps["evidence_tier"] in {"strong", "mid", "fast", "emergency_tail"}
    assert caps["probed_at"]


async def test_evidence_probe_success_log_does_not_claim_promotion(db_session, monkeypatch, caplog) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: _Level2Adapter("gammagamma"))
    result = await pw.ProbeWorker._probe_exact_model(
        _exact_probe_target(endpoint, cred, upstream),
    )
    assert result["evidence_probe"] is True

    with caplog.at_level(logging.INFO):
        await pw.ProbeWorker._apply_exact_probe_result(
            db_session,
            RoleCatalogService(db_session),
            result,
        )

    assert "evidence trickle" in caplog.text
    assert "promotion path" not in caplog.text


async def test_exact_probe_503_denial_shape_is_carried_as_transient_upstream_failure(
    db_session, monkeypatch,
) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")

    class Upstream503Error(RuntimeError):
        status_code = 503
        classified = ClassifiedError(
            category="model_access_denied",
            is_endpoint_wide=False,
            is_model_specific=True,
            scope="key",
            error_code="token_model_not_allowed",
        )

    class FailingAdapter:
        async def invoke(self, **_kwargs):
            raise Upstream503Error("upstream returned 503")

        def classify_error(self, exc, **_kwargs):
            return exc.classified

    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: FailingAdapter())
    result = await pw.ProbeWorker._probe_exact_model(
        _exact_probe_target(endpoint, cred, upstream),
    )

    assert result["outcome"] == "error"
    assert result["http_status"] == 503
    await pw.ProbeWorker._apply_exact_probe_result(
        db_session,
        RoleCatalogService(db_session),
        result,
    )

    access = (
        await db_session.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.credential_id == cred.id,
                CredentialModelAccess.upstream_model_id == upstream.id,
            ),
        )
    ).scalar_one()
    assert access.status == "temporarily_unavailable"
    assert access.last_error == "upstream_unavailable"
    assert access.next_probe_at is not None


async def test_exact_probe_endpoint_wide_5xx_arms_endpoint_backoff_without_model_blame(
    db_session,
) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    result = {
        "outcome": "error",
        "credential_id": cred.id,
        "endpoint_id": endpoint.id,
        "upstream_row_id": upstream.id,
        "upstream_model_id": upstream.upstream_model_id,
        "latency_ms": 25,
        "usage_sane": None,
        "usage_reason": None,
        "level2_passed": None,
        "http_status": 503,
        "classified": ClassifiedError(
            category="server_error",
            is_endpoint_wide=True,
            is_model_specific=False,
            scope="key",
        ),
    }

    await pw.ProbeWorker._apply_exact_probe_result(
        db_session,
        RoleCatalogService(db_session),
        result,
    )

    assert pw.ProbeWorker._endpoint_probe_backoff_active(endpoint.id, datetime.now(UTC))
    access_rows = (
        await db_session.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.credential_id == cred.id,
                CredentialModelAccess.upstream_model_id == upstream.id,
            ),
        )
    ).scalars().all()
    assert len(access_rows) == 1
    access = access_rows[0]
    assert access.status == "unknown"
    assert access.last_error is None
    assert access.probe_failures == 1
    assert access.next_probe_at is not None


async def test_endpoint_scoped_probe_log_includes_model_id(db_session, caplog) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    upstream = await _add_unknown_upstream(db_session, endpoint, "zminimax-m25")
    result = {
        "outcome": "error",
        "credential_id": cred.id,
        "endpoint_id": endpoint.id,
        "upstream_row_id": upstream.id,
        "upstream_model_id": upstream.upstream_model_id,
        "latency_ms": 25,
        "usage_sane": None,
        "usage_reason": None,
        "level2_passed": None,
        "http_status": 502,
        "classified": ClassifiedError(
            category="server_error",
            is_endpoint_wide=True,
            is_model_specific=False,
            scope="endpoint",
            error_code="bad_gateway",
        ),
    }

    with caplog.at_level(logging.INFO):
        await pw.ProbeWorker._apply_exact_probe_result(
            db_session,
            RoleCatalogService(db_session),
            result,
        )

    assert "endpoint-scoped probe outcome" in caplog.text
    assert "zminimax-m25" in caplog.text


async def test_endpoint_scoped_candidate_failure_rotates_trickle_queue(
    db_session, monkeypatch,
) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    model_ids = ["zminimax-m2-a", "zminimax-m2-b", "zminimax-m2-c"]
    upstreams = [
        await _add_unknown_upstream(db_session, endpoint, model_id)
        for model_id in model_ids
    ]
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)
    adapter = _EndpointFailureAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)

    async def probe_pass() -> None:
        await pw.ProbeWorker._probe_role_model_candidates(
            recovery_budget=0,
            cold_start_budget=None,
        )
        await db_session.flush()

    async def expire_endpoint_and_pair_backoffs() -> None:
        # The endpoint backoff and the first pair backoff start at the same
        # instant in production.  Regression coverage must therefore expire
        # both, not merely clear the endpoint gate while the pair gate still
        # artificially hides the poisoned first candidate.
        pw._reset_role_probe_backoff()
        rows = (
            await db_session.execute(
                select(CredentialModelAccess).where(
                    CredentialModelAccess.credential_id == cred.id,
                    CredentialModelAccess.upstream_model_id.in_([row.id for row in upstreams]),
                ),
            )
        ).scalars().all()
        for row in rows:
            row.next_probe_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

    async def access_for(upstream: UpstreamModel) -> CredentialModelAccess:
        return (
            await db_session.execute(
                select(CredentialModelAccess).where(
                    CredentialModelAccess.credential_id == cred.id,
                    CredentialModelAccess.upstream_model_id == upstream.id,
                ),
            )
        ).scalar_one()

    await probe_pass()
    assert adapter.models == ["zminimax-m2-a"]
    first_access = await access_for(upstreams[0])
    assert first_access.status == "unknown"
    assert first_access.last_error is None
    assert first_access.probe_failures == 1
    assert first_access.next_probe_at is not None
    await db_session.refresh(upstreams[0])
    assert "probed_at" not in (upstreams[0].capabilities or {})

    await expire_endpoint_and_pair_backoffs()
    await probe_pass()
    assert adapter.models == ["zminimax-m2-a", "zminimax-m2-b"]

    await expire_endpoint_and_pair_backoffs()
    await probe_pass()
    assert adapter.models == ["zminimax-m2-a", "zminimax-m2-b", "zminimax-m2-c"]

    await expire_endpoint_and_pair_backoffs()
    await probe_pass()
    assert adapter.models == [
        "zminimax-m2-a",
        "zminimax-m2-b",
        "zminimax-m2-c",
        "zminimax-m2-a",
    ]


async def test_candidate_rotation_uses_selected_pair_attempt_state_with_multiple_credentials(
    db_session, monkeypatch,
) -> None:
    """A never-probed sibling credential must not flatten every model's rotation key.

    The exact-pair picker is deterministic rather than round-robin.  Ordering by
    the minimum count across credentials therefore keeps a poisoned model at
    zero forever whenever another enabled credential has no access row yet.
    """
    endpoint, first_cred = await _seed_catalog(db_session)
    await CredentialService(db_session).create_credential(
        endpoint.id, "key-2", "api_key", "sk-test-2",
    )
    now = _utcnow()
    poisoned = await _add_unknown_upstream(db_session, endpoint, "aaa-multicred-candidate")
    unattempted = await _add_unknown_upstream(db_session, endpoint, "bbb-multicred-candidate")
    poisoned.created_at = now - timedelta(minutes=10)
    unattempted.created_at = now - timedelta(minutes=10)
    db_session.add(
        CredentialModelAccess(
            credential_id=first_cred.id,
            upstream_model_id=poisoned.id,
            status="unknown",
            probe_failures=1,
            next_probe_at=now - timedelta(seconds=1),
            created_at=now - timedelta(minutes=9),
            updated_at=now - timedelta(minutes=1),
        ),
    )
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )

    candidate_picks = [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    assert candidate_picks
    assert candidate_picks[0]["upstream_model_id"] == "bbb-multicred-candidate"


async def test_candidate_rotation_newcomer_advantage_ages(
    db_session, monkeypatch,
) -> None:
    """A newly discovered zero-evidence row must not perpetually outrank older attempts.

    The newcomer's virtual attempt time is its discovery time.  Once an older
    candidate's last attempt is older than that discovery instant, the older
    candidate gets its turn even though the newcomer still has no failure row.
    """
    endpoint, cred = await _seed_catalog(db_session)
    now = _utcnow()
    poisoned = await _add_unknown_upstream(db_session, endpoint, "aaa-poisoned-candidate")
    newcomer = await _add_unknown_upstream(db_session, endpoint, "zzz-newcomer-candidate")
    poisoned.created_at = now - timedelta(hours=1)
    newcomer.created_at = now - timedelta(minutes=5)
    db_session.add(
        CredentialModelAccess(
            credential_id=cred.id,
            upstream_model_id=poisoned.id,
            status="unknown",
            probe_failures=3,
            next_probe_at=now - timedelta(seconds=1),
            created_at=now - timedelta(minutes=50),
            updated_at=now - timedelta(minutes=10),
        ),
    )
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )

    candidate_picks = [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    assert candidate_picks
    assert candidate_picks[0]["upstream_model_id"] == "aaa-poisoned-candidate"


async def test_active_untested_chain_member_jumps_deep_inventory_queue(
    db_session, monkeypatch,
) -> None:
    """Serving members with no exact evidence outrank never-used inventory.

    The inventory rows are deliberately older by discovery time, which is the
    live ordering trap: without an active-member priority class they occupy the
    front of the one-per-pass trickle for hours.
    """
    _endpoint, _cred, active_rows, inventory_rows = (
        await _seed_active_vs_inventory_priority_scenario(db_session)
    )
    _patch_worker_db(monkeypatch, db_session)

    picked = await pw.ProbeWorker._load_role_probe_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )

    candidate_picks = [row for row in picked if row["probe_kind"] == "candidate_evidence"]
    assert candidate_picks
    active_keys = {row.upstream_model_id for row in active_rows}
    inventory_keys = {row.upstream_model_id for row in inventory_rows}
    assert candidate_picks[0]["upstream_model_id"] in active_keys
    assert candidate_picks[0]["upstream_model_id"] not in inventory_keys


async def test_active_priority_class_drains_then_inventory_progresses(
    db_session, monkeypatch,
) -> None:
    """Successful evidence probes drain the priority class; inventory resumes."""
    _endpoint, _cred, active_rows, inventory_rows = (
        await _seed_active_vs_inventory_priority_scenario(db_session, inventory_count=3)
    )
    _patch_worker_db(monkeypatch, db_session)

    class SingleRecordEvidenceAdapter(_EvidenceAdapter):
        def __init__(self) -> None:
            super().__init__()
            self.probe_models: list[str] = []

        async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
            if "third word" not in messages[0]["content"]:
                self.probe_models.append(model)
            return await super().invoke(
                base_url=base_url, secret=secret, model=model, messages=messages,
                stream=stream, default_headers=default_headers, **kwargs,
            )

    adapter = SingleRecordEvidenceAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)

    active_keys = {row.upstream_model_id for row in active_rows}
    for _pass_index in range(len(active_keys)):
        await pw.ProbeWorker._probe_role_model_candidates(
            recovery_budget=0,
            cold_start_budget=None,
        )
        await db_session.flush()

    active_probes = adapter.probe_models[: len(active_keys)]
    assert len(active_probes) == len(active_keys)
    assert set(active_probes) == active_keys
    assert len(set(active_probes)) == len(active_keys)  # no starvation loop inside the class

    await pw.ProbeWorker._probe_role_model_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )
    await db_session.flush()

    inventory_keys = {row.upstream_model_id for row in inventory_rows}
    assert adapter.probe_models[len(active_keys)] in inventory_keys


async def test_active_priority_backoff_does_not_starve_inventory(
    db_session, monkeypatch,
) -> None:
    """Non-draining timeout attempts rotate active members, then inventory probes."""
    _endpoint, _cred, active_rows, inventory_rows = (
        await _seed_active_vs_inventory_priority_scenario(db_session, inventory_count=3)
    )
    _patch_worker_db(monkeypatch, db_session)
    adapter = _TimeoutAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)

    active_keys = {row.upstream_model_id for row in active_rows}
    for _pass_index in range(len(active_keys) + 1):
        await pw.ProbeWorker._probe_role_model_candidates(
            recovery_budget=0,
            cold_start_budget=None,
        )
        await db_session.flush()

    active_probes = adapter.models[: len(active_keys)]
    assert set(active_probes) == active_keys
    assert len(set(active_probes)) == len(active_keys)
    inventory_keys = {row.upstream_model_id for row in inventory_rows}
    assert adapter.models[len(active_keys)] in inventory_keys


class _MalformedCatalogAdapter:
    async def probe_credential(self, **_kwargs) -> ProbeResult:
        return ProbeResult(
            success=False,
            latency_ms=3.0,
            http_status=200,
            error="HTTP 200 but the body held no parseable model entries",
            error_body="<html>Gateway error</html>",
        )

    def classify_error(self, exc, **_kwargs) -> ClassifiedError:
        # Mirrors ConfigurableAdapter's bare-status fallback for a malformed 200.
        return ClassifiedError(category="unknown", is_endpoint_wide=False, scope="key")


async def test_malformed_catalog_200_arms_endpoint_backoff_without_terminal_key_blame(
    db_session, monkeypatch,
) -> None:
    """Malformed catalog 200 is endpoint evidence backed off at endpoint scope.

    It must neither remain an unclassified no-op (retried every worker pass)
    nor become terminal credential/model denial evidence.
    """
    endpoint, cred = await _seed_catalog(db_session)
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: _MalformedCatalogAdapter())

    targets = await pw.ProbeWorker._load_probe_targets()
    assert [target["credential_id"] for target in targets] == [cred.id]

    result = await pw.ProbeWorker._probe_target(targets[0])
    classified = result["classified"]
    assert classified is not None
    assert classified.category == "server_error"
    assert classified.is_endpoint_wide is True
    assert classified.scope == "endpoint"

    await pw.ProbeWorker._persist_probe_results([result])
    await db_session.refresh(cred)
    assert cred.runtime_status == "unknown"
    assert cred.next_retry_at is None

    assert await pw.ProbeWorker._load_probe_targets() == []


async def test_candidate_probe_writes_fabricated_usage_evidence(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    candidate = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    candidate.capabilities = {}
    await db_session.flush()

    class FabricatedUsageAdapter(_EvidenceAdapter):
        async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
            data = await super().invoke(
                base_url=base_url, secret=secret, model=model, messages=messages,
                stream=stream, default_headers=default_headers, **kwargs,
            )
            data["usage"] = {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
            return data

    adapter = FabricatedUsageAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)
    result = await pw.ProbeWorker._probe_exact_model({
        "credential_id": cred.id,
        "endpoint_id": endpoint.id,
        "adapter_type": endpoint.adapter_type,
        "base_url": endpoint.base_url,
        "default_headers": endpoint.default_headers,
        "secret": "sk-test",
        "upstream_row_id": candidate.id,
        "upstream_model_id": candidate.upstream_model_id,
        "evidence_probe": True,
    })
    assert result["outcome"] == "ok"
    assert result["usage_sane"] is False

    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id=candidate.upstream_model_id,
        probe_row={
            "ok": True,
            "reason": "ok",
            "latencyMs": result["latency_ms"],
            "usageSane": result["usage_sane"],
            "usageReason": result["usage_reason"],
            "level2Passed": result["level2_passed"],
        },
    )
    await db_session.refresh(candidate)
    caps = candidate.capabilities or {}
    assert caps["coherence_passed"] is True
    assert caps["usage_sane"] is False
    assert caps["usage_reason"] == "implausibly_low_prompt_tokens"
    assert caps["evidence_tier"] == "mid", "fabricated usage vetoes strong, not coherence"


async def test_usage_fabrication_is_evidence_not_coherence_veto(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(
        db_session, endpoint, "zminimax-m25", tier="fast", usage_sane=False,
    )
    await _demote_all_role_targets(db_session, "rb/small")

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/small")
    assert any(action["upstream_model_key"] == "zminimax-m25" for action in actions)


async def test_coherent_slow_emergency_tail_is_admitted_last(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(db_session, endpoint, "zminimax-m25", tier="strong", latency=900)
    await _add_evidence_upstream(
        db_session, endpoint, "deepseek-v4-flash-slow", tier="emergency_tail", latency=81_000,
    )
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert [action["upstream_model_key"] for action in actions] == [
        "zminimax-m25",
        "deepseek-v4-flash-slow",
    ]
    assert actions[1]["emergency_tail"] is True


async def test_fabricated_usage_vetoes_strong_tier_admission(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    await _add_evidence_upstream(
        db_session, endpoint, "zminimax-m25", tier="strong", usage_sane=False,
    )
    await _demote_all_role_targets(db_session)

    assert await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead") == []


async def test_key_scoped_denial_does_not_veto_tier_evidence(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    upstream = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    caps = dict(upstream.capabilities or {})
    caps["verification_status"] = "failed"
    caps["verification_error_code"] = "token_model_not_allowed"
    upstream.capabilities = caps
    await db_session.flush()
    await _demote_all_role_targets(db_session)

    actions = await _chain_service(db_session).plan_rescue_refill(public_model_id="rb/lead")
    assert any(action["upstream_model_key"] == "zminimax-m25" for action in actions)


async def test_full_rotation_refill_probe_activation_then_chain_serves(db_session) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    rescue = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    for role in DEFAULT_ROLE_CHAIN_SPECS:
        await _demote_all_role_targets(db_session, role)

    actions = await _chain_service(db_session).apply_rescue_refill()
    assert actions
    assert {action["public_model_id"] for action in actions} == set(DEFAULT_ROLE_CHAIN_SPECS)
    entry = await RoleCatalogService(db_session)._entry_by_key(
        "rb/lead", "reformboss", "zminimax-m25",
    )
    assert entry is not None
    assert entry.source == "auto"
    target = (
        await db_session.execute(
            select(RouteTarget).where(
                RouteTarget.public_model_id == "rb/lead",
                RouteTarget.upstream_model_id == rescue.id,
            ),
        )
    ).scalar_one()
    assert target.lifecycle_status == "quarantined"
    assert target.enabled is False, "auto entries must never become active directly"

    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="zminimax-m25",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()
    await db_session.refresh(target)
    assert target.lifecycle_status == "active"
    assert target.enabled is True

    results = await RoutingEngine().route(
        db_session,
        re_mod.GatewayRequest(model="rb/lead", messages=[{"role": "user", "content": "hi"}]),
    )
    assert results
    assert results[0].upstream_model.upstream_model_id == "zminimax-m25"


async def test_degraded_chain_two_of_three_dead_is_replenished_from_evidence(db_session) -> None:
    endpoint, _cred = await _seed_catalog(db_session)
    rescue = await _add_evidence_upstream(db_session, endpoint, "zminimax-m25")
    targets = await _activate_role_targets(db_session, "rb/lead")
    assert len(targets) >= 3
    for target in targets[1:]:
        target.enabled = False
        target.lifecycle_status = "demoted"
        target.lifecycle_reason = "model_not_found"
        target.lifecycle_updated_at = _utcnow()
    await db_session.flush()

    actions = await _chain_service(db_session).apply_rescue_refill(public_model_id="rb/lead")

    assert len(actions) == 1
    assert actions[0]["upstream_model_key"] == "zminimax-m25"
    entry = await RoleCatalogService(db_session)._entry_by_key(
        "rb/lead", "reformboss", "zminimax-m25",
    )
    assert entry is not None
    assert entry.source == "auto"
    target = (
        await db_session.execute(
            select(RouteTarget).where(
                RouteTarget.public_model_id == "rb/lead",
                RouteTarget.upstream_model_id == rescue.id,
            ),
        )
    ).scalar_one()
    assert target.lifecycle_status == "quarantined"
    assert target.enabled is False


async def test_full_rotation_burst_evidence_refill_then_recovery_path(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_catalog(db_session)
    targets = await _activate_role_targets(db_session, "rb/lead")
    await _chain_service(db_session).detect_rotation()
    upstream_rows = list(
        (
            await db_session.execute(
                select(UpstreamModel).where(
                    UpstreamModel.id.in_([target.upstream_model_id for target in targets]),
                ),
            )
        ).scalars().all(),
    )
    assert len(upstream_rows) >= 3
    for upstream in upstream_rows:
        await _demote_upstream_everywhere(
            db_session,
            endpoint,
            upstream.upstream_model_id,
            reason="model_not_found",
        )
    unknown_rows = [
        await _add_unknown_upstream(db_session, endpoint, f"rotation-candidate-{index}")
        for index in range(5)
    ]
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)
    pw._reset_role_probe_backoff()
    adapter = _EvidenceAdapter()
    monkeypatch.setattr(pw, "get_adapter", lambda _adapter_type: adapter)

    await pw.ProbeWorker._run_chain_refill()
    await db_session.refresh(endpoint)
    assert (endpoint.health_policy or {}).get("chainRotation", {}).get("signal") == "health"

    await pw.ProbeWorker._probe_role_model_candidates(
        recovery_budget=0,
        cold_start_budget=None,
    )
    await db_session.commit()
    probed = [row for row in unknown_rows if (row.capabilities or {}).get("coherence_passed") is True]
    assert len(probed) == 5, "rotation mode must re-arm the bounded candidate-evidence burst"

    actions = await _chain_service(db_session).apply_rescue_refill(public_model_id="rb/lead")
    assert len(actions) == 2
    rescue_key = actions[0]["upstream_model_key"]
    entry = await RoleCatalogService(db_session)._entry_by_key(
        "rb/lead", "reformboss", rescue_key,
    )
    assert entry is not None
    assert entry.source == "auto"

    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id=rescue_key,
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()
    results = await RoutingEngine().route(
        db_session,
        re_mod.GatewayRequest(model="rb/lead", messages=[{"role": "user", "content": "hi"}]),
    )
    assert results
    assert results[0].upstream_model.upstream_model_id == rescue_key
    pw._reset_role_probe_backoff()
