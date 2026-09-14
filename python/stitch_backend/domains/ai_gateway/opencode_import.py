"""Import providers from the OpenCode config into the AI Gateway.

Reads ``~/.config/opencode/opencode.json`` (provider definitions:
``npm``, ``options.baseURL``, ``options.apiKey``, ``models``) and
``~/.local/share/opencode/auth.json`` (api-key entries), then creates the
full gateway chain per provider:

    ProviderEndpoint → Credential → UpstreamModel(s) → CredentialModelAccess
    → PublicModel (one per DISTINCT model id) → RouteTarget

Auto-wiring is the point: N accounts all declaring ``glm-5.2`` produce ONE
public model ``glm-5.2`` whose route targets span every imported instance,
so the routing engine rotates/fails over between the pooled keys.

Idempotent: endpoints are matched by ``(name, base_url)``, credentials
dedupe by fingerprint (see ``CredentialService.create_credential``),
upstream models upsert, public models / route targets are
check-before-create.  Re-running only fills gaps.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import aiofiles
from sqlalchemy import select

from stitch_backend.domains.ai_gateway.models import (
    ProviderEndpoint,
    RouteTarget,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_AUTH_JSON_PATH = Path.home() / ".local" / "share" / "opencode" / "auth.json"

_ENV_REF_RE = re.compile(r"^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$")

_NPM_TO_ADAPTER = {
    "@ai-sdk/openai-compatible": "openai_compatible",
    "@ai-sdk/openai": "openai_compatible",
    "@ai-sdk/anthropic": "anthropic",
    "@ai-sdk/google": "gemini",
    "@ai-sdk/google-generative-ai": "gemini",
}


@dataclass(frozen=True)
class OpencodeProvider:
    """One parsed provider entry ready for import."""

    name: str
    base_url: str
    api_key: str
    adapter_type: str
    models: list[str] = field(default_factory=list)


def _adapter_for(npm: object) -> str:
    return _NPM_TO_ADAPTER.get(str(npm or ""), "openai_compatible")


def _resolve_api_key(
    name: str,
    options: dict,
    auth: dict,
    environ: dict[str, str],
) -> str | None:
    """apiKey from options (literal or ``{env:VAR}``) or auth.json entry."""
    raw = options.get("apiKey")
    if isinstance(raw, str) and raw.strip():
        match = _ENV_REF_RE.match(raw.strip())
        if match:
            value = environ.get(match.group(1))
            if value:
                return value.strip()
        else:
            return raw.strip()
    entry = auth.get(name)
    if isinstance(entry, dict) and entry.get("type") == "api":
        key = entry.get("key")
        if isinstance(key, str) and key.strip():
            return key.strip()
    return None


def parse_opencode_providers(
    config: dict,
    auth: dict | None = None,
    environ: dict[str, str] | None = None,
) -> tuple[list[OpencodeProvider], list[dict[str, str]]]:
    """Split ``config.provider`` entries into importable providers + skips.

    Pure parsing — no I/O.  ``auth`` maps provider name →
    ``{"type": "api", "key": ...}`` (auth.json content); ``environ``
    resolves ``{env:VAR}`` apiKey references.
    """
    auth = auth or {}
    environ = environ if environ is not None else dict(os.environ)
    providers: list[OpencodeProvider] = []
    skipped: list[dict[str, str]] = []

    raw_providers = config.get("provider")
    if not isinstance(raw_providers, dict):
        return providers, skipped

    for name, prov in raw_providers.items():
        if not isinstance(prov, dict):
            skipped.append({"name": str(name), "reason": "malformed entry"})
            continue
        options = prov.get("options")
        if not isinstance(options, dict):
            options = {}
        base_url = options.get("baseURL")
        if not isinstance(base_url, str) or not base_url.strip():
            skipped.append({"name": name, "reason": "no baseURL"})
            continue
        api_key = _resolve_api_key(name, options, auth, environ)
        if not api_key:
            skipped.append({"name": name, "reason": "no apiKey (options/env/auth.json)"})
            continue
        raw_models = prov.get("models")
        models = (
            [m for m in raw_models if isinstance(m, str)]
            if isinstance(raw_models, dict)
            else []
        )
        providers.append(
            OpencodeProvider(
                name=name,
                base_url=base_url.strip().rstrip("/"),
                api_key=api_key,
                adapter_type=_adapter_for(prov.get("npm")),
                models=models,
            )
        )
    return providers, skipped


async def read_opencode_auth(path: Path | None = None) -> dict:
    """Read OpenCode's ``auth.json`` (provider name → {type, key})."""
    p = path or _AUTH_JSON_PATH
    try:
        async with aiofiles.open(p, encoding="utf-8") as f:
            raw = await f.read()
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


