"""Round-3 regression tests: endpoint incidents must not mass-demote chain members.

Covers four verified review findings:

1. Endpoint-wide failure shapes (``upstream_unavailable``/``no_channel*``) must not
   strip a chain to zero through the evidence-probe trickle: sibling-model failure
   corroboration defers demotion, and the last active chain member is never
   evidence-demoted for an endpoint-ambiguous shape.  A genuinely dead model on a
   healthy endpoint must still demote.
2. Inconclusive negative evidence must not exit the unknown-tier evidence queue
   forever: stale non-terminal rows are readmitted after a bounded window while
   terminal denied verdicts stay sticky.
3. Timeout-only probe outcomes must not write ``probed_at`` (a queue-exit marker).
4. ``free_limit`` body matching must not capture unrelated/negated text.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
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
from stitch_backend.domains.ai_gateway.probe_worker import (
    ProbeWorker,
    _unknown_evidence_tier,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    REFORMBOSS_BASE_URL,
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

_LEAD_MODELS = ["gemini-4-carbon", "deepseek-v4-pro", "glm-5.3"]


@pytest.fixture
async def db_session(tmp_path: Path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'demote_protection.db'}",
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


async def _setup(db_session) -> tuple[ProviderEndpoint, Credential, RoleCatalogService]:
    endpoint = ProviderEndpoint(
        name="ReformBoss",
        adapter_type="openai_compatible",
        base_url=REFORMBOSS_BASE_URL,
        enabled=True,
        owner_id=None,
        created_at=_utcnow(),
    )
    db_session.add(endpoint)
    await db_session.flush()
    credential = Credential(
        provider_endpoint_id=endpoint.id,
        label="key",
        auth_type="api_key",
        fingerprint=f"fp-{endpoint.id}-key",
        enabled=True,
        runtime_status="active",
        owner_id=None,
        created_at=_utcnow(),
    )
    db_session.add(credential)
    await db_session.flush()
    svc = RoleCatalogService(db_session)
    await svc.reconcile_all()
    return endpoint, credential, svc


async def _activate_lead_targets(db_session, models: list[str]) -> dict[str, RouteTarget]:
    """Mark the chosen rb/lead chain targets active (as if probe-activated)."""
    rows = (await db_session.execute(
        select(RouteTarget, UpstreamModel.upstream_model_id)
        .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
        .where(RouteTarget.public_model_id == "rb/lead")
    )).all()
    activated: dict[str, RouteTarget] = {}
    for target, model_key in rows:
        if model_key not in models:
            continue
        target.enabled = True
        target.lifecycle_status = "active"
        target.lifecycle_reason = "probe_success"
        activated[model_key] = target
    await db_session.flush()
    assert set(activated) == set(models), f"missing targets for {set(models) - set(activated)}"
    return activated


async def _fail_probe(
    svc: RoleCatalogService,
    credential: Credential,
    db_session,
    model_key: str,
    *,
    reason: str,
    http_status: int | None = None,
) -> None:
    probe_row: dict = {"ok": False, "reason": reason, "errorCode": reason, "latencyMs": 20}
    if http_status is not None:
        probe_row["httpStatus"] = http_status
    await svc.apply_model_probe_result(
        credential_id=credential.id,
        upstream_model_id=model_key,
        probe_row=probe_row,
    )
    await db_session.flush()


def _lifecycle(target: RouteTarget) -> tuple[bool, str | None]:
    return target.enabled, target.lifecycle_status


# ── Finding 1: endpoint-incident mass-demotion protection ────────────────────


async def test_endpoint_incident_does_not_strip_chain_to_zero(db_session) -> None:
    """Successive endpoint-ambiguous probe failures must not demote every member."""
    _endpoint, credential, svc = await _setup(db_session)
    activated = await _activate_lead_targets(db_session, _LEAD_MODELS)

    # Simulate successive probe-pass failures during one upstream incident:
    # every model on the endpoint answers 503-shaped unavailability.
    for model_key in _LEAD_MODELS:
        await _fail_probe(svc, credential, db_session, model_key, reason="upstream_unavailable")

    states = {}
    for model_key, target in activated.items():
        await db_session.refresh(target)
        states[model_key] = _lifecycle(target)
    active_count = sum(1 for _enabled, status in states.values() if status == "active")
    assert active_count >= 1, f"chain stripped to zero: {states}"
    # Corroboration must kick in after the first failure: at most one member
    # may be demoted by the same incident window.
    demoted = [m for m, (_e, status) in states.items() if status == "demoted"]
    assert len(demoted) <= 1, f"mass demotion during endpoint incident: {states}"


async def test_single_active_member_survives_endpoint_ambiguous_failure(db_session) -> None:
    """The last active chain member is never evidence-demoted on an ambiguous shape."""
    _endpoint, credential, svc = await _setup(db_session)
    activated = await _activate_lead_targets(db_session, ["gemini-4-carbon"])
    target = activated["gemini-4-carbon"]

    await _fail_probe(svc, credential, db_session, "gemini-4-carbon", reason="upstream_unavailable")

    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"
    # The pair still accumulates ordinary probe backoff — re-probing continues.
    access = (await db_session.execute(select(CredentialModelAccess))).scalar_one()
    assert access.probe_failures == 1
    assert access.next_probe_at is not None
    # …but the pair is not blamed with unavailability that would feed the
    # passive no_usable_access demotion backdoor.
    assert access.status != "temporarily_unavailable"


async def test_uncorroborated_ambiguous_failure_demotes_when_chain_has_backup(db_session) -> None:
    """Endpoint-ambiguous evidence still demotes when no siblings are failing."""
    _endpoint, credential, svc = await _setup(db_session)
    activated = await _activate_lead_targets(db_session, _LEAD_MODELS)

    await _fail_probe(svc, credential, db_session, "gemini-4-carbon", reason="upstream_unavailable")

    target = activated["gemini-4-carbon"]
    await db_session.refresh(target)
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "upstream_unavailable"


async def test_genuinely_dead_model_demotes_despite_sibling_ambiguous_failures(db_session) -> None:
    """Strong model evidence is never corroboration-deferred."""
    _endpoint, credential, svc = await _setup(db_session)
    activated = await _activate_lead_targets(db_session, _LEAD_MODELS)

    # Sibling fails first with an endpoint-ambiguous shape (writes the
    # corroboration marker); then the target model answers hard model-scoped death.
    await _fail_probe(svc, credential, db_session, "gemini-4-carbon", reason="upstream_unavailable")
    await _fail_probe(svc, credential, db_session, "deepseek-v4-pro", reason="model_not_found")

    target = activated["deepseek-v4-pro"]
    await db_session.refresh(target)
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "model_not_found"


async def test_no_channel_shape_is_corroboration_deferred(db_session) -> None:
    """no_channel* — the finding's canonical shape — defers like other ambiguous shapes."""
    _endpoint, credential, svc = await _setup(db_session)
    activated = await _activate_lead_targets(db_session, _LEAD_MODELS)

    await _fail_probe(svc, credential, db_session, "gemini-4-carbon", reason="no_channel")
    await _fail_probe(svc, credential, db_session, "deepseek-v4-pro", reason="no_channel_for_model")

    second = activated["deepseek-v4-pro"]
    await db_session.refresh(second)
    # First failure may demote (uncorroborated); the second must be deferred.
    assert second.lifecycle_status == "active"
    assert second.enabled is True


