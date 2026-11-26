"""Integration Phase-I regression tests — rb/* role health loop.

Covers, in one self-contained file (no conftest fixtures):

  A. Lease integration: unattempted lease-carrying candidates are released on
     every failover exit path; the executor re-check threads a won half-open
     lease into outcome recording instead of discarding it.
  B. ``record_result`` → ``note_upstream_outcome`` wiring: passive demotion,
     no-single-key flapping, entitlement denial, cache invalidation.
  C. Exact-model probe recovery in ProbeWorker (selection rules, promotion,
     pair backoff, endpoint backoff, slow ≠ dead).
  E. Discovery persistence invokes role catalog reconciliation.
  F. Probe metrics scoping + client disconnect is not an empty completion.
  G. Routing-carried public model contract feeds the TTFT watchdog.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway import account_ledger, credential_state
from stitch_backend.domains.ai_gateway import circuit_breaker as cb
from stitch_backend.domains.ai_gateway import probe_worker as pw
from stitch_backend.domains.ai_gateway import routing_engine as re_mod
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_gateway.models import (
    AIGatewayAccountCap,
    AIGatewayAccountUsage,
    Credential,
    CredentialGroupShare,  # noqa: F401 - FK metadata
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
    RouteTarget,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    REFORMBOSS_BASE_URL,
    RoleCatalogService,
)
from stitch_backend.domains.ai_gateway.routing_engine import RoutingEngine
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    RouteTargetService,
    UpstreamModelService,
)
from stitch_backend.domains.ai_proxy import key_inflight, litellm_executor
from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor, _RequestOutcome
from stitch_backend.domains.ai_proxy.litellm_gateway import GatewayRequest
from stitch_backend.domains.auth.models import User  # noqa: F401 - FK metadata
from stitch_backend.domains.groups.models import (  # noqa: F401 - FK metadata
    Group,
    GroupMember,
)

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
    AIGatewayAccountUsage.__table__,
    AIGatewayAccountCap.__table__,
]


@pytest.fixture
async def db_session(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'rb_integ.db'}",
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(c, tables=_DOMAIN_TABLES),
        )
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture(autouse=True)
def _reset_state():
    cb._reset_failure_tracker()
    credential_state.metrics_store.reset()
    account_ledger.reset_affinity()
    key_inflight.reset()
    pw._reset_role_probe_backoff()
    yield
    cb._reset_failure_tracker()
    credential_state.metrics_store.reset()
    account_ledger.reset_affinity()
    key_inflight.reset()
    pw._reset_role_probe_backoff()


# ── Shared seeding helpers ───────────────────────────────────────────────────


async def _seed_role_catalog(db_session, *, base_url: str = REFORMBOSS_BASE_URL):
    """ReformBoss endpoint + one active credential + materialized role catalog."""
    ep_svc = ProviderEndpointService(db_session)
    endpoint = await ep_svc.create_endpoint(
        name="RB", adapter_type="openai_compatible", base_url=base_url,
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id, "key-1", "api_key", "sk-test",
    )
    await db_session.commit()
    stats = await RoleCatalogService(db_session).reconcile_all()
    assert stats["route_targets_created"] > 0
    await db_session.commit()
    return endpoint, cred


async def _target_for(db_session, public_model_id: str, upstream_model_id: str):
    from sqlalchemy import select

    row = (await db_session.execute(
        select(RouteTarget, UpstreamModel)
        .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
        .where(
            RouteTarget.public_model_id == public_model_id,
            UpstreamModel.upstream_model_id == upstream_model_id,
        ),
    )).one()
    return row


def _patch_worker_db(monkeypatch, session) -> None:
    async def fake_run_in_session(op):
        return await op(session)

    monkeypatch.setattr(pw, "run_in_session", fake_run_in_session)
    monkeypatch.setattr(pw, "run_in_read_session", fake_run_in_session)


class _ExactProbeAdapter:
    """Adapter double for exact probes; scripted per-call."""

    def __init__(self, outcome: Any = "ok") -> None:
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        self.calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        if self.outcome == "ok":
            # Coherent upstream: answer the canary probe with the requested
            # word, extracted from the quoted prompt — probe coherence
            # checking means fixed plausible text no longer passes.
            prompt = messages[0]["content"]
            word = prompt.split('"')[1] if '"' in prompt else "operational"
            return {"choices": [{"message": {"role": "assistant", "content": word}}]}
        if self.outcome == "empty":
            return {"choices": [{"message": {"role": "assistant", "content": ""}}]}
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        if isinstance(self.outcome, tuple) and self.outcome[0] == "sleep":
            await asyncio.sleep(self.outcome[1])
            prompt = messages[0]["content"]
            word = prompt.split('"')[1] if '"' in prompt else "late"
            return {"choices": [{"message": {"role": "assistant", "content": word}}]}
        raise RuntimeError(f"unscripted outcome {self.outcome!r}")

    def classify_error(self, exc, **_kwargs):
        return getattr(exc, "classified", ClassifiedError(category="unknown", scope="key"))


async def _targets_for_upstream_key(db_session, upstream_model_key: str):
    """All role targets + upstream row for one exact upstream model id."""
    from sqlalchemy import select

    rows = (await db_session.execute(
        select(RouteTarget, UpstreamModel)
        .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
        .where(UpstreamModel.upstream_model_id == upstream_model_key),
    )).all()
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# A. Lease integration
# ═══════════════════════════════════════════════════════════════════════════


def _lease(endpoint_id: str) -> cb.ProbeLease:
    return cb.ProbeLease(endpoint_id=endpoint_id, token=f"tok-{endpoint_id}", started_at=datetime.now(UTC))


def _candidate(credential_id: str, endpoint_id: str, lease: cb.ProbeLease | None = None) -> Any:
    credential = SimpleNamespace(id=credential_id, account_group=None)
    endpoint = SimpleNamespace(id=endpoint_id, health_policy=None)
    upstream = SimpleNamespace(id=f"um-{endpoint_id}", upstream_model_id="m-1")

    class _Adapter:
        def classify_error(self, exc: BaseException, **_: Any) -> ClassifiedError:
            return getattr(exc, "classified", ClassifiedError(category="unknown"))

    return SimpleNamespace(
        credential=credential,
        endpoint=endpoint,
        upstream_model=upstream,
        adapter=_Adapter(),
        secret="sk-test",
        default_headers={},
        probe_lease=lease,
    )


class _FailoverHarness:
    """Minimal _run_failover harness with a controllable breaker re-check."""

    def __init__(self, invoke, routing_results, *, available=None) -> None:
        self.executor = LiteLLMExecutor.__new__(LiteLLMExecutor)
        self.invoke = invoke
        self.results = routing_results
        self.releases: list[tuple[str, Any]] = []
        self.available = available or (lambda endpoint_id, lease: (True, None))
        self._orig_time = litellm_executor.time
        self._orig_sleep = litellm_executor.asyncio.sleep

    def __enter__(self):
        harness = self

        async def fake_route(route_payload, pool=None):
            return list(harness.results)

        async def fake_available(endpoint_id, probe_lease=None):
            return harness.available(endpoint_id, probe_lease)

        async def fake_release(endpoint_id, lease):
            harness.releases.append((endpoint_id, lease))

        async def fake_sleep(seconds):
            return None

        async def _noop(*_a, **_k):
            return None

        self.executor._try_ai_gateway_route = fake_route
        self.executor._is_endpoint_available = fake_available
        self.executor._release_probe_lease = fake_release
        self.executor._release_inconclusive_probe = lambda rr: fake_release(  # type: ignore[assignment]
            rr.endpoint.id, getattr(rr, "probe_lease", None),
        )
        self.executor._record_request_trace = lambda **_: None
        self.executor._emit_failover_event = _noop
        litellm_executor.asyncio.sleep = fake_sleep
        return self

    def __exit__(self, *exc):
        litellm_executor.time = self._orig_time
        litellm_executor.asyncio.sleep = self._orig_sleep

    async def run(self):
        outcome = _RequestOutcome(model="m-1", owner_id=None)
        payload = GatewayRequest(model="m-1", stream=False)
        try:
            result = await self.executor._run_failover(
                payload, config=None, invoke=self.invoke, outcome=outcome,
                max_wait_seconds=0,
            )
            return {"result": result}
        except Exception as exc:  # noqa: BLE001 - harness introspection
            return {"error": exc}


async def test_unattempted_lease_released_when_first_candidate_succeeds() -> None:
    """Multi-endpoint failover: candidate 1 succeeds — the lease of the
    never-attempted second endpoint must be released (no 120s wedge)."""
    lease1 = _lease("ep-1")
    lease2 = _lease("ep-2")
    results = [
        _candidate("cred-a", "ep-1", lease1),
        _candidate("cred-b", "ep-2", lease2),
    ]

    async def invoke(rr):
        return {"ok": True}

    with _FailoverHarness(invoke, results) as harness:
        outcome = await harness.run()

    assert "result" in outcome
    released_endpoints = {endpoint for endpoint, lease in harness.releases if lease is not None}
    assert "ep-2" in released_endpoints, (
        f"unattempted ep-2 lease never released: {harness.releases!r}"
    )


async def test_unattempted_lease_released_on_client_error_raise() -> None:
    """A client error aborts the walk with a raise — the unattempted
    candidate's lease must still be released."""
    from fastapi import HTTPException

    lease1 = _lease("ep-1")
    lease2 = _lease("ep-2")
    results = [
        _candidate("cred-a", "ep-1", lease1),
        _candidate("cred-b", "ep-2", lease2),
    ]

    async def invoke(rr):
        raise HTTPException(status_code=400, detail="bad request")

    with _FailoverHarness(invoke, results) as harness:
        outcome = await harness.run()

    assert "error" in outcome
    released_endpoints = {endpoint for endpoint, lease in harness.releases if lease is not None}
    assert "ep-2" in released_endpoints


