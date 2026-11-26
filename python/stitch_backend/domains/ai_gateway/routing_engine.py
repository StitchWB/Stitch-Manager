"""AI Gateway routing engine — capability-aware request routing.

Resolves a public model ID to a concrete (endpoint, credential, upstream model)
triple, applying capability filtering, circuit-breaker checks, and priority/
weight-based selection.

This is the single entry point the executor should call instead of the
current wildcard LiteLLM deployment selection.

Pool routing (Wave-2)
---------------------
``RoutingEngine.route(session, request, pool)`` and
``get_available_public_models(session, pool)`` take a :class:`PoolScope`
that defines which credentials/public models the caller may see:

  - ``owner_user_id``: the caller's user id (``None`` for desktop / auth-disabled).
  - ``group_ids``: groups the caller is a member of (empty for desktop).
  - ``include_instance_shared``: whether NULL-owner (instance-shared) rows
    are visible (default ``True`` — preserves the legacy desktop pool).

The pool predicate is ``(owner_id == uid OR owner_id IS NULL OR cgs.group_id IN groups)``
applied as a single prefetch grouped by ``upstream_model_id``; per-target
filtering happens in memory (no per-target DB query).
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import aliased

from stitch_backend.core.event_bus import Event, event_bus
from stitch_backend.domains.ai_gateway import account_ledger, circuit_breaker, credential_state
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProviderAdapter,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,
    CredentialModelAccess,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)

# NOTE: ``Group`` and ``GroupUsage`` are NOT imported at top level — that
# would re-create the ``ai_gateway → groups`` import edge we just cut.
# They are lazy-imported inside ``_over_quota_group_ids`` (the only
# function that reads quota) so the only remaining dependency edge is
# ``groups → ai_gateway`` (one-way).

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3


# ═══════════════════════════════════════════════════════════════════════════
# Pool scope
# ═══════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class PoolScope:
    """Which credentials/public models a caller may route against.

    ``owner_user_id`` is the caller's user id (``None`` for desktop /
    auth-disabled installs).  ``group_ids`` is the tuple of groups the
    caller is a member of (empty for desktop).  ``include_instance_shared``
    controls whether NULL-owner (instance-shared) rows are visible —
    defaults to ``True`` to preserve the legacy desktop pool.
    """

    owner_user_id: int | None
    group_ids: tuple[str, ...] = ()
    include_instance_shared: bool = True


# ═══════════════════════════════════════════════════════════════════════════
# Request / result types
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class GatewayRequest:
    """Minimal request shape the routing engine needs."""

    model: str  # public model ID
    messages: list[dict[str, Any]] = field(default_factory=list)
    stream: bool = False
    tools: list[dict[str, Any]] | None = None
    response_format: dict[str, Any] | None = None
    user: str | None = None

    def __post_init__(self) -> None:
        if not self.model or not isinstance(self.model, str):
            raise ValueError("model must be a non-empty string")
        if not isinstance(self.messages, list):
            raise ValueError("messages must be a list")


@dataclass
class RoutingResult:
    """Everything the executor needs to make the upstream call."""

    endpoint: ProviderEndpoint
    credential: Credential
    upstream_model: UpstreamModel
    adapter: ProviderAdapter
    secret: str = field(repr=False)
    default_headers: dict[str, str]
    group_id_hit: str | None = None
    """Share row that made the credential visible (``None`` via owner/instance-shared)."""
    probe_lease: circuit_breaker.ProbeLease | None = field(default=None, repr=False)
    """Half-open probe lease carried through executor re-checks and outcome recording."""
    access_status: str = "available"
    """CredentialModelAccess status captured when the candidate was resolved."""
    access_row: CredentialModelAccess | None = field(default=None, repr=False)
    """Already-loaded access row used for cheap defensive cache-hit revalidation."""
    public_model_contract: dict[str, Any] | None = field(default=None, repr=False)
    """The public model's contract (e.g. latency watchdog policy) as resolved.

    Carried so the invoke pipeline can honor per-model contracts without a
    redundant database re-read; the pipeline keeps its TTL-cache fallback for
    candidates built outside routing.
    """


class RoutingError(Exception):
    """Raised when no valid route can be found."""


class QuotaExceededError(RoutingError):
    """Raised when every route was excluded by group quota rules.

    Carries the over-quota group ids so the HTTP layer can answer 429
    with actionable detail instead of a generic 503.
    """

    def __init__(self, message: str, *, groups: list[str] | None = None) -> None:
        super().__init__(message)
        self.groups = groups or []


class UpstreamFailureError(RoutingError):
    """Raised when every candidate failed upstream.

    Carries a provider-agnostic ``reason`` and HTTP ``status_code`` so the
    gateway answers with a canonical envelope instead of leaking the raw
    upstream error text of the last attempt.
    """

    def __init__(
        self,
        message: str,
        *,
        reason: str = "upstream_error",
        status_code: int = 502,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.status_code = status_code


class ContextLengthExceededError(RoutingError):
    """Raised when the request input exceeds the public model's context window.

    A client-side error (HTTP 400): no target of this public model can serve
    the request, so it must not be retried or fanned out to upstream.
    """

    status_code = 400

    def __init__(
        self,
        message: str,
        *,
        model: str,
        requested_tokens: int,
        max_tokens: int,
    ) -> None:
        super().__init__(message)
        self.model = model
        self.requested_tokens = requested_tokens
        self.max_tokens = max_tokens


_RESOLVE_CACHE_MAX_ENTRIES = 256

# Generation counter, not a registry: each engine drops its cache when it sees a generation it did not populate.
_resolve_cache_generation = 0


def _invalidate_resolve_caches() -> None:
    global _resolve_cache_generation
    _resolve_cache_generation += 1


def invalidate_resolve_caches() -> None:
    """Drop process-local route-resolution caches after an authoritative mutation."""
    _invalidate_resolve_caches()


@event_bus.on("credential.state_changed")
@event_bus.on("endpoint.models_changed")
@event_bus.on("credential.model_access_changed")
async def _on_routing_state_changed(_event: Event) -> None:
    _invalidate_resolve_caches()


@dataclass
class _CachedResolution:
    """Resolved candidates for one (model, pool, requirements) key; results carry no secret."""

    min_context: int | None
    results: list[RoutingResult]
    headroom: dict[str, float] = field(default_factory=dict)


# How many credentials (LRU-ordered) each route target contributes as
# candidates.  >1 lets the executor fail over between keys of the SAME
# upstream model within one request (e.g. a 429 on key A retries with
# key B) instead of failing the whole request.
MAX_CANDIDATES_PER_TARGET = 3

# ниже этого остатка ключ не выбираем: одного запроса может не хватить
_MIN_REMAINING_USD = 0.5

# Predictive scoring: _MIN_HEALTH floors a fully-dead target so it sorts last, not to zero.
_REFERENCE_LATENCY_MS = 1000.0
_MIN_HEALTH = 0.05


def _score(
    weight: float,
    cost_modifier: float,
    snapshot: credential_state.MetricsSnapshot,
) -> float:
    """Dynamic candidate score: weight scaled by health and latency, divided by cost."""
    health = max(snapshot.success_rate, _MIN_HEALTH) if snapshot.has_data else 1.0
    latency = snapshot.p50_latency_ms if snapshot.p50_latency_ms > 0 else _REFERENCE_LATENCY_MS
    latency_factor = max(latency, _REFERENCE_LATENCY_MS) / _REFERENCE_LATENCY_MS
    cost = max(cost_modifier, 1e-6)
    return weight * health / latency_factor / cost


def _order_candidates(
    candidates: list[tuple[RouteTarget, UpstreamModel]],
    rotation_strategy: str | None,
) -> list[tuple[RouteTarget, UpstreamModel]]:
    """Order targets: user policy primary, dynamic score secondary.

    ``rotation_strategy`` is the outer policy — the user's explicit ``priority``
    tier stays the hard ordering, so the dynamic score only refines targets
    that share a tier and never overrides the user's choice.  Only the
    priority+LRU policy is implemented today (round-robin/random are out of
    scope); every strategy maps to it.
    """
    return sorted(
        candidates,
        key=lambda pair: (
            pair[0].priority,
            -_score(
                pair[0].weight,
                pair[0].cost_modifier,
                credential_state.metrics_store.snapshot(pair[1].provider_endpoint_id),
            ),
        ),
    )


_EPOCH = datetime.min.replace(tzinfo=UTC)


def _balance_key(
    credential: Credential,
    endpoint_id: str,
    affinity: tuple[str, str | None] | None,
    headroom: dict[str, float],
) -> tuple[Any, ...]:
    group = credential.account_group
    affinity_match = 1 if affinity is not None and affinity == (endpoint_id, group) else 0
    return (
        -affinity_match,
        -headroom.get(credential.id, 1.0),
        credential.last_success_at or _EPOCH,
        -_score(1.0, 1.0, credential_state.metrics_store.snapshot(credential.id)),
        random.random(),
    )


def _reorder_cached(
    results: list[RoutingResult],
    affinity: tuple[str, str | None] | None,
    headroom: dict[str, float],
) -> list[RoutingResult]:
    buckets: dict[str, list[RoutingResult]] = {}
    order: list[str] = []
    for result in results:
        key = result.upstream_model.id
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(result)
    ordered: list[RoutingResult] = []
    for key in order:
        bucket = buckets[key]
        endpoint_id = bucket[0].endpoint.id
        ordered.extend(
            sorted(
                bucket,
                key=lambda result: _balance_key(
                    result.credential, endpoint_id, affinity, headroom,
                ),
            ),
        )
    return ordered


# ═══════════════════════════════════════════════════════════════════════════
# Capability derivation
# ═══════════════════════════════════════════════════════════════════════════


def derive_requirements(request: GatewayRequest) -> dict[str, bool]:
    """Infer capability requirements from request content."""
    reqs: dict[str, bool] = {
        "vision": False,
        "tools": False,
        "json_mode": False,
        "streaming": request.stream,
    }

    # Check messages for image content.
    for msg in request.messages:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    reqs["vision"] = True
                    break
        if reqs["vision"]:
            break

    if request.tools:
        reqs["tools"] = True

    rf = request.response_format
    if isinstance(rf, dict) and rf.get("type") == "json_schema":
        reqs["json_mode"] = True

    return reqs


def _cap_value(capabilities: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = capabilities.get(key)
        if value is not None:
            return value
    return None


def _model_satisfies(capabilities: dict[str, Any] | None, requirements: dict[str, bool]) -> bool:
    """Check if an upstream model's capabilities satisfy the request requirements."""
    if not capabilities:
        # No capability data — assume it can handle anything (optimistic).
        return True

    cap_map = {
        "vision": capabilities.get("supports_vision"),
        "tools": _cap_value(
            capabilities,
            "supports_tool_calling",
            "supports_function_calling",
            "supports_tools",
        ),
        "json_mode": capabilities.get("supports_json_mode") or capabilities.get("supports_json_schema"),
        "streaming": capabilities.get("supports_streaming"),
    }

    for req_key, required in requirements.items():
        if not required:
            continue
        cap_val = cap_map.get(req_key)
        # None/unknown = assume yes (optimistic), False = reject.
        if cap_val is False:
            return False

    return True


