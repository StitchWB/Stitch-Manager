"""AI Gateway routing engine — capability-aware request routing.

Resolves a public model ID to a concrete (endpoint, credential, upstream model)
triple, applying capability filtering, circuit-breaker checks, and priority/
weight-based selection.

This is the single entry point the executor should call instead of the
current wildcard LiteLLM deployment selection.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.domains.ai_gateway import circuit_breaker, credential_state
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProviderAdapter,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
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

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3


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


class RoutingError(Exception):
    """Raised when no valid route can be found."""


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


def _model_satisfies(capabilities: dict[str, Any] | None, requirements: dict[str, bool]) -> bool:
    """Check if an upstream model's capabilities satisfy the request requirements."""
    if not capabilities:
        # No capability data — assume it can handle anything (optimistic).
        return True

    cap_map = {
        "vision": capabilities.get("supports_vision"),
        "tools": capabilities.get("supports_function_calling") or capabilities.get("supports_tools"),
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


# ═══════════════════════════════════════════════════════════════════════════
# Routing engine
# ═══════════════════════════════════════════════════════════════════════════


class RoutingEngine:
    """Capability-aware request router for the AI Gateway."""

    async def route(
        self,
        session: AsyncSession,
        request: GatewayRequest,
    ) -> list[RoutingResult]:
        """Resolve a public model to a list of (endpoint, credential, upstream) candidates.

        Returns candidates ordered by priority/weight, with each candidate
        having an eligible credential. The executor should try candidates in
        order and fall back to the next if the first fails.

        Raises:
            RoutingError: if no valid route exists.
        """
        # 1. Resolve public model.
        pub_svc = PublicModelService(session)
        public_model = await pub_svc.get_by_pk(request.model)
        if public_model is None or not public_model.enabled:
            raise RoutingError(f"Public model {request.model!r} not found or disabled")

        # 2. Derive requirements.
        requirements = derive_requirements(request)

        # 3. Get route targets (ordered by priority ASC, weight DESC).
        target_svc = RouteTargetService(session)
        targets = await target_svc.list_targets_for_public_model(public_model.id)
        enabled_targets = [t for t in targets if t.enabled]
        if not enabled_targets:
            raise RoutingError(f"No enabled route targets for {request.model!r}")

        # 4. Filter by capability.
        model_svc = UpstreamModelService(session)
        candidates: list[tuple[RouteTarget, UpstreamModel]] = []
        for target in enabled_targets:
            upstream = await model_svc.get_by_pk(target.upstream_model_id)
            if upstream is None or not upstream.enabled:
                continue
            if not _model_satisfies(upstream.capabilities, requirements):
                continue
            candidates.append((target, upstream))

        if not candidates:
            raise RoutingError(
                f"No route targets satisfy requirements {requirements} for {request.model!r}",
            )

        # 5. Find eligible credentials for each candidate.
        cred_svc = CredentialService(session)
        now = _utcnow()
        results: list[RoutingResult] = []

        for target, upstream in candidates:
            # Query credentials with model access.
            result = await session.execute(
                select(Credential)
                .join(
                    CredentialModelAccess,
                    CredentialModelAccess.credential_id == Credential.id,
                )
                .where(
                    and_(
                        CredentialModelAccess.upstream_model_id == upstream.id,
                        CredentialModelAccess.status == "available",
                        Credential.enabled == True,  # noqa: E712
                        Credential.runtime_status.in_(("active", "unknown")),
                        Credential.provider_endpoint_id == upstream.provider_endpoint_id,
                    ),
                ),
            )
            eligible_creds = list(result.scalars().all())

            # Filter out credentials in cooldown (next_retry_at > now).
            eligible_creds = [
                c for c in eligible_creds
                if c.next_retry_at is None or c.next_retry_at <= now
            ]

            if not eligible_creds:
                continue

            # 6. Check endpoint circuit breaker.
            if not await circuit_breaker.is_endpoint_available(
                session, upstream.provider_endpoint_id,
            ):
                continue

            # 7. Select credential (round-robin via least-recently-used).
            cred = min(
                eligible_creds,
                key=lambda c: c.last_success_at or datetime.min.replace(tzinfo=timezone.utc),
            )

            # 8. Get endpoint, secret, adapter.
            from stitch_backend.domains.ai_gateway.service import ProviderEndpointService
            ep_svc = ProviderEndpointService(session)
            endpoint = await ep_svc.get_by_pk(upstream.provider_endpoint_id)
            if endpoint is None:
                continue

            secret = await cred_svc.get_secret_for_invocation(cred.id)
            if not secret:
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

            results.append(RoutingResult(
                endpoint=endpoint,
                credential=cred,
                upstream_model=upstream,
                adapter=adapter,
                secret=secret,
                default_headers=endpoint.default_headers or {},
            ))

        if not results:
            raise RoutingError(f"No eligible credentials found for {request.model!r}")

        return results

    async def record_result(
        self,
        session: AsyncSession,
        credential_id: str,
        endpoint_id: str,
        error: ClassifiedError | None,
        http_status: int | None,
    ) -> None:
        """Record the outcome of a routed request — updates credential state and circuit breaker."""
        await credential_state.transition_credential(
            session, credential_id, error, http_status,
        )
        await circuit_breaker.record_endpoint_result(
            session, endpoint_id, success=(error is None),
        )

    async def get_available_public_models(
        self,
        session: AsyncSession,
    ) -> list[PublicModel]:
        """Return all enabled public models (for /v1/models endpoint)."""
        pub_svc = PublicModelService(session)
        all_models = await pub_svc.list_public_models()
        return [m for m in all_models if m.enabled]