async def test_unattempted_lease_released_on_total_failure() -> None:
    """All candidates fail with key-scoped errors — both leases resolve."""
    lease1 = _lease("ep-1")
    lease2 = _lease("ep-2")
    results = [
        _candidate("cred-a", "ep-1", lease1),
        _candidate("cred-b", "ep-2", lease2),
    ]

    async def invoke(rr):
        exc = RuntimeError("boom")
        exc.classified = ClassifiedError(category="rate_limited", scope="key")  # type: ignore[attr-defined]
        raise exc

    with _FailoverHarness(invoke, results) as harness:
        outcome = await harness.run()

    assert "error" in outcome
    released_endpoints = {endpoint for endpoint, lease in harness.releases if lease is not None}
    assert {"ep-1", "ep-2"} <= released_endpoints


async def test_cache_hit_recheck_threads_won_lease_into_candidate() -> None:
    """Cache-hit resolutions bypass routing's breaker check.  When the
    executor re-check itself wins the open→half_open CAS, the won lease must
    be threaded onto the candidate (so outcome recording resolves it) instead
    of being discarded."""
    results = [_candidate("cred-a", "ep-1", None)]  # no routing lease: cache hit
    won = _lease("ep-1")

    def available(endpoint_id, lease):
        if lease is None:
            return True, won  # re-check wins the CAS
        return True, None

    recorded = {}

    async def invoke(rr):
        recorded["lease"] = getattr(rr, "probe_lease", None)
        return {"ok": True}

    with _FailoverHarness(invoke, results, available=available) as harness:
        outcome = await harness.run()

    assert "result" in outcome
    assert recorded["lease"] is won, "won lease was not threaded onto the candidate"
    assert results[0].probe_lease is won
    # And the lease is released/resolved at the end of the walk (no orphan).
    assert any(endpoint == "ep-1" and lease is won for endpoint, lease in harness.releases)