def _estimate_text_tokens(text: str) -> int:
    """Rough token estimate (ceil(bytes / 3.5)); overestimates, the safe direction for a hard gate."""
    if not text:
        return 0
    byte_count = len(text.encode("utf-8"))
    return max(1, int((byte_count + 3) // 3.5))


def _estimate_input_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            total += _estimate_text_tokens(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str):
                        total += _estimate_text_tokens(text)
    return total


# ═══════════════════════════════════════════════════════════════════════════
# Routing engine
# ═══════════════════════════════════════════════════════════════════════════


class RoutingEngine:
    """Capability-aware request router for the AI Gateway."""

    def __init__(self) -> None:
        self._resolve_cache: dict[tuple[Any, ...], _CachedResolution] = {}
        self._resolve_cache_gen = _resolve_cache_generation

    def _cache_lookup(self, key: tuple[Any, ...]) -> _CachedResolution | None:
        if self._resolve_cache_gen != _resolve_cache_generation:
            self._resolve_cache.clear()
            self._resolve_cache_gen = _resolve_cache_generation
        return self._resolve_cache.get(key)

    def _cache_store(self, key: tuple[Any, ...], value: _CachedResolution) -> None:
        if (
            len(self._resolve_cache) >= _RESOLVE_CACHE_MAX_ENTRIES
            and key not in self._resolve_cache
        ):
            self._resolve_cache.clear()
        self._resolve_cache[key] = value

    async def _resolve_from_cache(
        self,
        session: AsyncSession,
        cached: _CachedResolution,
        pool: PoolScope,
        request: GatewayRequest,
    ) -> list[RoutingResult] | None:
        if cached.min_context is not None:
            estimated = _estimate_input_tokens(request.messages)
            if estimated > cached.min_context:
                raise ContextLengthExceededError(
                    f"Request input (~{estimated} tokens) exceeds the "
                    f"{cached.min_context}-token context window of public model "
                    f"{request.model!r}",
                    model=request.model,
                    requested_tokens=estimated,
                    max_tokens=cached.min_context,
                )
        cred_svc = CredentialService(session)
        now = _utcnow()
        results: list[RoutingResult] = []
        for cached_result in cached.results:
            if cached_result.endpoint.enabled is False:
                continue
            credential = cached_result.credential
            # Cached rows are snapshots.  Mutations normally invalidate the
            # generation, but re-check the already-loaded authoritative fields
            # defensively so a stale object can never resurrect a disabled or
            # parked credential.  This stays cheap: no extra database reads.
            if not credential.enabled:
                continue
            if credential.runtime_status not in ("active", "unknown"):
                continue
            access_status = (
                cached_result.access_row.status
                if cached_result.access_row is not None
                else cached_result.access_status
            )
            if access_status != "available":
                continue
            if credential.next_retry_at is not None and credential.next_retry_at > now:
                continue
            secret = await cred_svc.resolve_invocation_secret(credential)
            if secret is None:
                continue
            results.append(replace(
                cached_result,
                secret=secret,
                access_status=access_status,
            ))
        if not results:
            return None
        if pool.group_ids:
            over_quota = await _over_quota_group_ids(session, pool, model=request.model)
            if over_quota:
                results = [
                    r for r in results
                    if r.group_id_hit is None or r.group_id_hit not in over_quota
                ]
                if not results:
                    return None
        affinity = account_ledger.get_affinity(
            request.model, request.messages, getattr(request, "user", None),
        )
        return _reorder_cached(results, affinity, cached.headroom)

    async def route(
        self,
        session: AsyncSession,
        request: GatewayRequest,
        pool: PoolScope | None = None,
        rotation_strategy: str | None = None,
    ) -> list[RoutingResult]:
        """Resolve a public model to a list of (endpoint, credential, upstream) candidates.

        Returns candidates ordered by priority/weight, with each candidate
        having an eligible credential. The executor should try candidates in
        order and fall back to the next if the first fails.

        Args:
            pool: Pool scope for the caller. When ``None``, defaults to
                ``PoolScope(None, (), True)`` (desktop / auth-disabled) —
                preserves the legacy behavior of routing over instance-shared
                (NULL-owner) rows only.
            rotation_strategy: The user's rotation policy (``priority``,
                ``least-used``, ...).  It is the outer ordering; the dynamic
                health/latency score only refines within it.

        Raises:
            RoutingError: if no valid route exists.
        """
        if pool is None:
            pool = PoolScope(owner_user_id=None)

        requirements = derive_requirements(request)
        cache_key = (request.model, pool, tuple(sorted(requirements.items())))
        cached = self._cache_lookup(cache_key)
        if cached is not None:
            hit = await self._resolve_from_cache(session, cached, pool, request)
            if hit is not None:
                return hit

        # 1. Resolve public model.
        pub_svc = PublicModelService(session)
        public_model = await pub_svc.get_by_pk(request.model)
        if public_model is None or not public_model.enabled:
            raise RoutingError(f"Public model {request.model!r} not found or disabled")

        # 1b. minContextTokens is the safe-min across targets; reject before any upstream call.
        min_context: int | None = None
        min_ctx = (public_model.contract or {}).get("minContextTokens")
        if isinstance(min_ctx, int) and not isinstance(min_ctx, bool):
            min_context = min_ctx
            estimated = _estimate_input_tokens(request.messages)
            if estimated > min_ctx:
                raise ContextLengthExceededError(
                    f"Request input (~{estimated} tokens) exceeds the "
                    f"{min_ctx}-token context window of public model "
                    f"{request.model!r}",
                    model=request.model,
                    requested_tokens=estimated,
                    max_tokens=min_ctx,
                )

        # 3. Get route targets (ordered by priority ASC, weight DESC).
        target_svc = RouteTargetService(session)
        targets = await target_svc.list_targets_for_public_model(public_model.id)
        enabled_targets = [t for t in targets if t.enabled]
        if not enabled_targets:
            raise RoutingError(f"No enabled route targets for {request.model!r}")

        # 4. Filter by capability and endpoint availability.
        model_svc = UpstreamModelService(session)
        candidates: list[tuple[RouteTarget, UpstreamModel]] = []
        endpoint_ids: set[str] = set()
        for target in enabled_targets:
            upstream = await model_svc.get_by_pk(target.upstream_model_id)
            if upstream is None or not upstream.enabled:
                continue
            if not _model_satisfies(upstream.capabilities, requirements):
                continue
            candidates.append((target, upstream))
            endpoint_ids.add(upstream.provider_endpoint_id)

        if not candidates:
            raise RoutingError(
                f"No route targets satisfy requirements {requirements} for {request.model!r}",
            )

        enabled_endpoint_ids = set(
            (
                await session.execute(
                    select(ProviderEndpoint.id).where(
                        ProviderEndpoint.id.in_(endpoint_ids),
                        ProviderEndpoint.enabled.is_(True),
                    ),
                )
            ).scalars().all(),
        )
        candidates = [
            pair for pair in candidates
            if pair[1].provider_endpoint_id in enabled_endpoint_ids
        ]
        if not candidates:
            raise RoutingError(f"No enabled route targets for {request.model!r}")

        candidates = _order_candidates(candidates, rotation_strategy)

        # 5. ONE prefetch: eligible credentials grouped by upstream_model_id.
        # The pool predicate (owner_id == uid OR owner_id IS NULL OR
        # cgs.group_id IN groups) is applied here, plus the existing
        # enabled/runtime_status/cooldown/endpoint filters. Per-target
        # filtering happens in memory (no per-target DB query).
        now = _utcnow()
        upstream_ids = [u.id for _t, u in candidates]
        cred_rows = await _fetch_pool_credentials(
            session, pool, upstream_ids,
        )

        # 5b. Quota-aware filtering: when the caller is a real user with
        # group memberships, exclude credentials whose only visibility is
        # via groups over quota FOR THIS MODEL (member rules + pool rules;
        # legacy per-member daily cap is evaluated as a synthetic rule).
        # Credentials owned by the caller or instance-shared
        # (group_id_hit is None) stay eligible.
        pre_quota_cred_count = len(cred_rows)
        over_quota = await _over_quota_group_ids(session, pool, model=request.model)
        if over_quota:
            cred_rows = [
                (uid_, cred, gid, access_status, access_row)
                for uid_, cred, gid, access_status, access_row in cred_rows
                if gid is None or gid not in over_quota
            ]

        # cred_rows: list[(upstream_model_id, Credential, group_id_hit,
        # access_status, access_row)] — index by upstream_model_id for
        # in-memory per-target lookup.
        creds_by_upstream: dict[
            str,
            list[tuple[Credential, str | None, str, CredentialModelAccess]],
        ] = {}
        for upstream_id, cred, group_id_hit, access_status, access_row in cred_rows:
            creds_by_upstream.setdefault(upstream_id, []).append(
                (cred, group_id_hit, access_status, access_row),
            )

        # 6. Per-target in-memory filtering + selection.
        cred_svc = CredentialService(session)
        results: list[RoutingResult] = []
        affinity = account_ledger.get_affinity(
            request.model, request.messages, getattr(request, "user", None),
        )
        headroom_cache: dict[str, float] = {}
        probe_leases: dict[str, circuit_breaker.ProbeLease] = {}

        for _target, upstream in candidates:
            eligible = creds_by_upstream.get(upstream.id, [])
            # Filter out credentials in cooldown (next_retry_at > now).
            eligible = [
                (c, gid, access_status, access_row)
                for c, gid, access_status, access_row in eligible
                if c.next_retry_at is None or c.next_retry_at <= now
            ]
            if not eligible:
                continue

            # 7. Check endpoint circuit breaker.  A half-open endpoint admits
            # exactly one leased logical probe; reuse the lease across targets
            # of this same routing call and reject unrelated callers.
            endpoint_id = upstream.provider_endpoint_id
            available, probe_lease = await circuit_breaker.check_endpoint_availability(
                session,
                endpoint_id,
                lease=probe_leases.get(endpoint_id),
            )
            if not available:
                continue
            if probe_lease is not None:
                probe_leases[endpoint_id] = probe_lease
            endpoint_probe_lease = probe_leases.get(endpoint_id)

            # 9. Get endpoint + adapter (shared by all credentials below).
            from stitch_backend.domains.ai_gateway.service import ProviderEndpointService
            ep_svc = ProviderEndpointService(session)
            endpoint = await ep_svc.get_by_pk(upstream.provider_endpoint_id)
            if endpoint is None or not endpoint.enabled:
                continue

            try:
                adapter = get_adapter(endpoint.adapter_type)
            except KeyError:
                logger.warning(
                    "RoutingEngine: no adapter registered for endpoint %s "
                    "(adapter_type=%r) — skipping candidate",
                    endpoint.id, endpoint.adapter_type,
                )
                continue

            for credential, _group_id_hit, _access_status, _access_row in eligible:
                if credential.id in headroom_cache:
                    continue
                headroom_cache[credential.id] = await account_ledger.headroom_ratio(
                    session,
                    upstream.provider_endpoint_id,
                    credential.account_group,
                    request.model,
                )
            eligible.sort(
                key=lambda pair: _balance_key(
                    pair[0], upstream.provider_endpoint_id, affinity, headroom_cache,
                ),
            )
            # квота дня сидит на аккаунте: ключи одной группы — одна квота, разводим группы
            picked: list[tuple[Any, str | None, str, CredentialModelAccess]] = []
            seen_groups: set[str] = set()
            deferred: list[tuple[Any, str | None, str, CredentialModelAccess]] = []
            for pair in eligible:
                group = pair[0].account_group
                if group is None or group not in seen_groups:
                    if group is not None:
                        seen_groups.add(group)
                    picked.append(pair)
                else:
                    deferred.append(pair)
            for pair in deferred:
                if len(picked) >= MAX_CANDIDATES_PER_TARGET:
                    break
                picked.append(pair)
            for cred, group_id_hit, access_status, access_row in picked[:MAX_CANDIDATES_PER_TARGET]:
                secret = await cred_svc.resolve_invocation_secret(cred)
                if secret is None:
                    continue

                # Attribution: log caller uid, credential_id, owner_id, group_id_hit.
                logger.info(
                    "RoutingEngine route: caller_uid=%s credential=%s owner_id=%s group_id_hit=%s",
                    pool.owner_user_id, cred.id, cred.owner_id, group_id_hit,
                )

                results.append(RoutingResult(
                    endpoint=endpoint,
                    credential=cred,
                    upstream_model=upstream,
                    adapter=adapter,
                    secret=secret,
                    default_headers=endpoint.default_headers or {},
                    group_id_hit=group_id_hit,
                    probe_lease=endpoint_probe_lease,
                    access_status=access_status,
                    access_row=access_row,
                    public_model_contract=public_model.contract or None,
                ))

        if not results:
            if over_quota and pre_quota_cred_count:
                raise QuotaExceededError(
                    f"Group quota exceeded for {request.model!r} "
                    f"(groups: {', '.join(sorted(over_quota))})",
                    groups=sorted(over_quota),
                )
            raise RoutingError(f"No eligible credentials found for {request.model!r}")

        # Half-open probe resolutions are intentionally not cached: the lease
        # belongs to this one logical request, and a cached copy would either
        # be unusable or (worse) reusable by unrelated traffic.
        if not any(r.probe_lease is not None for r in results):
            self._cache_store(
                cache_key,
                _CachedResolution(
                    min_context=min_context,
                    results=[replace(r, secret="") for r in results],
                    headroom=dict(headroom_cache),
                ),
            )
        return results

    async def record_result(
        self,
        session: AsyncSession,
        credential_id: str,
        endpoint_id: str,
        error: ClassifiedError | None,
        http_status: int | None,
        upstream_model_id: str | None = None,
        latency_ms: float | None = None,
        probe_lease: circuit_breaker.ProbeLease | None = None,
    ) -> None:
        """Record the outcome of a routed request.

        Attribution is scope-first:

        * key/account-scoped failures affect only the credential state machine;
        * model-scoped failures affect only ``CredentialModelAccess``;
        * endpoint/global-scoped failures affect only the endpoint breaker and
          never degrade a blameless credential;
        * successes still recover both the credential and the endpoint.

        Half-open probe leases are resolved for every outcome.  Non-endpoint
        evidence is inconclusive about endpoint health, so it frees the lease
        and re-arms only a short retry instead of either wedging the endpoint
        or spinning probes back-to-back.
        """
        endpoint_attributed = error is None or error.is_endpoint_wide or error.scope in (
            "endpoint", "global",
        )
        credential_state.record_outcome(
            credential_id=credential_id,
            endpoint_id=endpoint_id,
            ok=error is None,
            latency_ms=latency_ms,
            error_kind=credential_state.classify_error_kind(error, http_status),
            include_endpoint=endpoint_attributed,
        )
        model_specific = error is not None and error.is_model_specific
        if error is not None and model_specific:
            if upstream_model_id is not None:
                row = (await session.execute(select(CredentialModelAccess).where(
                    CredentialModelAccess.credential_id == credential_id,
                    CredentialModelAccess.upstream_model_id == upstream_model_id,
                ))).scalar_one_or_none()
                if row is not None:
                    # Invalidate the resolve cache only on a real transition —
                    # rewriting the same mark must not churn routing.
                    transitioned = row.status != "temporarily_unavailable"
                    row.status = "temporarily_unavailable"
                    row.last_error = error.category
                    row.last_verified_at = _utcnow()
                    await session.flush()
                    if transitioned:
                        _invalidate_resolve_caches()

        if model_specific:
            # Model-scoped failure: nothing about the credential or endpoint.
            await circuit_breaker.resolve_endpoint_probe_inconclusive(
                session, endpoint_id, lease=probe_lease,
            )
        elif not endpoint_attributed:
            # Key/account-scoped failure: credential evidence only.
            await credential_state.transition_credential(
                session, credential_id, error, http_status,
            )
            await circuit_breaker.resolve_endpoint_probe_inconclusive(
                session, endpoint_id, lease=probe_lease,
            )
        else:
            # Successes are credential evidence as well as endpoint evidence.
            # Endpoint/global failures, by definition, are not.
            if error is None:
                await credential_state.transition_credential(
                    session, credential_id, error, http_status,
                )
            await circuit_breaker.record_endpoint_result(
                session,
                endpoint_id,
                success=(error is None),
                lease=probe_lease,
            )

        # Role-catalog health hook: re-evaluate role-managed targets after the
        # access-row writes above, in the same write session.  Only meaningful
        # for model-scoped failures; the service ignores everything else.
        if upstream_model_id is not None and error is not None:
            try:
                from stitch_backend.domains.ai_gateway.role_catalog_service import (
                    RoleCatalogService,
                )
                await RoleCatalogService(session).note_upstream_outcome(
                    endpoint_id=endpoint_id,
                    upstream_model_id=upstream_model_id,
                    error=error,
                    credential_id=credential_id,
                )
            except Exception:
                logger.warning(
                    "Role-catalog outcome hook failed for %s/%s",
                    endpoint_id, upstream_model_id, exc_info=True,
                )

    async def get_available_public_models(
        self,
        session: AsyncSession,
        pool: PoolScope | None = None,
    ) -> list[PublicModel]:
        """Return all enabled public models visible to *pool* (for /v1/models).

        Applies the same pool predicate as :meth:`route` — fixes the prior
        bug where ``owner_id=None`` saw ONLY NULL rows (per-user public
        models were invisible).  Models whose route targets all sit on
        disabled endpoints are excluded, matching :meth:`route`.
        """
        if pool is None:
            pool = PoolScope(owner_user_id=None)

        stmt = select(PublicModel)
        where_clauses = [_pool_predicate_for_public_model(pool)]
        stmt = stmt.where(and_(*where_clauses))
        result = await session.execute(stmt)
        enabled_models = [m for m in result.scalars().all() if m.enabled]
        if not enabled_models:
            return []

        ids = [m.id for m in enabled_models]
        rows = await session.execute(
            select(RouteTarget.public_model_id, ProviderEndpoint.enabled)
            .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
            .join(ProviderEndpoint, ProviderEndpoint.id == UpstreamModel.provider_endpoint_id)
            .where(RouteTarget.public_model_id.in_(ids)),
        )
        endpoint_enabled: dict[str, list[bool]] = {}
        for public_model_id, enabled in rows.all():
            endpoint_enabled.setdefault(public_model_id, []).append(bool(enabled))
        return [
            m for m in enabled_models
            if m.id not in endpoint_enabled or any(endpoint_enabled[m.id])
        ]


# ═══════════════════════════════════════════════════════════════════════════
# Pool predicate helpers
# ═══════════════════════════════════════════════════════════════════════════


async def _over_quota_group_ids(
    session: AsyncSession,
    pool: PoolScope,
    model: str | None = None,
) -> set[str]:
    """Return the set of group ids over quota for (caller, *model*).

    No-op (returns ``set()``) when the caller is ``None`` (desktop) or has
    no group memberships.  Evaluation lives in
    :func:`groups.quota.over_quota_groups`: per-member rules (most
    specific wins, ``amount NULL`` = unlimited override) plus pool-wide
    rules over the whole group's combined usage.  The legacy
    ``max_requests_per_member_daily`` column is evaluated as a synthetic
    lowest-priority member rule, so old groups keep working unchanged.

    Also consults the in-process ``usage_tracker._over_keys`` flags set by
    the flush path — gives immediate visibility after a write commits,
    closing the in-process TOCTOU race to zero (the DB pre-check alone has
    a read→write gap).  Flags are keyed by concrete model
    (``(group_id, user_id, model, day)`` member / ``(group_id, None,
    model, day)`` pool); a NULL/glob-model rule that trips flags only the
    model just recorded — other models are covered by the DB pre-check
    within one flush interval.  Cross-process (multi-worker) stays bounded
    by the DB pre-check (documented).
    """
    uid = pool.owner_user_id
    if uid is None or not pool.group_ids:
        return set()
    # Lazy import — avoids a top-level ``ai_gateway → groups`` edge.
    from stitch_backend.domains.groups.quota import over_quota_groups

    model_key = model or ""
    over = await over_quota_groups(
        session, group_ids=pool.group_ids, user_id=uid, model=model_key,
    )
    # In-process immediate visibility: consult the _over_keys flags set by
    # the flush path (usage_tracker.flush_group_usage).  This catches
    # over-quota state that was just written but might not yet be visible
    # to the DB read query (read→write race window).
    from stitch_backend.domains.ai_gateway.usage_tracker import _over_keys
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    for gid in pool.group_ids:
        if (gid, uid, model_key, today) in _over_keys:
            over.add(gid)
        if (gid, None, model_key, today) in _over_keys:
            over.add(gid)
    return over


def _pool_predicate_for_credentials(
    pool: PoolScope,
    c_model,
    cgs_alias,
):
    """WHERE predicate for Credential rows visible to *pool*.

    ``(c.owner_id == uid OR (include_instance_shared AND c.owner_id IS NULL)
    OR cgs.group_id IN groups)``.  When ``owner_user_id`` is ``None``
    (desktop), the owner clause is omitted — only ``include_instance_shared``
    controls NULL-owner visibility.
    """
    clauses = []
    if pool.owner_user_id is not None:
        clauses.append(c_model.owner_id == pool.owner_user_id)
    if pool.include_instance_shared:
        clauses.append(c_model.owner_id.is_(None))
    if pool.group_ids:
        clauses.append(cgs_alias.group_id.in_(list(pool.group_ids)))
    return or_(*clauses) if clauses else false()


def _pool_predicate_for_public_model(pool: PoolScope):
    """WHERE predicate for PublicModel rows visible to *pool*."""
    clauses = []
    if pool.owner_user_id is not None:
        clauses.append(PublicModel.owner_id == pool.owner_user_id)
    if pool.include_instance_shared:
        clauses.append(PublicModel.owner_id.is_(None))
    return or_(*clauses) if clauses else false()


async def _fetch_pool_credentials(
    session: AsyncSession,
    pool: PoolScope,
    upstream_ids: list[str],
) -> list[tuple[str, Credential, str | None, str, CredentialModelAccess]]:
    """ONE prefetch: eligible credentials grouped by upstream_model_id.

    Returns a list of ``(upstream_model_id, Credential, group_id_hit,
    access_status, access_row)`` tuples where ``group_id_hit`` is the share row
    that made the credential visible (``None`` when visible via owner_id or
    instance-shared).  The access row itself is retained so cached resolutions
    can cheaply revalidate a routing-visible status already loaded in memory.

    Applies the pool predicate + existing enabled/runtime_status filters.
    """
    if not upstream_ids:
        return []

    cgs_alias = aliased(CredentialGroupShare)
    stmt = (
        select(
            CredentialModelAccess.upstream_model_id,
            Credential,
            cgs_alias.group_id.label("group_id_hit"),
            CredentialModelAccess.status.label("access_status"),
            CredentialModelAccess,
        )
        .select_from(Credential)
        .join(
            CredentialModelAccess,
            CredentialModelAccess.credential_id == Credential.id,
        )
        .outerjoin(
            cgs_alias,
            and_(
                cgs_alias.credential_id == Credential.id,
                *(
                    [cgs_alias.group_id.in_(list(pool.group_ids))]
                    if pool.group_ids
                    else []
                ),
            ),
        )
        .where(
            CredentialModelAccess.upstream_model_id.in_(upstream_ids),
            CredentialModelAccess.status == "available",
            Credential.enabled == True,  # noqa: E712
            Credential.runtime_status.in_(("active", "unknown")),
            or_(
                Credential.remaining_usd.is_(None),
                Credential.remaining_usd >= _MIN_REMAINING_USD,
            ),
            _pool_predicate_for_credentials(pool, Credential, cgs_alias),
        )
    )
    result = await session.execute(stmt)
    return [
        (
            row.upstream_model_id,
            row.Credential,
            row.group_id_hit,
            row.access_status,
            row.CredentialModelAccess,
        )
        for row in result.all()
    ]
