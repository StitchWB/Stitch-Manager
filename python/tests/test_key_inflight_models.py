"""Distinct-model in-flight caps in key_inflight (Phase 3A, ITEM-2).

Per spec section 7: a key may serve at most ``distinctModelsPerKey``
*different* upstream models concurrently; additional concurrency on a model
already in flight does not consume a new distinct slot.  Legacy callers that
never pass a model id observe exactly the old behavior.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from stitch_backend.domains.ai_proxy import key_inflight, litellm_executor
from stitch_backend.domains.ai_proxy.litellm_gateway import GatewayRequest


@pytest.fixture(autouse=True)
def _reset_inflight():
    key_inflight.reset()
    yield
    key_inflight.reset()


def test_same_model_does_not_consume_distinct_slot() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    # Same model again: still allowed (total cap permitting), no new slot.
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    assert key_inflight.distinct_models_in_flight("cred") == 1


def test_second_distinct_model_refused_at_cap() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    assert key_inflight.try_acquire("cred", "m-2", distinct_model_cap=1) is False
    # Other credentials are unaffected.
    assert key_inflight.try_acquire("cred-x", "m-2", distinct_model_cap=1)


def test_release_restores_distinct_slot() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    key_inflight.release("cred", "m-1")
    assert key_inflight.distinct_models_in_flight("cred") == 0
    assert key_inflight.try_acquire("cred", "m-2", distinct_model_cap=1)


def test_release_partial_keeps_model_slot() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    key_inflight.release("cred", "m-1")
    # One m-1 still in flight: the distinct slot is still occupied.
    assert key_inflight.distinct_models_in_flight("cred") == 1
    assert key_inflight.try_acquire("cred", "m-2", distinct_model_cap=1) is False
    key_inflight.release("cred", "m-1")
    assert key_inflight.try_acquire("cred", "m-2", distinct_model_cap=1)


def test_cap_two_allows_two_distinct_models() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=2)
    assert key_inflight.try_acquire("cred", "m-2", distinct_model_cap=2)
    assert key_inflight.try_acquire("cred", "m-3", distinct_model_cap=2) is False


def test_total_cap_still_enforced_with_models() -> None:
    for _ in range(key_inflight.PER_CREDENTIAL_CAP):
        assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=3)
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=3) is False


def test_legacy_caller_without_model_unchanged() -> None:
    for _ in range(key_inflight.PER_CREDENTIAL_CAP):
        assert key_inflight.try_acquire("cred")
    assert key_inflight.try_acquire("cred") is False
    key_inflight.release("cred")
    assert key_inflight.in_flight("cred") == key_inflight.PER_CREDENTIAL_CAP - 1
    assert key_inflight.try_acquire("cred")
    assert key_inflight.in_flight("cred") == key_inflight.PER_CREDENTIAL_CAP


def test_no_cap_means_no_distinct_restriction() -> None:
    assert key_inflight.try_acquire("cred", "m-1")
    assert key_inflight.try_acquire("cred", "m-2")
    assert key_inflight.try_acquire("cred", "m-3")


def test_would_acquire_after_release_ignores_current_total_slot() -> None:
    assert key_inflight.try_acquire("cred", "m-1", cap=1)
    assert not key_inflight.would_acquire_after_release("cred", "m-1", cap=1)
    assert key_inflight.would_acquire_after_release(
        "cred", "m-1", cap=1, released_slot=("cred", "m-1"),
    )
    # Non-mutating: the real slot is still occupied.
    assert key_inflight.in_flight("cred") == 1


def test_would_acquire_after_release_adjusts_distinct_model_state() -> None:
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    assert key_inflight.would_acquire_after_release(
        "cred",
        "m-2",
        distinct_model_cap=1,
        released_slot=("cred", "m-1"),
    )

    # A second concurrent m-1 means releasing this one slot does not free the
    # distinct-model slot for m-2.
    assert key_inflight.try_acquire("cred", "m-1", distinct_model_cap=1)
    assert not key_inflight.would_acquire_after_release(
        "cred",
        "m-2",
        distinct_model_cap=1,
        released_slot=("cred", "m-1"),
    )


# ── Executor integration ────────────────────────────────────────────────────


def _routing_result(
    credential_id: str,
    upstream_model_id: str,
    *,
    health_policy: dict[str, Any] | None = None,
) -> Any:
    credential = SimpleNamespace(id=credential_id, account_group=None)
    endpoint = SimpleNamespace(id="ep-1", health_policy=health_policy)
    upstream = SimpleNamespace(id=f"um-{upstream_model_id}", upstream_model_id=upstream_model_id)

    class _Adapter:
        def classify_error(self, exc: BaseException, **_: Any) -> Any:
            from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError

            return ClassifiedError(category="unknown")

    return SimpleNamespace(
        credential=credential, endpoint=endpoint, upstream_model=upstream,
        adapter=_Adapter(), secret="sk-test", default_headers={},
    )


async def _noop_async(*_: Any, **__: Any) -> None:
    return None


class _FailoverHarness:
    """Minimal `_run_failover` harness: routing and breaker stubbed out,
    success returns within the first round so no sleep/clock patching is
    needed."""

    def __init__(self, invoke: Any, routing_results: list[Any]) -> None:
        from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor

        self.executor = LiteLLMExecutor.__new__(LiteLLMExecutor)
        self.invoke = invoke
        self.payload = GatewayRequest(model="m-1", stream=False)
        self.outcome = litellm_executor._RequestOutcome(model="m-1", owner_id=None)
        self._routing_results = routing_results

    async def run(self, max_wait_seconds: int | None = 0) -> Any:
        async def fake_route(route_payload: Any, pool: Any = None) -> list[Any] | None:
            return list(self._routing_results)

        async def fake_available(endpoint_id: str, probe_lease: Any = None) -> bool:
            return True

        self.executor._try_ai_gateway_route = fake_route  # type: ignore[method-assign]
        self.executor._is_endpoint_available = fake_available  # type: ignore[method-assign]
        self.executor._record_request_trace = lambda **_: None  # type: ignore[method-assign]
        self.executor._emit_failover_event = _noop_async  # type: ignore[method-assign]
        from stitch_backend.domains.ai_proxy.litellm_errors import RoutingError

        try:
            result = await self.executor._run_failover(
                self.payload, config=None, invoke=self.invoke, outcome=self.outcome,
                max_wait_seconds=max_wait_seconds,
            )
            return {"result": result}
        except RoutingError as exc:
            return {"error": exc}


def test_distinct_model_cap_reader() -> None:
    read = litellm_executor._distinct_model_cap
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": 2}})) == 2
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": 1}})) == 1
    # Defensive: junk disables the cap.
    assert read(SimpleNamespace(health_policy=None)) is None
    assert read(SimpleNamespace(health_policy={})) is None
    assert read(SimpleNamespace(health_policy={"concurrency": {}})) is None
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": 0}})) is None
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": -1}})) is None
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": True}})) is None
    assert read(SimpleNamespace(health_policy={"concurrency": {"distinctModelsPerKey": "2"}})) is None
    assert read(SimpleNamespace(health_policy="junk")) is None
    assert read(SimpleNamespace()) is None


async def test_executor_skips_second_distinct_model_on_same_key() -> None:
    """A credential at its distinct-model cap is skipped without failure."""
    policy = {"concurrency": {"distinctModelsPerKey": 1}}
    results = [
        _routing_result("cred-a", "m-1", health_policy=policy),
        _routing_result("cred-a", "m-2", health_policy=policy),
        _routing_result("cred-b", "m-2", health_policy=policy),
    ]
    calls: list[tuple[str, str]] = []

    async def invoke(routing_result: Any) -> Any:
        calls.append((routing_result.credential.id, routing_result.upstream_model.upstream_model_id))
        # Hold the first acquisition while the round walks on?  No — invocations
        # are sequential in one round, so instead pre-seed the in-flight state:
        return {"ok": True}

    # Pre-seed: cred-a is already serving a *different* model elsewhere, so
    # both cred-a candidates below are new distinct models over the cap of 1.
    assert key_inflight.try_acquire("cred-a", "m-0", distinct_model_cap=1)

    harness = _FailoverHarness(invoke, results)
    outcome = await harness.run(max_wait_seconds=0)

    # cred-a/m-1 fails to acquire (slot busy), cred-a/m-2 is a *new* distinct
    # model over cap, so the first usable candidate is cred-b/m-2.
    assert outcome["result"] == {"ok": True}
    assert calls == [("cred-b", "m-2")]


async def test_executor_inflight_skip_does_not_count_as_failure() -> None:
    """Cap refusals skip the candidate silently — no failover increment."""
    policy = {"concurrency": {"distinctModelsPerKey": 1}}
    results = [
        _routing_result("cred-a", "m-1", health_policy=policy),
        _routing_result("cred-b", "m-2", health_policy=policy),
    ]

    async def invoke(routing_result: Any) -> Any:
        return {"ok": True}

    # Exhaust cred-a entirely.
    for _ in range(key_inflight.PER_CREDENTIAL_CAP):
        assert key_inflight.try_acquire("cred-a", "m-1")

    harness = _FailoverHarness(invoke, results)
    outcome = await harness.run(max_wait_seconds=0)

    assert outcome["result"] == {"ok": True}
    assert harness.outcome.failover_count == 0


async def test_executor_releases_model_slot_after_invoke() -> None:
    policy = {"concurrency": {"distinctModelsPerKey": 1}}
    results = [_routing_result("cred-a", "m-1", health_policy=policy)]

    async def invoke(routing_result: Any) -> Any:
        return {"ok": True}

    harness = _FailoverHarness(invoke, results)
    outcome = await harness.run(max_wait_seconds=0)

    assert outcome["result"] == {"ok": True}
    assert key_inflight.in_flight("cred-a") == 0
    assert key_inflight.distinct_models_in_flight("cred-a") == 0