async def import_opencode_providers(
    db: AsyncSession,
    providers: list[OpencodeProvider],
    *,
    owner_id: int | None,
    share_group_id: str | None = None,
) -> dict:
    """Import parsed providers into the gateway catalog + wire public models.

    Returns a report dict: ``imported`` (per-provider detail), ``models``
    (distinct upstream model ids seen), ``public_models`` (ids created or
    reused), ``shared_to_group`` (echo of the target group, if any).
    """
    ep_svc = ProviderEndpointService(db)
    cred_svc = CredentialService(db)
    model_svc = UpstreamModelService(db)
    access_svc = CredentialModelAccessService(db)
    pub_svc = PublicModelService(db)
    target_svc = RouteTargetService(db)

    imported: list[dict] = []
    public_models: set[str] = set()
    all_models: set[str] = set()

    for prov in providers:
        # Endpoint: find-or-create by (name, base_url) — the same dedup
        # rule as the legacy migration, so re-imports and migration output
        # converge on one endpoint row per account.
        result = await db.execute(
            select(ProviderEndpoint).where(
                ProviderEndpoint.name == prov.name,
                ProviderEndpoint.base_url == prov.base_url,
            )
        )
        endpoint = result.scalar_one_or_none()
        endpoint_created = endpoint is None
        if endpoint is None:
            endpoint = await ep_svc.create_endpoint(
                name=prov.name,
                adapter_type=prov.adapter_type,
                base_url=prov.base_url,
                enabled=True,
                owner_id=owner_id,
            )

        cred = await cred_svc.create_credential(
            endpoint.id, f"opencode:{prov.name}", "api_key", prov.api_key,
            owner_id=owner_id,
        )

        if share_group_id is not None:
            # Lazy import — keeps the ai_gateway → groups module edge cut.
            from stitch_backend.domains.groups.service import share_credential

            await share_credential(db, cred.id, share_group_id, owner_id)

        models_created: list[str] = []
        for model_id in prov.models:
            upstream = await model_svc.upsert_model(
                endpoint.id, model_id,
                display_name=model_id, discovery_source="opencode_import",
            )
            await access_svc.upsert_access(
                cred.id, upstream.id, status="available",
            )
            models_created.append(model_id)
            all_models.add(model_id)

            # Auto-pool: one PublicModel per distinct model id, route
            # target per (public model, upstream instance).
            pub = await pub_svc.get_by_pk(model_id)
            if pub is None:
                pub = await pub_svc.create_public_model(
                    model_id, display_name=model_id, enabled=True, owner_id=None,
                )
            public_models.add(pub.id)

            existing_target = (
                await db.execute(
                    select(RouteTarget).where(
                        RouteTarget.public_model_id == pub.id,
                        RouteTarget.upstream_model_id == upstream.id,
                    )
                )
            ).scalar_one_or_none()
            if existing_target is None:
                await target_svc.create_target(pub.id, upstream.id, priority=10)

        imported.append({
            "name": prov.name,
            "endpoint_id": endpoint.id,
            "endpoint_created": endpoint_created,
            "credential_id": cred.id,
            "models": models_created,
        })

    await db.flush()
    return {
        "imported": imported,
        "models": sorted(all_models),
        "public_models": sorted(public_models),
        "shared_to_group": share_group_id,
    }