# ═══════════════════════════════════════════════════════════════════════════
# B. record_result → note_upstream_outcome wiring
# ═══════════════════════════════════════════════════════════════════════════


def _model_error(code: str = "no_channel", category: str = "model_not_found") -> ClassifiedError:
    return ClassifiedError(
        category=category,
        is_endpoint_wide=False,
        is_model_specific=True,
        scope="key",
        error_code=code,
    )


async def test_record_result_demotes_target_when_no_usable_access_remains(db_session) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    # Activate the target first (as a successful probe would).
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred.id, upstream.id, status="available")
    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()
    await db_session.refresh(target)
    assert target.enabled is True and target.lifecycle_status == "active"

    gen_before = re_mod._resolve_cache_generation
    engine = RoutingEngine()
    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=_model_error(),
        http_status=500,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    access = (await access_svc.list_access(credential_id=cred.id, upstream_model_id=upstream.id))[0]
    assert access.status == "temporarily_unavailable"
    reloaded = await RouteTargetService(db_session).get_by_pk(target.id)
    assert reloaded.enabled is False
    assert reloaded.lifecycle_status == "demoted"
    assert reloaded.lifecycle_reason == "no_channel"
    assert re_mod._resolve_cache_generation > gen_before


async def test_record_result_does_not_flap_target_while_other_keys_serve(db_session) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    cred2 = await CredentialService(db_session).create_credential(
        endpoint.id, "key-2", "api_key", "sk-other",
    )
    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred.id, upstream.id, status="available")
    await access_svc.upsert_access(cred2.id, upstream.id, status="available")
    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()

    engine = RoutingEngine()
    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=_model_error(),
        http_status=500,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    # cred2 still serves the model — the target must not demote on one bad key.
    reloaded = await RouteTargetService(db_session).get_by_pk(target.id)
    assert reloaded.enabled is True
    assert reloaded.lifecycle_status == "active"


async def test_entitlement_failure_marks_pair_denied(db_session) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred.id, upstream.id, status="available")
    await db_session.commit()

    engine = RoutingEngine()
    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=_model_error(code="token_model_not_allowed", category="model_access_denied"),
        http_status=403,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    access = (await access_svc.list_access(credential_id=cred.id, upstream_model_id=upstream.id))[0]
    assert access.status == "denied", "entitlement failure must escalate the pair to denied"
    reloaded = await RouteTargetService(db_session).get_by_pk(target.id)
    assert reloaded.enabled is False
    assert reloaded.lifecycle_status == "demoted"


async def test_non_model_error_does_not_demote_role_target(db_session) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred.id, upstream.id, status="available")
    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()

    engine = RoutingEngine()
    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=ClassifiedError(category="auth_failed", scope="key"),
        http_status=401,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    reloaded = await RouteTargetService(db_session).get_by_pk(target.id)
    assert reloaded.enabled is True
    assert reloaded.lifecycle_status == "active"


# ═══════════════════════════════════════════════════════════════════════════
# C0. Role latency contracts + passive health reconciliation
# ═══════════════════════════════════════════════════════════════════════════


async def test_role_public_models_seed_latency_contracts(db_session) -> None:
    await _seed_role_catalog(db_session)
    from sqlalchemy import select

    rows = (await db_session.execute(select(PublicModel))).scalars().all()
    contracts = {row.id: row.contract for row in rows if row.id.startswith("rb/")}
    # Regression: seeded values must match the production-informed latency
    # constants per role (ReformBoss TTFT reality: slow-but-alive upstreams
    # routinely need 15-25s before first byte).
    assert contracts["rb/small"]["latency"] == {
        "maxTtftMs": 25000,
        "stallTimeoutMs": 50000,
    }
    assert contracts["rb/builder-fast"]["latency"] == {
        "maxTtftMs": 30000,
        "stallTimeoutMs": 60000,
    }
    assert contracts["rb/verifier"]["latency"] == {
        "maxTtftMs": 30000,
        "stallTimeoutMs": 60000,
    }
    assert contracts["rb/builder"]["latency"] == {
        "maxTtftMs": 40000,
        "stallTimeoutMs": 80000,
    }
    assert contracts["rb/lead"]["latency"] == {
        "maxTtftMs": 45000,
        "stallTimeoutMs": 90000,
    }
    for role in (
        "rb/planner",
        "rb/reviewer-correctness",
        "rb/reviewer-adversarial",
        "rb/researcher",
    ):
        assert contracts[role]["latency"] == {
            "maxTtftMs": 50000,
            "stallTimeoutMs": 100000,
        }


async def test_role_contract_reconcile_patches_only_absent_latency_keys(db_session) -> None:
    await _seed_role_catalog(db_session)
    public = await db_session.get(PublicModel, "rb/small")
    assert public is not None
    public.contract = {
        "latency": {"maxTtftMs": 1111},
        "operator": {"keep": True},
    }
    await db_session.commit()

    stats = await RoleCatalogService(db_session).reconcile_all()
    await db_session.commit()

    assert stats["public_models_updated"] == 1
    assert public.contract == {
        "latency": {"maxTtftMs": 1111, "stallTimeoutMs": 50000},
        "operator": {"keep": True},
    }


