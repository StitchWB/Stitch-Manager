"""Regression tests for chain auto-refill phases 0-2."""

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


async def test_no_rescue_when_even_one_entry_is_probing(db_session) -> None:
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
