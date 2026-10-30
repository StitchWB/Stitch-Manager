from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

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


def endpoint_id(protocol: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"stitch-plugin:velly:{protocol}"))


def validate_bundle(bundle: dict) -> dict:
    if not isinstance(bundle, dict) or not isinstance(bundle.get("provider"), dict):
        raise ValueError("Invalid Velly bridge bundle")
    result = {}
    for key, provider in bundle["provider"].items():
        protocol = key.removeprefix("velly-")
        if protocol not in PROTOCOLS or key != f"velly-{protocol}" or not isinstance(provider, dict):
            raise ValueError("Invalid Velly protocol")
        options = provider.get("options", {})
        url = urlsplit(options.get("baseURL", ""))
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
                or url.username or url.password or url.query or url.fragment or url.path != f"/{protocol}/v1"):
            raise ValueError("Velly bridge must use an authenticated loopback endpoint")
        secret = options.get("apiKey")
        if not isinstance(secret, str) or not secret or not isinstance(provider.get("models"), dict):
            raise ValueError("Missing local Velly credential or model cards")
        for model, card in provider["models"].items():
            if not isinstance(model, str) or not model or not isinstance(card, dict):
                raise ValueError("Invalid Velly model card")
            limits = card.get("limit", {})
            if any(type(limits.get(k)) is not int or limits[k] <= 0 for k in ("context", "output")):
                raise ValueError("Velly context and output limits are required")
        result[protocol] = provider
    return result


async def sync_bundle(session, bundle: dict) -> int:
    providers = validate_bundle(bundle)
    online = bundle.get("running") is True
    states = {row["id"]: row for row in bundle.get("runtime", []) if isinstance(row, dict) and isinstance(row.get("id"), str)}
    now = _utcnow()
    count = 0
    for protocol in PROTOCOLS:
        provider = providers.get(protocol)
        endpoint = await session.get(ProviderEndpoint, endpoint_id(protocol))
        if provider is None or not online:
            if endpoint is not None:
                credentials = (await session.execute(select(Credential).where(Credential.provider_endpoint_id == endpoint.id))).scalars().all()
                for credential in credentials:
                    if credential.runtime_status != "disabled":
                        credential.runtime_status = "cooldown"
                        credential.next_retry_at = now + timedelta(seconds=45)
                        credential.status_reason = "Velly bridge is stopped"
            continue
        if endpoint is None:
            endpoint = ProviderEndpoint(id=endpoint_id(protocol), name=f"Velly {protocol.title()}",
                                        adapter_type=f"velly_{protocol}", base_url=provider["options"]["baseURL"],
                                        enabled=True, owner_id=None, discovery_policy={"mode": "plugin", "plugin_id": "stitch-velly"})
            session.add(endpoint)
            await session.flush()
        endpoint.base_url = provider["options"]["baseURL"]
        credentials = (await session.execute(select(Credential).where(Credential.provider_endpoint_id == endpoint.id))).scalars().all()
        credential = credentials[0] if credentials else None
        secrets = CredentialService(session)
        key = provider["options"]["apiKey"]
        if credential is None:
            credential = await secrets.create_credential(endpoint.id, "Velly Bridge", "api_key", key, owner_id=None)
        else:
            from stitch_backend.domains.ai_gateway.credential_service import compute_fingerprint

            if credential.fingerprint != compute_fingerprint(endpoint.id, key):
                await secrets.rotate_secret(credential.id, key)
        credential.legacy_metadata = {"source": "stitch-velly", "accountType": "local_bridge"}
        if credential.status_reason == "Velly bridge is stopped":
            credential.runtime_status = "unknown"
            credential.next_retry_at = None
            credential.status_reason = None
        models = UpstreamModelService(session)
        access = CredentialModelAccessService(session)
        present = set()
        for model_id, card in provider["models"].items():
            capabilities = {"supports_tools": card.get("tool_call"), "supports_function_calling": card.get("tool_call"),
                            "supports_vision": card.get("attachment"), "supports_reasoning": card.get("reasoning"),
                            "supports_streaming": True, "max_input_tokens": card["limit"]["context"],
                            "max_output_tokens": card["limit"]["output"], "source": "provider_metadata",
                            "extra": {"plugin_id": "stitch-velly", "protocol": protocol, "cost": card.get("cost"), "output_limit_source": "client"}}
            upstream = await models.upsert_model(endpoint.id, model_id, display_name=card.get("name", model_id),
                                                 discovery_source="stitch-velly", capabilities=capabilities)
            present.add(upstream.id)
            state = states.get(model_id, {})
            status = "available"
            if state.get("retryAt", 0) > time.time() * 1000:
                status = "temporarily_unavailable"
            if state.get("status") == "auth_failed":
                status = "temporarily_unavailable"
            await access.upsert_access(credential.id, upstream.id, status=status)
            alias = f"velly/{model_id}"
            public = await session.get(PublicModel, alias)
            if public is None:
                public = PublicModel(id=alias, display_name=f"Velly · {card.get('name', model_id)}", enabled=True, owner_id=None)
                session.add(public)
                await session.flush()
            old_contract = public.contract or {}
            if old_contract.get("auto_disabled"):
                public.enabled = True
            public.contract = {"managed_by": "stitch-velly", "protocol": protocol,
                               "minContextTokens": card["limit"]["context"], "maxOutputTokens": card["limit"]["output"],
                               "inputModalities": card.get("modalities", {}).get("input", ["text"]), "tools": card.get("tool_call")}
            target = (await session.execute(select(RouteTarget).where(RouteTarget.public_model_id == alias,
                                                                       RouteTarget.upstream_model_id == upstream.id))).scalar_one_or_none()
            if target is None:
                session.add(RouteTarget(public_model_id=alias, upstream_model_id=upstream.id, priority=10, enabled=True))
            count += 1
        retired = (await session.execute(select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id))).scalars().all()
        for upstream in retired:
            if upstream.id in present:
                continue
            await access.upsert_access(credential.id, upstream.id, status="denied")
            public = await session.get(PublicModel, f"velly/{upstream.upstream_model_id}")
            if public is not None and public.enabled:
                public.enabled = False
                public.contract = {**(public.contract or {}), "auto_disabled": True}
    await session.flush()
    return count


async def list_velly_models(session) -> list[dict]:
    rows = (await session.execute(select(PublicModel).where(PublicModel.id.startswith("velly/"), PublicModel.enabled.is_(True)))).scalars().all()
    return [{"id": row.id, "provider": "velly", "ownedBy": "velly", "name": row.display_name or row.id,
             "source": "aiProxy", "protocol": (row.contract or {}).get("protocol", "chat")} for row in rows
            if (row.contract or {}).get("managed_by") == "stitch-velly"]


class VellyBridgeWorker:
    _task: asyncio.Task | None = None

    @classmethod
    async def start(cls) -> None:
        from stitch_backend.config import get_settings

        if get_settings().desktop_mode and cls._task is None:
            cls._task = asyncio.create_task(cls._run(), name="velly-gateway-sync")

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

        previous = None
        synced_at = 0.0
        while True:
            try:
                host = get_host("stitch-velly")
                bundle = await host.call("get_gateway_provider", {}) if host and host.rpc.is_alive else {"running": False, "provider": {}}
                stamp = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).digest()
                if stamp != previous or time.monotonic() - synced_at >= 30:
                    async def _sync(session, snapshot=bundle):
                        return await sync_bundle(session, snapshot)

                    await run_in_session(_sync)
                    previous, synced_at = stamp, time.monotonic()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Velly gateway sync failed (%s)", type(exc).__name__)
            await asyncio.sleep(10)
