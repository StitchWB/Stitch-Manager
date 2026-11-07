"""Read-only query over the persisted model-health registry."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.schemas.model_health import (
    ListModelHealthRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# reason = ClassifiedError.category -> stable group for humans/agents
REASON_GROUPS = {
    "quota_exhausted": "balance",
    "server_error": "channel",
    "auth_failed": "auth",
    "rate_limited": "rate",
    "model_access_denied": "access",
    "client_error": "access",
    "model_not_found": "missing",
    "transport_error": "transport",
}

_STATUS_RANK = {"available": 0, "temporarily_unavailable": 1, "denied": 2, "unknown": 3}

ACTIVE_CREDENTIAL_STATES = frozenset({"active", "unknown"})

DEFAULT_FIELDS = (
    "endpointId",
    "model",
    "canonical",
    "status",
    "alive",
    "usable",
    "reason",
    "vision",
    "tools",
    "latencyMs",
    "lastVerifiedAt",
)


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _canonical(model: str) -> str:
    """Grouping key only: last path segment, no ``:tag``, lowercased."""
    return model.rsplit("/", 1)[-1].split(":", 1)[0].lower()


def _reason_group(error: str | None) -> str:
    return REASON_GROUPS.get(error or "", "unknown")


def _witness(entries: list[dict[str, Any]], cred_status: dict[str, str]) -> dict[str, Any] | None:
    if not entries:
        return None

    def rank(entry: dict[str, Any]) -> tuple[int, int]:
        active = cred_status.get(entry["credentialId"], "unknown") in ACTIVE_CREDENTIAL_STATES
        return (_STATUS_RANK.get(entry["status"], 3), 0 if active else 1)

    return min(entries, key=rank)


def _aggregate(
    models: list[dict[str, Any]],
    access: list[dict[str, Any]],
    cred_status: dict[str, str],
) -> list[dict[str, Any]]:
    by_model: dict[str, list[dict[str, Any]]] = {}
    for entry in access:
        by_model.setdefault(entry["upstreamId"], []).append(entry)

    rows: list[dict[str, Any]] = []
    for model in models:
        entries = by_model.get(model["id"], [])
        witness = _witness(entries, cred_status)
        status = witness["status"] if witness else "unknown"
        capabilities = model.get("capabilities") or {}
        verified = [e["lastVerifiedAt"] for e in entries if e["lastVerifiedAt"]]
        rows.append({
            "endpointId": model["endpointId"],
            "model": model["model"],
            "canonical": _canonical(model["model"]),
            "status": status,
            "alive": any(e["status"] == "available" for e in entries),
            "usable": any(
                e["status"] == "available"
                and cred_status.get(e["credentialId"], "unknown") in ACTIVE_CREDENTIAL_STATES
                for e in entries
            ),
            "reason": "ok" if status == "available" else _reason_group(witness["lastError"] if witness else None),
            "vision": capabilities.get("supports_vision"),
            "tools": capabilities.get("supports_tool_calling"),
            "latencyMs": capabilities.get("probe_latency_ms"),
            "lastVerifiedAt": max(verified) if verified else None,
            "discoveredAt": model.get("discoveredAt"),
        })
    return rows


def _matches(row: dict[str, Any], req: ListModelHealthRequest, since: datetime | None) -> bool:
    if req.prefix and not row["model"].startswith(req.prefix):
        return False
    for field in ("alive", "usable", "vision", "tools"):
        wanted = getattr(req, field)
        if wanted is not None and row.get(field) != wanted:
            return False
    if since is not None:
        stamps = [row.get("lastVerifiedAt"), row.get("discoveredAt")]
        parsed = [ts for ts in (_parse_ts(s) for s in stamps if s) if ts is not None]
        if not parsed or max(parsed) < since:
            return False
    return True


def _sort_key(req: ListModelHealthRequest) -> Any:
    if req.sort == "latency":
        return lambda row: (row["latencyMs"] is None, row["latencyMs"] or 0, row["canonical"])
    return lambda row: (row["canonical"], row["model"])


def _shape(rows: list[dict[str, Any]], req: ListModelHealthRequest) -> list[dict[str, Any]]:
    since = _parse_ts(req.changed_since)
    filtered = [row for row in rows if _matches(row, req, since)]
    filtered.sort(key=_sort_key(req))
    if req.top_k > 0:
        filtered = filtered[: req.top_k]
    page = filtered[req.offset : req.offset + req.limit] if req.limit > 0 else filtered[req.offset :]
    if req.fields:
        return [{key: row.get(key) for key in req.fields} for row in page]
    return [{key: row.get(key) for key in DEFAULT_FIELDS} for row in page]


async def _collect(db: AsyncSession, req: ListModelHealthRequest) -> list[dict[str, Any]]:
    stmt = select(UpstreamModel)
    if req.endpoint_id:
        stmt = stmt.where(UpstreamModel.provider_endpoint_id == req.endpoint_id)
    models = list((await db.execute(stmt)).scalars().all())
    if not models:
        return []

    model_dicts = [
        {
            "id": m.id,
            "endpointId": m.provider_endpoint_id,
            "model": m.upstream_model_id,
            "capabilities": m.capabilities or {},
            "discoveredAt": m.last_discovered_at.isoformat() if m.last_discovered_at else None,
        }
        for m in models
    ]
    ids = [m["id"] for m in model_dicts]
    access = list(
        (
            await db.execute(
                select(CredentialModelAccess).where(
                    CredentialModelAccess.upstream_model_id.in_(ids)
                )
            )
        ).scalars().all()
    )
    access_dicts = [
        {
            "upstreamId": a.upstream_model_id,
            "credentialId": a.credential_id,
            "status": a.status,
            "lastError": a.last_error,
            "lastVerifiedAt": a.last_verified_at.isoformat() if a.last_verified_at else None,
        }
        for a in access
    ]
    cred_ids = {a["credentialId"] for a in access_dicts}
    cred_status: dict[str, str] = {}
    if cred_ids:
        creds = list(
            (
                await db.execute(select(Credential).where(Credential.id.in_(cred_ids)))
            ).scalars().all()
        )
        cred_status = {c.id: c.runtime_status for c in creds}
    return _aggregate(model_dicts, access_dicts, cred_status)


@command(
    "list_model_health",
    readonly=True,
    request=ListModelHealthRequest,
    timeout=-1,
)
async def cmd_list_model_health(db: AsyncSession, req: ListModelHealthRequest) -> dict:
    """Query the model-health registry: alive/usable, vision/tools, latency.

    Reads what ``refresh_endpoint_models`` persisted — one call replaces
    re-probing. Filters: endpointId, prefix, alive, usable, vision, tools,
    changedSince; rank with sort=latency + topK. ``usable`` is stricter than
    ``alive``: the model answers AND its credential is not disabled/exhausted.
    """
    rows = await _collect(db, req)
    shaped = _shape(rows, req)
    return {"total": len(rows), "count": len(shaped), "models": shaped}