async def test_reconcile_health_demotes_and_repairs_credential_wide_capacity_loss(
    db_session,
) -> None:
    _endpoint, cred = await _seed_role_catalog(db_session)
    service = RoleCatalogService(db_session)
    await service.apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()
    target, _upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    assert target.lifecycle_status == "active"

    # Credential-wide death writes no model-scoped event.  The passive sweep is
    # what notices that the previously serving capacity is no longer usable.
    cred.runtime_status = "auth_failed"
    await db_session.commit()
    await service.reconcile_health()
    await db_session.commit()
    await db_session.refresh(target)
    assert target.enabled is False
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "no_usable_access"

    # Once the credential itself recovers, the pre-existing exact-model access
    # evidence is usable again.  Only this no_usable_access state is repaired;
    # model-failure demotions still require a fresh exact probe.
    cred.runtime_status = "active"
    await db_session.commit()
    await service.reconcile_health()
    await db_session.commit()
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"
    assert target.lifecycle_reason == "capacity_restored"


async def test_probe_worker_pass_wires_reconcile_health(db_session, monkeypatch) -> None:
    await _seed_role_catalog(db_session)
    calls = 0
    original = RoleCatalogService.reconcile_health

    async def spy(self):
        nonlocal calls
        calls += 1
        return await original(self)

    async def no_exact_probes(**_kwargs):
        return None

    async def no_targets(*_args, **_kwargs):
        return []

    monkeypatch.setattr(RoleCatalogService, "reconcile_health", spy)
    monkeypatch.setattr(pw.ProbeWorker, "_probe_role_model_candidates", no_exact_probes)
    monkeypatch.setattr(pw.ProbeWorker, "_load_probe_targets", no_targets)
    monkeypatch.setattr(pw.ProbeWorker, "_load_quota_targets", no_targets)
    _patch_worker_db(monkeypatch, db_session)

    await pw.ProbeWorker._probe_all()
    assert calls == 1


# ═══════════════════════════════════════════════════════════════════════════
# C. Exact-model probe recovery in ProbeWorker
# ═══════════════════════════════════════════════════════════════════════════


async def test_probe_success_activates_quarantined_target(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)

    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()

    # Exactly one exact model was probed (MAX_PER_ENDPOINT_PER_PASS), with the
    # non-fingerprintable prompt and a small token budget.
    assert len(adapter.calls) == 1
    probed_model = adapter.calls[0]["model"]
    prompt = adapter.calls[0]["messages"][0]["content"]
    assert prompt != "ping"
    # Canary coherence contract: the prompt requests one specific quoted word
    # and the budget leaves headroom for reasoning models (truncation at tiny
    # budgets produces empty content — a false positive, not evidence).
    assert '"' in prompt
    assert "one word" in prompt
    assert 32 <= adapter.calls[0]["kwargs"]["max_tokens"] <= 128

    # Every role target of the probed upstream is now active + enabled.
    rows = await _targets_for_upstream_key(db_session, probed_model)
    assert rows, "probed model has no role targets — probe was not exact"
    for target, _upstream in rows:
        assert target.enabled is True
        assert target.lifecycle_status == "active"
        assert target.lifecycle_reason == "probe_success"


async def test_probe_model_failure_backs_off_pair_and_stays_down(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)

    failure = RuntimeError("no channel")
    failure.classified = ClassifiedError(  # type: ignore[attr-defined]
        category="model_not_found",
        is_model_specific=True,
        is_endpoint_wide=False,
        scope="key",
        error_code="no_channel",
    )
    adapter = _ExactProbeAdapter(failure)
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()

    assert len(adapter.calls) == 1
    rows = await _targets_for_upstream_key(db_session, adapter.calls[0]["model"])
    assert rows
    target, upstream = rows[0]
    assert target.enabled is False
    assert target.lifecycle_status in ("quarantined", "demoted")
    access = (
        await CredentialModelAccessService(db_session).list_access(
            credential_id=cred.id, upstream_model_id=upstream.id,
        )
    )[0]
    assert access.status == "temporarily_unavailable"
    assert access.probe_failures == 1
    assert access.next_probe_at is not None
    delay = (access.next_probe_at.replace(tzinfo=UTC) - datetime.now(UTC)).total_seconds()
    assert 250 < delay <= pw.ROLE_PROBE_BACKOFF_BASE_SECONDS + 1


async def test_probe_catalog_detected_arms_endpoint_backoff_without_model_blame(
    db_session, monkeypatch,
) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)

    failure = RuntimeError("catalog probe detected")
    failure.classified = ClassifiedError(  # type: ignore[attr-defined]
        category="server_error",
        is_model_specific=False,
        is_endpoint_wide=True,
        scope="endpoint",
        error_code="catalog_probe_detected",
    )
    adapter = _ExactProbeAdapter(failure)
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        monkeypatch.setattr(pw, "_PROBE_WORKER_STARTED_AT", datetime.now(UTC))
        await pw.ProbeWorker._probe_role_model_candidates(
            cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
        )

    # No access row was blamed for the probed model.  Even though the pass was
    # given a cold-start burst budget, endpoint pushback stops the rest of that
    # burst immediately rather than only in the next pass.
    assert len(adapter.calls) == 1
    target_rows = await _targets_for_upstream_key(db_session, adapter.calls[0]["model"])
    assert target_rows
    _t, upstream = target_rows[0]
    rows = await CredentialModelAccessService(db_session).list_access(
        credential_id=cred.id, upstream_model_id=upstream.id,
    )
    blame = [row for row in rows if row.status in ("temporarily_unavailable", "denied")]
    assert not blame
    # ...the endpoint backed off instead: a second pass probes nothing.
    adapter2 = _ExactProbeAdapter("ok")
    with patch.object(pw, "get_adapter", return_value=adapter2):
        await pw.ProbeWorker._probe_role_model_candidates()
    assert adapter2.calls == []


