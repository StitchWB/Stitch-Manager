"""Integration Phase-II routing regressions.

Covers the correctness fixes, sticky session affinity, passive latency-aware
ordering, and additive observability additions for the rb/* routing overhaul.
These tests intentionally exercise ``ai_gateway`` without importing
``kiro_gateway``; the Kiro implementation is reference material only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway import account_ledger, credential_state, model_latency
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
from stitch_backend.domains.ai_gateway.role_catalog_service import RoleCatalogService
from stitch_backend.domains.ai_gateway.routing_engine import (
    RoutingEngine,
    RoutingResult,
    _reorder_cached,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)
from stitch_backend.domains.ai_gateway.session_affinity import extract_session_hint
from stitch_backend.domains.ai_proxy.analytics import AiProxyAnalytics
from stitch_backend.domains.ai_proxy.litellm_gateway import GatewayRequest
from stitch_backend.domains.ai_proxy.litellm_invoke_pipeline import _adapter_options
from stitch_backend.domains.ai_proxy.models import AiProxyRequestLog
from stitch_backend.domains.ai_proxy.request_logs import record_request_log
from stitch_backend.domains.ai_proxy.request_trace import RequestTrace
from stitch_backend.domains.auth.models import User  # noqa: F401 - FK metadata
from stitch_backend.domains.groups.models import Group, GroupMember  # noqa: F401 - FK metadata

if TYPE_CHECKING:
    from pathlib import Path

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
    RouteTarget.__table__,
    RoleChainEntry.__table__,
    AIGatewayAccountUsage.__table__,
    AIGatewayAccountCap.__table__,
    AiProxyRequestLog.__table__,
]


@pytest.fixture
async def db_session(tmp_path: Path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'phase2.db'}",
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


@pytest.fixture(autouse=True)
def _reset_in_memory_state():
    credential_state.metrics_store.reset()
    account_ledger.reset_affinity()
    model_latency.model_latency_tracker.reset()
    yield
    credential_state.metrics_store.reset()
    account_ledger.reset_affinity()
    model_latency.model_latency_tracker.reset()


async def _seed_route(db_session, *, model_id: str = "gpt-4", public_model: str = "vision-best"):
    endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="Test",
        adapter_type="openai_compatible",
        base_url="https://api.test.com/v1",
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id,
        "key-1",
        "api_key",
        "sk-test",
    )
    upstream = await UpstreamModelService(db_session).upsert_model(
        endpoint.id,
        model_id,
        capabilities={},
    )
    await CredentialModelAccessService(db_session).upsert_access(
        cred.id,
        upstream.id,
        status="available",
    )
    pub = await PublicModelService(db_session).create_public_model(
        public_model,
        display_name=public_model,
    )
    await RouteTargetService(db_session).create_target(pub.id, upstream.id, priority=10)
    await db_session.commit()
    return endpoint, cred, upstream, pub


# ═══════════════════════════════════════════════════════════════════════════
# FIX-A/FIX-D: scoped correctness
# ═══════════════════════════════════════════════════════════════════════════


async def test_pair_probe_failure_does_not_contaminate_upstream_while_sibling_key_serves(db_session):
    endpoint, cred, upstream, _pub = await _seed_route(db_session)
    cred2 = await CredentialService(db_session).create_credential(
        endpoint.id,
        "key-2",
        "api_key",
        "sk-test-2",
    )
    access_svc = CredentialModelAccessService(db_session)
    await access_svc.upsert_access(cred2.id, upstream.id, status="available")
    upstream.capabilities = {"verification_status": "working"}
    await db_session.commit()

    service = RoleCatalogService(db_session)
    failure = {"ok": False, "reason": "token_model_not_allowed", "latencyMs": 25}
    await service.apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id=upstream.upstream_model_id,
        probe_row=failure,
    )
    await db_session.commit()

    access1 = (await access_svc.list_access(cred.id, upstream.id))[0]
    access2 = (await access_svc.list_access(cred2.id, upstream.id))[0]
    assert access1.status == "denied"
    assert access2.status == "available"
    # Pair-scoped evidence is not model-level evidence while another usable
    # key remains; the old behavior flipped this directly to "failed".
    assert upstream.capabilities.get("verification_status") == "working"

    await service.apply_model_probe_result(
        credential_id=cred2.id,
        upstream_model_id=upstream.upstream_model_id,
        probe_row=failure,
    )
    await db_session.commit()
    assert upstream.capabilities.get("verification_status") == "failed"


async def test_model_scoped_failure_does_not_pollute_credential_or_endpoint_metrics(db_session):
    endpoint, cred, upstream, _pub = await _seed_route(db_session)
    engine = RoutingEngine()
    error = ClassifiedError(category="model_not_found", is_model_specific=True)

    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=error,
        http_status=404,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    assert credential_state.metrics_store.snapshot(cred.id).count == 0
    assert credential_state.metrics_store.snapshot(endpoint.id).count == 0

    # Sanity contrast: key-scoped evidence still feeds only credential metrics,
    # endpoint/global evidence still feeds endpoint metrics.
    key_error = ClassifiedError(category="rate_limited", scope="key")
    await engine.record_result(db_session, cred.id, endpoint.id, error=key_error, http_status=429)
    assert credential_state.metrics_store.snapshot(cred.id).count == 1
    assert credential_state.metrics_store.snapshot(endpoint.id).count == 0

    endpoint_error = ClassifiedError(category="server_error", is_endpoint_wide=True, scope="endpoint")
    await engine.record_result(db_session, cred.id, endpoint.id, error=endpoint_error, http_status=500)
    # Endpoint/global evidence feeds endpoint ordering but is not evidence
    # against the individual credential.
    assert credential_state.metrics_store.snapshot(cred.id).count == 1
    assert credential_state.metrics_store.snapshot(endpoint.id).count == 1


async def test_entitlement_model_failure_marks_exact_pair_denied_not_temporary(db_session):
    endpoint, cred, upstream, _pub = await _seed_route(db_session)
    engine = RoutingEngine()
    error = ClassifiedError(
        category="model_access_denied",
        is_model_specific=True,
        error_code="token_model_not_allowed",
    )

    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=error,
        http_status=403,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    access = (
        await CredentialModelAccessService(db_session).list_access(cred.id, upstream.id)
    )[0]
    assert access.status == "denied"
    assert access.last_error == "token_model_not_allowed"


async def test_entitlement_shaped_503_marks_pair_transient_not_terminal(db_session):
    endpoint, cred, upstream, _pub = await _seed_route(db_session)
    engine = RoutingEngine()
    error = ClassifiedError(
        category="model_access_denied",
        is_model_specific=True,
        error_code="token_model_not_allowed",
    )

    await engine.record_result(
        db_session,
        cred.id,
        endpoint.id,
        error=error,
        http_status=503,
        upstream_model_id=upstream.id,
    )
    await db_session.commit()

    access = (
        await CredentialModelAccessService(db_session).list_access(cred.id, upstream.id)
    )[0]
    assert access.status == "temporarily_unavailable"
    assert access.last_error == "upstream_unavailable"


async def test_successful_probe_reenables_auto_retired_upstream(db_session):
    _endpoint, cred, upstream, _pub = await _seed_route(db_session)
    upstream.enabled = False
    upstream.capabilities = {"retired_auto": True, "verification_status": "failed"}
    await db_session.commit()

    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id=upstream.upstream_model_id,
        probe_row={"ok": True, "latencyMs": 20},
    )
    await db_session.commit()

    assert upstream.enabled is True
    assert "retired_auto" not in (upstream.capabilities or {})
    assert upstream.capabilities.get("verification_status") == "working"


def _patch_worker_db(monkeypatch, session) -> None:
    """Bind discovery worker session factories to the test engine."""
    from stitch_backend.domains.ai_gateway import discovery_worker as dw

    factory = async_sessionmaker(session.bind, expire_on_commit=False)

    async def _fake_run_in_session(fn, **_kwargs):
        async with factory() as sess:
            result = await fn(sess)
            await sess.commit()
            return result

    async def _fake_run_in_read_session(fn, **_kwargs):
        async with factory() as sess:
            return await fn(sess)

    monkeypatch.setattr(dw, "run_in_session", _fake_run_in_session)
    monkeypatch.setattr(dw, "run_in_read_session", _fake_run_in_read_session)


class _ListModelsAdapter:
    def __init__(self, models: list[str]):
        self._models = models

    async def list_models(self, *, base_url, secret, default_headers=None):
        return list(self._models)

    async def list_models_detailed(self, *, base_url, secret, default_headers=None):
        from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata

        return [ModelMetadata(id=model_id) for model_id in self._models]


async def test_discovery_does_not_auto_retire_desired_role_upstream(db_session, monkeypatch):
    from datetime import timedelta
    from unittest.mock import patch

    from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
    from stitch_backend.domains.ai_gateway.models import _utcnow

    endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="RB",
        adapter_type="openai_compatible",
        base_url="https://api.reformboss.com/v1",
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id,
        "key-rb",
        "api_key",
        "sk-rb",
    )
    cred.runtime_status = "active"
    upstream = await UpstreamModelService(db_session).upsert_model(endpoint.id, "kimi-k3")
    upstream.selection_source = "auto"
    upstream.last_seen_at = _utcnow() - timedelta(days=8)
    await PublicModelService(db_session).create_public_model("rb/lead")
    db_session.add(RoleChainEntry(
        public_model_id="rb/lead",
        endpoint_selector="reformboss",
        upstream_model_key="kimi-k3",
        family="moonshot",
        ordinal=0,
        enabled=True,
        source="default",
    ))
    await db_session.commit()

    _patch_worker_db(monkeypatch, db_session)
    with patch(
        "stitch_backend.domains.ai_gateway.discovery_worker.get_adapter",
        return_value=_ListModelsAdapter(["gpt-4"]),
    ):
        await DiscoveryWorker._discover_all()

    db_session.expire_all()
    rows = (await db_session.execute(select(UpstreamModel))).scalars().all()
    by_key = {row.upstream_model_id: row for row in rows}
    assert by_key["kimi-k3"].enabled is True
    assert not (by_key["kimi-k3"].capabilities or {}).get("retired_auto")


async def test_disabled_but_desired_upstream_remains_probe_eligible(db_session, monkeypatch):
    import stitch_backend.domains.ai_gateway.probe_worker as probe_worker

    endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="RB",
        adapter_type="openai_compatible",
        base_url="https://api.reformboss.com/v1",
    )
    cred = await CredentialService(db_session).create_credential(
        endpoint.id,
        "key-rb",
        "api_key",
        "sk-rb",
    )
    cred.runtime_status = "active"
    upstream = await UpstreamModelService(db_session).upsert_model(
        endpoint.id,
        "kimi-k3",
        capabilities={"retired_auto": True},
    )
    upstream.enabled = False
    pub = await PublicModelService(db_session).create_public_model("rb/lead")
    target = await RouteTargetService(db_session).create_target(pub.id, upstream.id, priority=10)
    target.managed_by = "role_catalog"
    target.lifecycle_status = "quarantined"
    target.enabled = False
    db_session.add(RoleChainEntry(
        public_model_id="rb/lead",
        endpoint_selector="reformboss",
        upstream_model_key="kimi-k3",
        family="moonshot",
        ordinal=0,
        enabled=True,
        source="default",
    ))
    await CredentialModelAccessService(db_session).upsert_access(
        cred.id,
        upstream.id,
        status="temporarily_unavailable",
    )
    await db_session.commit()

    async def fake_read_session(op):
        return await op(db_session)

    monkeypatch.setattr(probe_worker, "run_in_read_session", fake_read_session)
    probe_worker._reset_role_probe_backoff()
    candidates = await probe_worker.ProbeWorker._load_role_probe_candidates()
    assert len(candidates) == 1
    assert candidates[0]["upstream_row_id"] == upstream.id
    assert candidates[0]["upstream_model_id"] == "kimi-k3"

    # A manually disabled upstream is not probe-eligible: probing cannot
    # activate it anyway, and automation must not override the operator.
    upstream.capabilities = {}
    await db_session.commit()
    assert await probe_worker.ProbeWorker._load_role_probe_candidates() == []


async def test_successful_probe_does_not_override_manual_upstream_disable(db_session):
    _endpoint, cred, upstream, _pub = await _seed_route(db_session)
    upstream.enabled = False
    upstream.capabilities = {"verification_status": "failed"}
    await db_session.commit()

    await RoleCatalogService(db_session).apply_model_probe_result(
        credential_id=cred.id,
        upstream_model_id=upstream.upstream_model_id,
        probe_row={"ok": True, "latencyMs": 20},
    )
    await db_session.commit()

    assert upstream.enabled is False
    assert upstream.capabilities.get("verification_status") == "working"


async def test_endpoint_update_to_reformboss_reconciles_role_catalog(db_session):
    from stitch_backend.domains.ai_gateway.commands.endpoints import (
        cmd_create_provider_endpoint,
        cmd_update_provider_endpoint,
    )

    created = await cmd_create_provider_endpoint.__wrapped__(
        db_session,
        {
            "name": "RB",
            "adapter_type": "openai_compatible",
            "base_url": "https://example.com/v1",
        },
    )
    assert (await db_session.execute(select(RouteTarget))).scalars().all() == []

    updated = await cmd_update_provider_endpoint.__wrapped__(
        db_session,
        {"id": created.id, "base_url": "https://api.reformboss.com/v1"},
    )
    assert updated is not None
    targets = (await db_session.execute(select(RouteTarget))).scalars().all()
    entries = (await db_session.execute(select(RoleChainEntry))).scalars().all()
    assert entries, "endpoint update must materialize desired rb/* chain entries"
    assert targets, "endpoint update must materialize rb/* route targets immediately"
    assert any(t.public_model_id == "rb/lead" for t in targets)


# ═══════════════════════════════════════════════════════════════════════════
# Sticky sessions
# ═══════════════════════════════════════════════════════════════════════════


def test_session_hint_precedence_and_fallbacks():
    body = {
        "prompt_cache_key": "body-hint",
        "metadata": {"session_id": "metadata-hint"},
        "user": "user-hint",
        "messages": [{"role": "user", "content": "opening prompt"}],
    }
    assert extract_session_hint({"X-OpenCode-Session": "header-hint"}, body) == "header-hint"
    assert extract_session_hint({}, body) == "body-hint"

    without_body_hint = dict(body)
    without_body_hint.pop("prompt_cache_key")
    assert extract_session_hint({}, without_body_hint) == "metadata-hint"

    without_metadata = dict(without_body_hint)
    without_metadata.pop("metadata")
    assert extract_session_hint({}, without_metadata) == "user-hint"

    fingerprint = extract_session_hint({}, {"messages": body["messages"]})
    assert fingerprint is not None and fingerprint.startswith("fp:")

    responses_hint = extract_session_hint(
        {},
        {"input": [{"role": "user", "content": [{"type": "input_text", "text": "hello"}]}]},
    )
    assert responses_hint is not None and responses_hint.startswith("fp:")


def test_session_hint_is_private_and_never_forwarded_upstream():
    payload = GatewayRequest(
        model="rb/lead",
        messages=[{"role": "user", "content": "hi"}],
        session_hint="client-supplied-collision",
        prompt_cache_key="cache-key",
    )
    assert payload.sdk_payload().get("session_hint") is None
    assert payload.sdk_payload().get("prompt_cache_key") == "cache-key"

    routed = payload.model_copy(update={"session_hint": "internal-hint"})
    assert routed.session_hint == "internal-hint"
    assert "session_hint" not in routed.sdk_payload()
    assert "session_hint" not in _adapter_options(routed)


def test_affinity_keys_are_model_scoped_even_for_explicit_user():
    messages = [{"role": "user", "content": "same opening"}]
    account_ledger.put_affinity(
        "rb/lead",
        messages,
        "same-user",
        "endpoint-a",
        "group-a",
        "upstream-a",
        session_hint="same-session",
    )

    assert account_ledger.get_affinity(
        "rb/lead", messages, "same-user", session_hint="same-session",
    ) == ("endpoint-a", "group-a", "upstream-a")
    assert account_ledger.get_affinity(
        "rb/reviewer-correctness", messages, "same-user", session_hint="same-session",
    ) is None


def _fake_result(
    upstream_row_id: str,
    *,
    credential_id: str,
    endpoint_id: str,
    priority: int = 0,
    account_group: str | None = "group-a",
) -> RoutingResult:
    endpoint = SimpleNamespace(id=endpoint_id, name=endpoint_id)
    credential = SimpleNamespace(
        id=credential_id,
        account_group=account_group,
        last_success_at=None,
    )
    upstream = SimpleNamespace(id=upstream_row_id, upstream_model_id=upstream_row_id)
    return RoutingResult(
        endpoint=endpoint,
        credential=credential,
        upstream_model=upstream,
        adapter=object(),
        secret="",
        default_headers={},
        route_target_priority=priority,
        lifecycle_status="active",
    )


def test_sticky_bucket_moves_to_front_and_marks_only_that_bucket():
    first = _fake_result("upstream-a", credential_id="cred-a", endpoint_id="endpoint-a")
    second = _fake_result("upstream-b", credential_id="cred-b", endpoint_id="endpoint-b")
    affinity = ("endpoint-b", "group-a", "upstream-b")

    ordered = _reorder_cached([first, second], affinity, {})

    assert [r.upstream_model.id for r in ordered] == ["upstream-b", "upstream-a"]
    assert ordered[0].sticky_hit is True
    assert ordered[1].sticky_hit is False


def test_sticky_never_pins_a_dead_or_ineligible_target():
    eligible = _fake_result("upstream-a", credential_id="cred-a", endpoint_id="endpoint-a")
    affinity = ("endpoint-dead", "group-a", "upstream-dead")

    ordered = _reorder_cached([eligible], affinity, {})

    assert ordered[0].upstream_model.id == "upstream-a"
    assert ordered[0].sticky_hit is False


# ═══════════════════════════════════════════════════════════════════════════
# Passive latency-aware ordering
# ═══════════════════════════════════════════════════════════════════════════


def _observe(credential_id: str, upstream_row_id: str, value_ms: float) -> None:
    import time

    now = time.monotonic()
    for offset in range(model_latency.MIN_TTFT_OBSERVATIONS):
        model_latency.model_latency_tracker.record(
            credential_id,
            upstream_row_id,
            value_ms,
            now=now + offset,
        )


def test_latency_reorders_only_within_same_priority_buckets():
    slow = _fake_result("upstream-slow", credential_id="cred-slow", endpoint_id="endpoint-a", priority=0)
    fast = _fake_result("upstream-fast", credential_id="cred-fast", endpoint_id="endpoint-b", priority=0)
    _observe("cred-slow", "upstream-slow", 2_000.0)
    _observe("cred-fast", "upstream-fast", 50.0)

    ordered = _reorder_cached([slow, fast], None, {})
    assert [r.upstream_model.id for r in ordered] == ["upstream-fast", "upstream-slow"]


def test_latency_never_crosses_chain_priority_boundary():
    slow_primary = _fake_result(
        "upstream-slow", credential_id="cred-slow", endpoint_id="endpoint-a", priority=0,
    )
    fast_fallback = _fake_result(
        "upstream-fast", credential_id="cred-fast", endpoint_id="endpoint-b", priority=10,
    )
    _observe("cred-slow", "upstream-slow", 2_000.0)
    _observe("cred-fast", "upstream-fast", 50.0)

    ordered = _reorder_cached([slow_primary, fast_fallback], None, {})
    assert [r.upstream_model.id for r in ordered] == ["upstream-slow", "upstream-fast"]


def test_unknown_latency_is_neutral_not_slow():
    unknown = _fake_result("upstream-unknown", credential_id="cred-unknown", endpoint_id="endpoint-a")
    slow = _fake_result("upstream-slow", credential_id="cred-slow", endpoint_id="endpoint-b")
    _observe("cred-slow", "upstream-slow", 2_000.0)

    ordered = _reorder_cached([slow, unknown], None, {})
    assert [r.upstream_model.id for r in ordered] == ["upstream-unknown", "upstream-slow"]


# ═══════════════════════════════════════════════════════════════════════════
# Observability additions
# ═══════════════════════════════════════════════════════════════════════════


async def test_manual_disable_of_active_target_leaves_verified_not_active(db_session):
    _endpoint, _cred, _upstream, pub = await _seed_route(db_session)
    target = (
        await RouteTargetService(db_session).list_targets_for_public_model(pub.id)
    )[0]
    target.managed_by = "role_catalog"
    target.lifecycle_status = "active"
    await db_session.commit()

    await RoleCatalogService(db_session).mark_target_manual_override(
        target,
        {"enabled": False},
    )
    await db_session.commit()

    assert target.managed_by == "manual"
    assert target.lifecycle_status == "verified"
    assert target.lifecycle_reason == "manual_override"


async def test_route_target_response_serializes_lifecycle_fields(db_session):
    from stitch_backend.domains.ai_gateway.schemas import RouteTargetResponse

    _endpoint, _cred, upstream, pub = await _seed_route(db_session)
    target = (
        await RouteTargetService(db_session).list_targets_for_public_model(pub.id)
    )[0]
    target.managed_by = "role_catalog"
    target.lifecycle_status = "active"
    target.lifecycle_reason = "probe_success"
    target.lifecycle_updated_at = datetime.now(UTC)
    await db_session.commit()

    wire = RouteTargetResponse.from_orm_model(target).model_dump(by_alias=True)
    assert wire["managedBy"] == "role_catalog"
    assert wire["lifecycleStatus"] == "active"
    assert wire["lifecycleReason"] == "probe_success"
    assert wire["lifecycleUpdatedAt"] is not None
    assert wire["upstreamModelId"] == upstream.id


def test_request_trace_additive_fields_keep_legacy_aliases():
    trace = RequestTrace(
        model="rb/lead",
        target="ReformBoss",
        credential_id="credential-1",
        latency_ms=12.5,
        failover_count=1,
        status="success",
        timestamp=123.0,
        requested_model="rb/lead",
        served_public_model="rb/lead",
        upstream_model="kimi-k3",
        endpoint_id="endpoint-1",
        lifecycle_status="active",
        sticky_hit=True,
        failover_reasons=("model_not_found:no_channel", "inflight_cap"),
    ).to_dict()

    assert trace["model"] == "rb/lead"
    assert trace["target"] == "ReformBoss"
    assert trace["requested_model"] == "rb/lead"
    assert trace["served_public_model"] == "rb/lead"
    assert trace["upstream_model"] == "kimi-k3"
    assert trace["endpoint_id"] == "endpoint-1"
    assert trace["lifecycle_status"] == "active"
    assert trace["sticky_hit"] is True
    assert trace["failover_reasons"] == ["model_not_found:no_channel", "inflight_cap"]


async def test_role_model_usage_groups_requested_served_and_upstream(db_session):
    await record_request_log(
        db_session,
        model="rb/lead",
        served_public_model="rb/lead",
        upstream_model="kimi-k3",
        credential_id="cred-1",
        status="success",
        input_tokens=3,
        output_tokens=4,
        latency_ms=10.0,
    )
    await record_request_log(
        db_session,
        model="rb/lead",
        served_public_model="rb/planner",
        upstream_model="gemini-4-carbon",
        credential_id="cred-2",
        status="success",
        input_tokens=1,
        output_tokens=2,
        latency_ms=20.0,
    )
    await db_session.commit()

    rows = await AiProxyAnalytics.get_role_model_usage(db_session)
    assert len(rows) == 2
    by_upstream = {row["upstream_model"]: row for row in rows}
    assert by_upstream["kimi-k3"]["model"] == "rb/lead"
    assert by_upstream["kimi-k3"]["served_public_model"] == "rb/lead"
    assert by_upstream["kimi-k3"]["tokens"] == 7
    assert by_upstream["gemini-4-carbon"]["served_public_model"] == "rb/planner"
    assert by_upstream["gemini-4-carbon"]["tokens"] == 3
