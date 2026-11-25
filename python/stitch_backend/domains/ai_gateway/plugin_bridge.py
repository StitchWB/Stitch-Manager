"""Generic plugin-bridge gateway worker.

Any service plugin can back an inference provider by declaring a bridge in
its manifest::

    "contributions": {
      "gateway": {"bridge": {"vendor": "ramp", "name": "Ramp", "protocols": ["chat"]}}
    }

The plugin runs a loopback OpenAI-compatible endpoint and answers the
``get_gateway_provider`` RPC with a bundle::

    {"running": true,
     "provider": {"<vendor>-<protocol>": {"options": {"baseURL": "http://127.0.0.1:P/<protocol>/v1",
                                                     "apiKey": "..."},
                                          "models": {"<model_id>": <card>}}},
     "runtime": [{"id": "...", "retryAt": 0, "status": "ok"}]}

The worker polls every bridge-declaring plugin and syncs the bundle into
ProviderEndpoint/Credential/UpstreamModel/PublicModel/RouteTarget rows —
the generic form of what ``velly_bridge.py`` hardcodes for stitch-velly.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.adapters.plugin_bridge import ensure_bridge_adapter
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    UpstreamModelService,
)

logger = logging.getLogger(__name__)

PROTOCOLS = ("messages", "responses", "chat")


@dataclass(frozen=True)
class PluginBridgeSpec:
    plugin_id: str
    vendor: str
    name: str
    protocols: tuple[str, ...] = ("chat",)


def bridge_specs() -> list[PluginBridgeSpec]:
    """Bridge specs from every registered plugin manifest."""
    from stitch_backend.domains.plugin_runtime import all_manifests

    specs: list[PluginBridgeSpec] = []
    for manifest in all_manifests():
        gateway = manifest.contributions.get("gateway")
        bridge = gateway.get("bridge") if isinstance(gateway, dict) else None
        if not isinstance(bridge, dict):
            continue
        vendor = str(bridge.get("vendor") or manifest.id.removeprefix("stitch-"))
        protocols = tuple(p for p in bridge.get("protocols", ("chat",)) if p in PROTOCOLS)
        if not protocols:
            continue
        specs.append(
            PluginBridgeSpec(
                plugin_id=manifest.id,
                vendor=vendor,
                name=str(bridge.get("name") or vendor.title()),
                protocols=protocols,
            )
        )
    return specs


def endpoint_id(spec: PluginBridgeSpec, protocol: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"stitch-plugin:{spec.plugin_id}:{protocol}"))


def validate_bundle(bundle: dict, spec: PluginBridgeSpec) -> dict:
    if not isinstance(bundle, dict) or not isinstance(bundle.get("provider"), dict):
        raise ValueError(f"Invalid {spec.name} bridge bundle")
    result = {}
    for key, provider in bundle["provider"].items():
        protocol = key.removeprefix(f"{spec.vendor}-")
        if (
            protocol not in spec.protocols
            or key != f"{spec.vendor}-{protocol}"
            or not isinstance(provider, dict)
        ):
            raise ValueError(f"Invalid {spec.name} protocol")
        options = provider.get("options", {})
        url = urlsplit(options.get("baseURL", ""))
        if (
            url.scheme != "http"
            or url.hostname != "127.0.0.1"
            or not url.port
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path != f"/{protocol}/v1"
        ):
            raise ValueError(f"{spec.name} bridge must use an authenticated loopback endpoint")
        secret = options.get("apiKey")
        if (
            not isinstance(secret, str)
            or not secret
            or not isinstance(provider.get("models"), dict)
        ):
            raise ValueError(f"Missing local {spec.name} credential or model cards")
        for model, card in provider["models"].items():
            if not isinstance(model, str) or not model or not isinstance(card, dict):
                raise ValueError(f"Invalid {spec.name} model card")
            limits = card.get("limit", {})
            if any(type(limits.get(k)) is not int or limits[k] <= 0 for k in ("context", "output")):
                raise ValueError(f"{spec.name} context and output limits are required")
        result[protocol] = provider
    return result


async def sync_bundle(session, bundle: dict, spec: PluginBridgeSpec) -> int:
    providers = validate_bundle(bundle, spec)
    online = bundle.get("running") is True
    states = {
        row["id"]: row
        for row in bundle.get("runtime", [])
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    now = _utcnow()
    count = 0
    stopped_reason = f"{spec.name} bridge is stopped"
    for protocol in spec.protocols:
        provider = providers.get(protocol)
        endpoint = await session.get(ProviderEndpoint, endpoint_id(spec, protocol))
        if provider is None or not online:
            if endpoint is not None:
                credentials = (
                    (
                        await session.execute(
                            select(Credential).where(Credential.provider_endpoint_id == endpoint.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                for credential in credentials:
                    if credential.runtime_status != "disabled":
                        credential.runtime_status = "cooldown"
                        credential.next_retry_at = now + timedelta(seconds=45)
                        credential.status_reason = stopped_reason
            continue
        if endpoint is None:
            endpoint = ProviderEndpoint(
                id=endpoint_id(spec, protocol),
                name=f"{spec.name} {protocol.title()}",
                adapter_type=ensure_bridge_adapter(spec.vendor, protocol),
                base_url=provider["options"]["baseURL"],
                enabled=True,
                owner_id=None,
                discovery_policy={"mode": "plugin", "plugin_id": spec.plugin_id},
            )
            session.add(endpoint)
            await session.flush()
        endpoint.base_url = provider["options"]["baseURL"]
        credentials = (
            (
                await session.execute(
                    select(Credential).where(Credential.provider_endpoint_id == endpoint.id)
                )
            )
            .scalars()
            .all()
        )
        credential = credentials[0] if credentials else None
        secrets = CredentialService(session)
        key = provider["options"]["apiKey"]
        if credential is None:
            credential = await secrets.create_credential(
                endpoint.id, f"{spec.name} Bridge", "api_key", key, owner_id=None
            )
        else:
            from stitch_backend.domains.ai_gateway.credential_service import compute_fingerprint

            if credential.fingerprint != compute_fingerprint(endpoint.id, key):
                await secrets.rotate_secret(credential.id, key)
        credential.legacy_metadata = {"source": spec.plugin_id, "accountType": "local_bridge"}
        if credential.status_reason == stopped_reason:
            credential.runtime_status = "unknown"
            credential.next_retry_at = None
            credential.status_reason = None
        models = UpstreamModelService(session)
        access = CredentialModelAccessService(session)
        present = set()
        for model_id, card in provider["models"].items():
            capabilities = {
                "supports_tools": card.get("tool_call"),
                "supports_function_calling": card.get("tool_call"),
                "supports_vision": card.get("attachment"),
                "supports_reasoning": card.get("reasoning"),
                "supports_streaming": True,
                "max_input_tokens": card["limit"]["context"],
                "max_output_tokens": card["limit"]["output"],
                "source": "provider_metadata",
                "extra": {
                    "plugin_id": spec.plugin_id,
                    "protocol": protocol,
                    "cost": card.get("cost"),
                    "output_limit_source": "client",
                },
            }
            upstream = await models.upsert_model(
                endpoint.id,
                model_id,
                display_name=card.get("name", model_id),
                discovery_source=spec.plugin_id,
                capabilities=capabilities,
            )
            present.add(upstream.id)
            state = states.get(model_id, {})
            status = "available"
            if state.get("retryAt", 0) > time.time() * 1000:
                status = "temporarily_unavailable"
            if state.get("status") == "auth_failed":
                status = "temporarily_unavailable"
            await access.upsert_access(credential.id, upstream.id, status=status)
            alias = f"{spec.vendor}/{model_id}"
            public = await session.get(PublicModel, alias)
            if public is None:
                public = PublicModel(
                    id=alias,
                    display_name=f"{spec.name} · {card.get('name', model_id)}",
                    enabled=True,
                    owner_id=None,
                )
                session.add(public)
                await session.flush()
            old_contract = public.contract or {}
            if old_contract.get("auto_disabled"):
                public.enabled = True
            public.contract = {
                "managed_by": spec.plugin_id,
                "protocol": protocol,
                "minContextTokens": card["limit"]["context"],
                "maxOutputTokens": card["limit"]["output"],
                "inputModalities": card.get("modalities", {}).get("input", ["text"]),
                "tools": card.get("tool_call"),
            }
            target = (
                await session.execute(
                    select(RouteTarget).where(
                        RouteTarget.public_model_id == alias,
                        RouteTarget.upstream_model_id == upstream.id,
                    )
                )
            ).scalar_one_or_none()
            if target is None:
                session.add(
                    RouteTarget(
                        public_model_id=alias,
                        upstream_model_id=upstream.id,
                        priority=10,
                        enabled=True,
                    )
                )
            count += 1
        retired = (
            (
                await session.execute(
                    select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id)
                )
            )
            .scalars()
            .all()
        )
        for upstream in retired:
            if upstream.id in present:
                continue
            await access.upsert_access(credential.id, upstream.id, status="denied")
            public = await session.get(PublicModel, f"{spec.vendor}/{upstream.upstream_model_id}")
            if public is not None and public.enabled:
                public.enabled = False
                public.contract = {**(public.contract or {}), "auto_disabled": True}
    await session.flush()
    return count


async def list_bridge_models(session, spec: PluginBridgeSpec) -> list[dict]:
    rows = (
        (
            await session.execute(
                select(PublicModel).where(
                    PublicModel.id.startswith(f"{spec.vendor}/"), PublicModel.enabled.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": row.id,
            "provider": spec.vendor,
            "ownedBy": spec.vendor,
            "name": row.display_name or row.id,
            "source": "aiProxy",
            "protocol": (row.contract or {}).get("protocol", "chat"),
        }
        for row in rows
        if (row.contract or {}).get("managed_by") == spec.plugin_id
    ]


async def list_all_bridge_models(session) -> list[dict]:
    out: list[dict] = []
    for spec in bridge_specs():
        out.extend(await list_bridge_models(session, spec))
    return out


class PluginBridgeWorker:
    _task: asyncio.Task | None = None

    @classmethod
    async def start(cls) -> None:
        from stitch_backend.config import get_settings

        if get_settings().desktop_mode and cls._task is None:
            cls._task = asyncio.create_task(cls._run(), name="plugin-gateway-sync")

    @classmethod
    async def stop(cls) -> None:
        if cls._task:
            cls._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await cls._task
            cls._task = None

    @staticmethod
    async def _run() -> None:
        from stitch_backend.database import run_in_session
        from stitch_backend.domains.plugin_runtime import get_host

        previous: dict[str, bytes] = {}
        synced_at: dict[str, float] = {}
        while True:
            for spec in bridge_specs():
                try:
                    host = get_host(spec.plugin_id)
                    bundle = (
                        await host.call("get_gateway_provider", {})
                        if host and host.rpc.is_alive
                        else {"running": False, "provider": {}}
                    )
                    stamp = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).digest()
                    if (
                        stamp != previous.get(spec.plugin_id)
                        or time.monotonic() - synced_at.get(spec.plugin_id, 0.0) >= 30
                    ):

                        async def _sync(session, snapshot=bundle, s=spec):
                            return await sync_bundle(session, snapshot, s)

                        await run_in_session(_sync)
                        previous[spec.plugin_id] = stamp
                        synced_at[spec.plugin_id] = time.monotonic()
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "%s gateway sync failed (%s)", spec.plugin_id, type(exc).__name__
                    )
            await asyncio.sleep(10)