async def test_probe_timeout_is_slowness_not_death(db_session, monkeypatch) -> None:
    """A probe exceeding the budget is slowness evidence only: the pair backs
    off (anti-spin) but is never marked unavailable/denied."""
    endpoint, cred = await _seed_role_catalog(db_session)

    adapter = _ExactProbeAdapter(("sleep", pw.ROLE_PROBE_BUDGET_SECONDS + 2))
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()

    assert len(adapter.calls) == 1
    target_rows = await _targets_for_upstream_key(db_session, adapter.calls[0]["model"])
    assert target_rows
    target, upstream = target_rows[0]
    rows = await CredentialModelAccessService(db_session).list_access(
        credential_id=cred.id, upstream_model_id=upstream.id,
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.status not in ("temporarily_unavailable", "denied")
    assert row.probe_failures == 1  # backed off, not blamed
    reloaded = await RouteTargetService(db_session).get_by_pk(target.id)
    assert reloaded.enabled is False
    assert reloaded.lifecycle_status == "quarantined"  # unchanged, not demoted


async def test_probe_selection_skips_denied_and_backed_off_pairs(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    access_svc = CredentialModelAccessService(db_session)

    # Deny every (cred, upstream) pair the credential could probe.
    from sqlalchemy import select

    upstreams = (await db_session.execute(select(UpstreamModel))).scalars().all()
    for upstream in upstreams:
        access = await access_svc.upsert_access(cred.id, upstream.id, status="denied")
    await db_session.commit()

    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()
    assert adapter.calls == [], "denied pairs are terminal for automation"

    # Undeny but back off into the future: still nothing probed.
    for upstream in upstreams:
        access = (await access_svc.list_access(credential_id=cred.id, upstream_model_id=upstream.id))[0]
        access.status = "temporarily_unavailable"
        access.next_probe_at = datetime.now(UTC) + timedelta(seconds=3600)
    await db_session.commit()
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()
    assert adapter.calls == [], "backed-off pairs must wait for next_probe_at"


async def test_probe_max_one_per_endpoint_per_pass(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()
    # Many quarantined upstreams exist on this one endpoint, but the pass
    # probes exactly one exact model.
    assert len(adapter.calls) == 1


async def test_cold_start_probe_budget_probes_up_to_five_recovery_models(
    db_session, monkeypatch,
) -> None:
    await _seed_role_catalog(db_session)
    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    monkeypatch.setattr(pw, "_PROBE_WORKER_STARTED_AT", datetime.now(UTC))
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates(
            cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
        )
    assert len(adapter.calls) == pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS
    assert len({call["model"] for call in adapter.calls}) == len(adapter.calls)


async def test_cold_start_budget_decays_after_materialization_window(
    db_session, monkeypatch,
) -> None:
    await _seed_role_catalog(db_session)
    _patch_worker_db(monkeypatch, db_session)
    # Isolate the endpoint-addition anchor from the process-start anchor.
    monkeypatch.setattr(
        pw,
        "_PROBE_WORKER_STARTED_AT",
        datetime.now(UTC) - timedelta(seconds=pw.ROLE_PROBE_COLD_START_WINDOW_SECONDS + 1),
    )

    fresh = await pw.ProbeWorker._load_role_probe_candidates(
        cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
    )
    assert len(fresh) == pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS
    assert {candidate["probe_kind"] for candidate in fresh} == {"recovery"}

    from sqlalchemy import select

    # A first-pass probe failure must not collapse the cold-start window: the
    # anchor is target materialization, not the moving lifecycle timestamp.
    first_target = (
        await db_session.execute(select(RouteTarget).order_by(RouteTarget.id))
    ).scalars().first()
    assert first_target is not None
    first_target.lifecycle_reason = "probe_failed"
    first_target.lifecycle_updated_at = datetime.now(UTC)
    await db_session.commit()
    after_failure = await pw.ProbeWorker._load_role_probe_candidates(
        cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
    )
    assert len(after_failure) == pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS


    stale_time = datetime.now(UTC) - timedelta(
        seconds=pw.ROLE_PROBE_COLD_START_WINDOW_SECONDS + 1,
    )
    targets = (await db_session.execute(select(RouteTarget))).scalars().all()
    for target in targets:
        # Materialization time is the cold-start anchor.  Lifecycle timestamps
        # continue moving as probes fail/succeed and must not extend the burst.
        target.created_at = stale_time
    await db_session.commit()

    steady = await pw.ProbeWorker._load_role_probe_candidates(
        cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
    )
    assert len(steady) == pw.ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS


async def test_process_restart_itself_uses_bounded_cold_start_budget(
    db_session, monkeypatch,
) -> None:
    """Even an old materialized catalog gets the short burst after a process
    restart; endpoint addition is separately anchored by target created_at."""
    await _seed_role_catalog(db_session)
    _patch_worker_db(monkeypatch, db_session)
    stale_time = datetime.now(UTC) - timedelta(
        seconds=pw.ROLE_PROBE_COLD_START_WINDOW_SECONDS + 1,
    )
    from sqlalchemy import select

    targets = (await db_session.execute(select(RouteTarget))).scalars().all()
    for target in targets:
        target.created_at = stale_time
    await db_session.commit()

    monkeypatch.setattr(pw, "_PROBE_WORKER_STARTED_AT", datetime.now(UTC))
    candidates = await pw.ProbeWorker._load_role_probe_candidates(
        cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
    )
    assert len(candidates) == pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS


async def test_endpoint_addition_cold_budget_is_per_endpoint_not_global(
    db_session, monkeypatch,
) -> None:
    first_endpoint, _first_cred = await _seed_role_catalog(db_session)
    service = RoleCatalogService(db_session)
    second_endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="RB second", adapter_type="openai_compatible", base_url=REFORMBOSS_BASE_URL,
    )
    await CredentialService(db_session).create_credential(
        second_endpoint.id, "key-2", "api_key", "sk-test-2",
    )
    await db_session.commit()
    await service.reconcile_endpoint(second_endpoint)
    await db_session.commit()

    stale_time = datetime.now(UTC) - timedelta(
        seconds=pw.ROLE_PROBE_COLD_START_WINDOW_SECONDS + 1,
    )
    monkeypatch.setattr(pw, "_PROBE_WORKER_STARTED_AT", stale_time)
    from sqlalchemy import select

    rows = (await db_session.execute(
        select(RouteTarget, UpstreamModel)
        .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
    )).all()
    for target, upstream in rows:
        if upstream.provider_endpoint_id == first_endpoint.id:
            target.created_at = stale_time
    await db_session.commit()
    _patch_worker_db(monkeypatch, db_session)

    candidates = await pw.ProbeWorker._load_role_probe_candidates(
        cold_start_budget=pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
    )
    counts = {
        endpoint_id: len([
            candidate for candidate in candidates if candidate["endpoint_id"] == endpoint_id
        ])
        for endpoint_id in (first_endpoint.id, second_endpoint.id)
    }
    assert counts[first_endpoint.id] == pw.ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS
    assert counts[second_endpoint.id] == pw.ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS


async def test_sibling_probe_activates_second_key_and_prevents_single_key_demotion(
    db_session, monkeypatch,
) -> None:
    endpoint, first = await _seed_role_catalog(db_session)
    service = RoleCatalogService(db_session)
    selected = "deepseek-v4-pro"
    await service.apply_model_probe_result(
        credential_id=first.id,
        upstream_model_id=selected,
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )

    # Restrict desired state to the already-active upstream.  Otherwise the
    # lower-priority sibling probe would correctly lose the pass to ordinary
    # quarantined-catalog recovery work.
    from sqlalchemy import select

    entries = (await db_session.execute(select(RoleChainEntry))).scalars().all()
    for entry in entries:
        if entry.upstream_model_key != selected:
            entry.enabled = False
    await db_session.commit()

    second = await CredentialService(db_session).create_credential(
        endpoint.id, "key-2", "api_key", "sk-test-2",
    )
    await db_session.commit()

    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()

    assert len(adapter.calls) == 1
    assert adapter.calls[0]["model"] == selected
    target, upstream = await _target_for(db_session, "rb/builder", selected)
    second_access = (
        await CredentialModelAccessService(db_session).list_access(
            credential_id=second.id, upstream_model_id=upstream.id,
        )
    )[0]
    assert second_access.status == "available"

    # A terminal entitlement failure on the first key is no longer a target-
    # level outage: the sibling key is real serving capacity, so the target
    # must not flap down.
    denied = ClassifiedError(
        category="model_access_denied",
        is_endpoint_wide=False,
        is_model_specific=True,
        scope="key",
        error_code="model_access_denied",
    )
    await service.note_upstream_outcome(
        endpoint_id=endpoint.id,
        upstream_model_id=selected,
        error=denied,
        credential_id=first.id,
    )
    await db_session.commit()
    await db_session.refresh(target)
    assert target.enabled is True
    assert target.lifecycle_status == "active"


async def test_probe_skips_open_circuit_endpoint(db_session, monkeypatch) -> None:
    endpoint, cred = await _seed_role_catalog(db_session)
    endpoint.circuit_state = "open"
    endpoint.circuit_retry_at = datetime.now(UTC) + timedelta(seconds=30)
    await db_session.commit()

    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()
    assert adapter.calls == []


async def test_probe_never_iterates_non_role_targets(db_session, monkeypatch) -> None:
    """Legacy/manual targets in broken states must not attract probes."""
    ep_svc = ProviderEndpointService(db_session)
    plain = await ep_svc.create_endpoint(
        name="plain", adapter_type="openai_compatible", base_url="https://plain.test",
    )
    await CredentialService(db_session).create_credential(
        plain.id, "key-1", "api_key", "sk-test",
    )
    upstream = await UpstreamModelService(db_session).upsert_model(plain.id, "gpt-4", capabilities={})
    pub_svc_pub = PublicModel(id="plain-model", display_name="plain", enabled=True, owner_id=None, created_at=datetime.now(UTC))
    db_session.add(pub_svc_pub)
    await db_session.flush()
    db_session.add(RouteTarget(
        public_model_id="plain-model",
        upstream_model_id=upstream.id,
        enabled=False,
        priority=10,
        weight=1.0,
        cost_modifier=1.0,
        managed_by=None,
        lifecycle_status=None,
        created_at=datetime.now(UTC),
    ))
    await db_session.commit()

    adapter = _ExactProbeAdapter("ok")
    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=adapter):
        await pw.ProbeWorker._probe_role_model_candidates()
    assert adapter.calls == []


# ═══════════════════════════════════════════════════════════════════════════
# E. Discovery reconcile wiring
# ═══════════════════════════════════════════════════════════════════════════


async def _persist_catalog_snapshot(db_session, endpoint, cred, model_ids: list[str]) -> None:
    """Persist one discovery snapshot directly, without adapter/network setup."""
    from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata
    from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker

    await DiscoveryWorker._persist_results(
        db_session,
        [{
            "probe": {
                "endpoint_id": endpoint.id,
                "endpoint_name": endpoint.name,
                "base_url": endpoint.base_url,
                "health_policy": endpoint.health_policy,
            },
            "credentials": [(
                {"credential_id": cred.id},
                [ModelMetadata(id=model_id) for model_id in model_ids],
            )],
            "verification": {},
            "pricing": {},
        }],
    )


async def test_catalog_flap_does_not_clobber_probe_activated_access(db_session) -> None:
    """Live P0 regression: ReformBoss catalog absence is not invocability
    evidence.  A probe-activated rb access row and route must survive a flap."""
    endpoint, cred = await _seed_role_catalog(db_session)
    service = RoleCatalogService(db_session)
    await service.apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()

    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    assert target.lifecycle_status == "active"
    assert target.lifecycle_reason == "probe_success"

    # The next catalog poll omits the model entirely (the observed live flap).
    await _persist_catalog_snapshot(db_session, endpoint, cred, [])
    await db_session.commit()

    rows = await CredentialModelAccessService(db_session).list_access(
        credential_id=cred.id,
        upstream_model_id=upstream.id,
    )
    assert rows[0].status == "available"
    assert rows[0].last_error is None

    target, _upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    assert target.enabled is True
    assert target.lifecycle_status == "active"

    request = re_mod.GatewayRequest(
        model="rb/builder", messages=[{"role": "user", "content": "hi"}],
    )
    results = await RoutingEngine().route(db_session, request)
    assert results
    assert results[0].upstream_model.upstream_model_id == "deepseek-v4-pro"


async def test_exact_probe_retirement_still_demotes_after_catalog_flap(db_session) -> None:
    """Probe authority cuts both ways: catalog absence must neither activate
    nor retire, but a later exact ``model_not_found`` probe remains decisive."""
    endpoint, cred = await _seed_role_catalog(db_session)
    service = RoleCatalogService(db_session)
    await service.apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()
    _target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")

    await _persist_catalog_snapshot(db_session, endpoint, cred, [])
    await service.apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={
            "ok": False,
            "reason": "model_not_found",
            "errorCode": "no_channel",
        },
    )
    await db_session.commit()

    rows = await CredentialModelAccessService(db_session).list_access(
        credential_id=cred.id,
        upstream_model_id=upstream.id,
    )
    assert rows[0].status == "temporarily_unavailable"
    assert rows[0].last_error == "model_not_found"

    target, _upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    assert target.enabled is False
    assert target.lifecycle_status == "demoted"
    assert target.lifecycle_reason == "model_not_found"

    # A subsequent catalog flap must not overwrite the exact-probe failure
    # with weaker catalog-absence evidence either.
    await _persist_catalog_snapshot(db_session, endpoint, cred, [])
    await db_session.commit()
    rows = await CredentialModelAccessService(db_session).list_access(
        credential_id=cred.id,
        upstream_model_id=upstream.id,
    )
    assert rows[0].status == "temporarily_unavailable"
    assert rows[0].last_error == "model_not_found"

    request = re_mod.GatewayRequest(
        model="rb/builder", messages=[{"role": "user", "content": "hi"}],
    )
    with pytest.raises(re_mod.RoutingError, match="No enabled route targets"):
        await RoutingEngine().route(db_session, request)


