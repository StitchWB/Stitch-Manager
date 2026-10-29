"""Semantic key-health probe — one max_tokens=1 chat completion per key.

``DiscoveryWorker``'s GET /v1/models is a shallow liveness check that passes
even when inference is dead (different rate limits, different code path —
see the note in ``discovery_worker.py``).  This probe is the semantic
replacement: it sends ONE minimal chat-completions request through the
endpoint's registered adapter and records the outcome in the ``key_health``
table, whose first production writer it is.

Everything is gated by the ``keyHealthProbeEnabled`` setting (default off,
opt-in).  The flag is read from the ``settings`` table at execution time —
never cached at import time — so toggling works without a restart.  When
the flag is off, no probe trigger issues any network call.

Session discipline follows the gateway workers: the DB session is held only
for short load/persist phases; the HTTP call runs outside any session.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

import httpx
from sqlalchemy import select

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ProbeResult, get_adapter
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.models import UpstreamModel
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)
from stitch_backend.domains.key_health.service import KeyHealthService, hash_key
from stitch_backend.domains.settings.models import Setting

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

PROBE_ENABLED_KEY = "keyHealthProbeEnabled"
PROBE_MESSAGE = "ping"

# scheduled while the creating transaction is still open — retry until commit makes the credential visible
_LOAD_ATTEMPTS = 3
_LOAD_RETRY_DELAY_SECONDS = 0.5

_pending_tasks: set[asyncio.Task[None]] = set()


async def is_probe_enabled(db: AsyncSession) -> bool:
    """Return the persisted probe flag.  Absent row or unreadable table → off."""
    try:
        result = await db.execute(
            select(Setting).where(Setting.key == PROBE_ENABLED_KEY),
        )
        row = result.scalar_one_or_none()
    except Exception:
        return False
    if row is None or row.value is None:
        return False
    return row.value.lower() in ("true", "1", "yes")


async def maybe_schedule_probe(db: AsyncSession, credential_id: str) -> None:
    """Schedule a background probe for a freshly created credential.

    No-op (no task, no network) unless the flag is on; never raises, so it
    is safe to call from inside credential-creation transactions.
    """
    if not await is_probe_enabled(db):
        return
    schedule_probe(credential_id)


def schedule_probe(credential_id: str) -> asyncio.Task[None]:
    """Fire-and-forget probe for one credential.  Returns the task."""
    task = asyncio.create_task(_safe_probe(credential_id))
    _pending_tasks.add(task)
    task.add_done_callback(_pending_tasks.discard)
    return task


async def _safe_probe(credential_id: str) -> None:
    try:
        await probe_credential(credential_id)
    except Exception:
        logger.exception(
            "KeyHealthProbe: background probe failed for credential %s",
            credential_id,
        )


async def probe_credential(credential_id: str) -> None:
    """Probe one credential and record the result in ``key_health``.

    Short-circuits with zero network calls when the flag is off.
    """
    if not await run_in_read_session(is_probe_enabled):
        return

    target = await _load_target_with_retry(credential_id)
    if target is None:
        return

    result = await _run_chat_probe(target)
    await _persist_result(target, result)

    if result.success:
        logger.info(
            "KeyHealthProbe: credential %s (%s) healthy — %.0fms",
            credential_id, target["provider_id"], result.latency_ms,
        )
    else:
        logger.warning(
            "KeyHealthProbe: credential %s (%s) failed — %s",
            credential_id, target["provider_id"], result.error,
        )


async def _load_target_with_retry(credential_id: str) -> dict[str, Any] | None:
    for _ in range(_LOAD_ATTEMPTS):
        target = await run_in_read_session(
            lambda session: _load_probe_target(session, credential_id),
        )
        if target is not None:
            return target
        await asyncio.sleep(_LOAD_RETRY_DELAY_SECONDS)
    return None


async def _load_probe_target(
    db: AsyncSession, credential_id: str,
) -> dict[str, Any] | None:
    """Load everything the probe needs as plain data (read-only session)."""
    cred_svc = CredentialService(db)
    credential = await cred_svc.get_by_pk(credential_id)
    if credential is None or not credential.enabled:
        return None

    endpoint = await ProviderEndpointService(db).get_by_pk(
        credential.provider_endpoint_id,
    )
    if endpoint is None or not endpoint.enabled:
        return None

    secret = await cred_svc.get_secret_for_invocation(credential_id)
    if not secret:
        return None

    model_id = await _resolve_probe_model(db, endpoint.id)
    if model_id is None:
        logger.debug(
            "KeyHealthProbe: no probe model for endpoint %s — skipping credential %s",
            endpoint.id, credential_id,
        )
        return None

    return {
        "credential_id": credential_id,
        "provider_id": endpoint.name.lower().replace(" ", "_"),
        "adapter_type": endpoint.adapter_type,
        "base_url": endpoint.base_url,
        "default_headers": endpoint.default_headers,
        "secret": secret,
        "model": model_id,
    }


async def _resolve_probe_model(db: AsyncSession, endpoint_id: str) -> str | None:
    """First enabled upstream model discovered for the endpoint.

    Only live discovery data is used — a hardcoded per-provider model id
    would rot into false "broken" verdicts once the provider retires it.
    """
    result = await db.execute(
        select(UpstreamModel.upstream_model_id)
        .where(
            UpstreamModel.provider_endpoint_id == endpoint_id,
            UpstreamModel.enabled.is_(True),
        )
        .order_by(UpstreamModel.created_at)
        .limit(1),
    )
    return result.scalars().first()


async def _run_chat_probe(target: dict[str, Any]) -> ProbeResult:
    """One chat completion with max_tokens=1, OUTSIDE any DB session."""
    adapter = get_adapter(target["adapter_type"])
    start = time.monotonic()
    try:
        await adapter.invoke(
            base_url=target["base_url"],
            secret=target["secret"],
            model=target["model"],
            messages=[{"role": "user", "content": PROBE_MESSAGE}],
            max_tokens=1,
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        return ProbeResult(
            success=False,
            latency_ms=(time.monotonic() - start) * 1000,
            http_status=status,
            error=f"HTTP {status}",
        )
    except Exception as exc:
        return ProbeResult(
            success=False,
            latency_ms=(time.monotonic() - start) * 1000,
            error=_sanitize_error(exc, target["secret"]),
        )
    return ProbeResult(
        success=True,
        latency_ms=(time.monotonic() - start) * 1000,
    )


async def _persist_result(target: dict[str, Any], result: ProbeResult) -> None:
    key_hash = hash_key(target["provider_id"], target["secret"])

    async def _op(db: AsyncSession) -> None:
        svc = KeyHealthService(db)
        await svc.upsert_health(target["provider_id"], key_hash)
        await svc.record_test_result(
            key_hash,
            success=result.success,
            latency_ms=result.latency_ms,
            error=result.error,
            http_status=result.http_status,
        )

    await run_in_session(_op)