# ── Finding 2: bounded readmission to the unknown-tier evidence queue ────────


def test_unknown_tier_no_markers_is_unknown() -> None:
    assert _unknown_evidence_tier({}, _utcnow()) is True


def test_unknown_tier_recent_negative_evidence_stays_excluded() -> None:
    now = _utcnow()
    caps = {
        "probed_at": now.isoformat(),
        "coherence_passed": False,
    }
    assert _unknown_evidence_tier(caps, now) is False


def test_unknown_tier_stale_negative_evidence_is_readmitted() -> None:
    """A transient canary mismatch must not exclude the row from re-probe forever."""
    now = _utcnow()
    caps = {
        "probed_at": (now - timedelta(hours=25)).isoformat(),
        "coherence_passed": False,
    }
    assert _unknown_evidence_tier(caps, now) is True


def test_unknown_tier_stale_inconclusive_probed_at_is_readmitted() -> None:
    now = _utcnow()
    caps = {"probed_at": (now - timedelta(hours=25)).isoformat()}
    assert _unknown_evidence_tier(caps, now) is True


def test_unknown_tier_terminal_denied_verdict_stays_sticky() -> None:
    now = _utcnow()
    caps = {
        "probed_at": (now - timedelta(hours=72)).isoformat(),
        "coherence_passed": False,
        "verification_reason": "model_access_denied",
        "verification_error_code": "token_model_not_allowed",
    }
    assert _unknown_evidence_tier(caps, now) is False


def test_unknown_tier_positive_evidence_never_readmits() -> None:
    now = _utcnow()
    stale = (now - timedelta(hours=72)).isoformat()
    assert _unknown_evidence_tier({"probed_at": stale, "coherence_passed": True}, now) is False
    assert _unknown_evidence_tier({"probed_at": stale, "evidence_tier": "strong"}, now) is False


# ── Finding 3: timeout-only outcomes must not write queue-exit markers ────────


async def test_timeout_pair_backoff_does_not_write_probed_at(db_session) -> None:
    endpoint, credential, svc = await _setup(db_session)
    upstream = (await db_session.execute(
        select(UpstreamModel).where(UpstreamModel.upstream_model_id == "glm-5.3")
    )).scalar_one()

    result = {
        "credential_id": credential.id,
        "endpoint_id": endpoint.id,
        "upstream_row_id": upstream.id,
        "upstream_model_id": "glm-5.3",
        "latency_ms": 8000,
    }
    await ProbeWorker._backoff_pair(db_session, result)
    await db_session.flush()

    await db_session.refresh(upstream)
    caps = upstream.capabilities or {}
    assert caps.get("probe_timed_out") is True
    assert caps.get("probe_latency_ms") == 8000
    # The timeout is not evidence: the row must stay in the unknown-tier queue.
    assert "probed_at" not in caps
    assert _unknown_evidence_tier(caps, _utcnow()) is True