async def test_catalog_absence_still_demotes_non_role_upstream(db_session) -> None:
    """The probe-authority exemption is scoped to desired rb chain upstreams;
    ordinary catalog-discovered rows on the same endpoint keep legacy semantics."""
    endpoint, cred = await _seed_role_catalog(db_session)
    upstream = await UpstreamModelService(db_session).upsert_model(
        endpoint.id,
        "catalog-only-model",
    )
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred.id, upstream.id, status="available")
    await db_session.commit()

    await _persist_catalog_snapshot(db_session, endpoint, cred, [])
    await db_session.commit()

    rows = await access_svc.list_access(credential_id=cred.id, upstream_model_id=upstream.id)
    assert rows[0].status == "unavailable"
    assert rows[0].last_error == "not_returned_by_upstream"


async def test_discovery_persistence_invokes_role_reconcile(db_session, monkeypatch) -> None:
    """Endpoint-added-later: discovery persistence must trigger role catalog
    reconciliation for that endpoint (best-effort, no restart needed)."""
    from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker

    ep_svc = ProviderEndpointService(db_session)
    endpoint = await ep_svc.create_endpoint(
        name="RB", adapter_type="openai_compatible", base_url=REFORMBOSS_BASE_URL,
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id, "key-1", "api_key", "sk-test",
    )
    await db_session.commit()

    results = [
        {
            "probe": {"endpoint_id": endpoint.id, "endpoint_name": "RB"},
            "credentials": [( {"credential_id": cred.id}, [] )],
            "verification": {},
            "pricing": {},
        },
    ]
    await DiscoveryWorker._persist_results(db_session, results)
    await db_session.commit()

    # The role catalog materialized against the late-arriving endpoint.
    target, upstream = await _target_for(db_session, "rb/builder", "deepseek-v4-pro")
    assert target.lifecycle_status == "quarantined"
    assert target.managed_by == "role_catalog"


# ═══════════════════════════════════════════════════════════════════════════
# F1. Probe metrics scoping
# ═══════════════════════════════════════════════════════════════════════════


async def test_key_scoped_probe_failure_does_not_pollute_endpoint_metrics(
    db_session, monkeypatch,
) -> None:
    ep_svc = ProviderEndpointService(db_session)
    endpoint = await ep_svc.create_endpoint(
        name="ep", adapter_type="openai_compatible", base_url="https://ep.test",
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id, "key-1", "api_key", "sk-test",
    )
    cred.runtime_status = "auth_failed"
    await db_session.commit()

    class _AuthFailAdapter:
        class _Probe:
            success = False
            http_status = 401
            latency_ms = 10
            error = "unauthorized"
            error_body = "{}"

        async def probe_credential(self, **_kwargs):
            return self._Probe()

        def classify_error(self, exc, *, http_status=None, response_body=None):
            return ClassifiedError(category="auth_failed", scope="key")

    _patch_worker_db(monkeypatch, db_session)
    with patch.object(pw, "get_adapter", return_value=_AuthFailAdapter()):
        await pw.ProbeWorker._probe_all()

    endpoint_snapshot = credential_state.metrics_store.snapshot(endpoint.id)
    assert endpoint_snapshot.count == 0, (
        "key-scoped probe failure polluted endpoint rolling metrics"
    )
    cred_snapshot = credential_state.metrics_store.snapshot(cred.id)
    assert cred_snapshot.count == 1


# ═══════════════════════════════════════════════════════════════════════════
# F2. Client disconnect is not an empty completion
# ═══════════════════════════════════════════════════════════════════════════


async def test_client_disconnect_before_first_byte_is_not_empty_completion() -> None:
    from stitch_backend.domains.ai_proxy.litellm_streaming import stream_openai_response

    holone = SimpleNamespace(config=SimpleNamespace(enabled=False))
    reported: list[tuple[Any, ...]] = []

    async def on_complete(usage, ok, failure_reason=None):
        reported.append((usage, ok, failure_reason))

    async def upstream():
        yield 'data: {"choices":[{"delta":{"role":"assistant"}}]}'
        # never yields content: client disconnects here
        yield 'data: {"choices":[{"delta":{"content":"late"}}]}'

    resp = await stream_openai_response(
        upstream(), holone_service=holone, on_complete=on_complete,
    )
    agen = resp.body_iterator
    await agen.__anext__()
    await agen.aclose()  # client disconnect before any content byte

    assert reported, "completion callback never fired"
    _usage, ok, reason = reported[-1]
    assert reason != "empty_completion", "client disconnect must not blame the model"
    assert reason in (None, "client_disconnect")


async def test_mid_stream_disconnect_after_content_reports_usage() -> None:
    from stitch_backend.domains.ai_proxy.litellm_streaming import stream_openai_response

    holone = SimpleNamespace(config=SimpleNamespace(enabled=False))
    reported: list[tuple[Any, ...]] = []

    async def on_complete(usage, ok, failure_reason=None):
        reported.append((usage, ok, failure_reason))

    async def upstream():
        yield (
            'data: {"choices":[{"delta":{"content":"a"}}],'
            '"usage":{"prompt_tokens":3,"completion_tokens":1}}'
        )
        yield 'data: {"choices":[{"delta":{"content":"b"}}]}'

    resp = await stream_openai_response(
        upstream(), holone_service=holone, on_complete=on_complete,
    )
    agen = resp.body_iterator
    await agen.__anext__()
    await agen.aclose()

    usage, ok, reason = reported[-1]
    assert usage == (3, 1)
    assert ok is True
    assert reason is None


# ═══════════════════════════════════════════════════════════════════════════
# G. Routing-carried contract feeds the TTFT watchdog
# ═══════════════════════════════════════════════════════════════════════════


async def test_latency_policy_prefers_routing_carried_contract() -> None:
    from stitch_backend.domains.ai_proxy.litellm_invoke_pipeline import (
        _resolve_latency_policy,
    )

    routing_result = SimpleNamespace(
        public_model_contract={"latency": {"maxTtftMs": 20000, "stallTimeoutMs": 30000}},
    )

    async def _boom_run_in_session(op):
        raise AssertionError("DB fallback must not be consulted for carried contracts")

    policy = await _resolve_latency_policy(routing_result, "rb/builder", _boom_run_in_session)
    assert policy is not None
    assert policy.ttft_seconds() == 20.0
    assert policy.stall_seconds() == 30.0


async def test_active_rb_role_route_carries_seeded_latency_contract(db_session) -> None:
    """End-to-end rb path: reconcile seeds the contract, exact probe activates
    the target, and routing carries that contract to the TTFT watchdog."""
    _endpoint, cred = await _seed_role_catalog(db_session)
    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id="deepseek-v4-pro",
        probe_row={"ok": True, "reason": "ok", "latencyMs": 100},
    )
    await db_session.commit()

    request = re_mod.GatewayRequest(
        model="rb/builder", messages=[{"role": "user", "content": "hi"}],
    )
    results = await RoutingEngine().route(db_session, request)
    assert results
    assert results[0].upstream_model.upstream_model_id == "deepseek-v4-pro"
    assert results[0].public_model_contract is not None
    assert results[0].public_model_contract["latency"] == {
        "maxTtftMs": 40000,
        "stallTimeoutMs": 80000,
    }


async def test_latency_policy_falls_back_without_carried_contract() -> None:
    from stitch_backend.domains.ai_proxy import litellm_invoke_pipeline as pipeline

    routing_result = SimpleNamespace(public_model_contract=None)
    sentinel = pipeline.LatencyPolicy(5000, None)

    async def fake_load(model, run_in_session):
        return sentinel

    with patch.object(pipeline, "load_latency_policy", fake_load):
        policy = await pipeline._resolve_latency_policy(routing_result, "m", None)
    assert policy is sentinel


async def test_route_populates_public_model_contract(db_session) -> None:
    """End-to-end: RoutingEngine.route embeds the public model contract."""
    ep_svc = ProviderEndpointService(db_session)
    endpoint = await ep_svc.create_endpoint(
        name="ep", adapter_type="openai_compatible", base_url="https://ep.test",
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id, "key-1", "api_key", "sk-test",
    )
    upstream = await UpstreamModelService(db_session).upsert_model(endpoint.id, "gpt-4", capabilities={})
    await CredentialModelAccessService(db_session).upsert_access(cred.id, upstream.id, status="available")
    contract = {"latency": {"maxTtftMs": 15000}}
    pub = PublicModel(
        id="contract-model",
        display_name="contract-model",
        enabled=True,
        owner_id=None,
        contract=contract,
        created_at=datetime.now(UTC),
    )
    db_session.add(pub)
    await db_session.flush()
    db_session.add(RouteTarget(
        public_model_id="contract-model",
        upstream_model_id=upstream.id,
        enabled=True,
        priority=10,
        weight=1.0,
        cost_modifier=1.0,
        created_at=datetime.now(UTC),
    ))
    await db_session.commit()

    engine = RoutingEngine()
    request = re_mod.GatewayRequest(model="contract-model", messages=[{"role": "user", "content": "hi"}])
    results = await engine.route(db_session, request)
    assert results
    assert results[0].public_model_contract == contract
