"""catalogVerification gating for ReformBoss-style endpoints (Phase 3A, ITEM-3).

Per spec section 6A: ``DiscoveryWorker._verify_new_models`` skips the
catalog-wide probe sweep when the endpoint's
``health_policy.probePolicy.catalogVerification`` is ``"off"`` OR the
endpoint matches the ReformBoss default matcher (normalized base URL
``https://api.reformboss.com/v1``).  Discovery listing itself continues —
only the probe sweep is gated.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata, ProbeResult
from stitch_backend.domains.ai_gateway.discovery_worker import (
    REFORMBOSS_BASE_URL,
    DiscoveryWorker,
    _catalog_verification_disabled,
    _normalize_base_url,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)
from stitch_backend.domains.auth.models import User  # noqa: F401 — for FK metadata

if TYPE_CHECKING:
    from pathlib import Path

_DOMAIN_TABLES = [
    User.__table__,
    ProviderEndpoint.__table__,
    Credential.__table__,
    CredentialSecret.__table__,
    UpstreamModel.__table__,
    CredentialModelAccess.__table__,
    PublicModel.__table__,
    RouteTarget.__table__,
]


@pytest.fixture
async def db_session(tmp_path: Path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'discovery.db'}",
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


async def _make_endpoint(session, *, base_url, health_policy=None):
    svc = ProviderEndpointService(session)
    endpoint = await svc.create_endpoint(
        name="test endpoint",
        adapter_type="openai_compatible",
        base_url=base_url,
        health_policy=health_policy,
    )
    await session.commit()
    return endpoint


async def _make_credential(session, endpoint_id):
    svc = CredentialService(session)
    cred = await svc.create_credential(
        provider_endpoint_id=endpoint_id,
        label="test key",
        auth_type="api_key",
        secret="sk-test",
    )
    cred.runtime_status = "active"
    await session.commit()
    return cred


class _MockAdapter:
    async def list_models_detailed(self, *, base_url, secret, default_headers=None):
        return [ModelMetadata(id="brand-new-model")]

    async def probe_credential(self, *, base_url, secret, default_headers=None):
        return ProbeResult(success=True, latency_ms=10.0, models=["brand-new-model"])


def _patch_worker_db(monkeypatch, session):
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


# ── Matcher unit tests ────────────────────────────────────────────────────────


def test_normalize_base_url() -> None:
    assert _normalize_base_url("https://api.reformboss.com/v1") == REFORMBOSS_BASE_URL
    assert _normalize_base_url("https://api.reformboss.com/v1/") == REFORMBOSS_BASE_URL
    assert _normalize_base_url("HTTPS://API.REFORMBOSS.COM/v1") == REFORMBOSS_BASE_URL
    assert _normalize_base_url(None) == ""
    assert _normalize_base_url("") == ""


def test_gate_matcher_unit() -> None:
    assert _catalog_verification_disabled({"base_url": "https://api.reformboss.com/v1"})
    assert _catalog_verification_disabled({"base_url": "https://api.reformboss.com/v1/"})
    assert not _catalog_verification_disabled({"base_url": "https://api.fireworks.ai/inference"})
    assert _catalog_verification_disabled({
        "base_url": "https://api.fireworks.ai/inference",
        "health_policy": {"probePolicy": {"catalogVerification": "off"}},
    })
    assert not _catalog_verification_disabled({
        "base_url": "https://api.fireworks.ai/inference",
        "health_policy": {"probePolicy": {"catalogVerification": "on"}},
    })
    # Malformed policy never disables verification.
    assert not _catalog_verification_disabled({
        "base_url": "https://api.fireworks.ai/inference",
        "health_policy": "junk",
    })
    assert not _catalog_verification_disabled({"base_url": "https://api.fireworks.ai/inference"})


# ── Worker integration ────────────────────────────────────────────────────────


async def _run_discovery(monkeypatch, db_session):
    probe_calls: list[dict] = []

    async def _fake_probe(adapter, **kwargs):
        probe_calls.append(kwargs)
        return [{
            "model": model,
            "ok": True,
            "reason": "ok",
            "latencyMs": 12,
            "multimodalOk": None,
            "text": "ok",
        } for model in kwargs["models"]]

    _patch_worker_db(monkeypatch, db_session)
    with patch(
        "stitch_backend.domains.ai_gateway.discovery_worker.get_adapter",
        return_value=_MockAdapter(),
    ), patch(
        "stitch_backend.domains.ai_gateway.commands.probe_models.probe_models",
        new=_fake_probe,
    ):
        await DiscoveryWorker._discover_all()
    return probe_calls


async def test_reformboss_endpoint_skips_verification_but_discovers(db_session, monkeypatch) -> None:
    endpoint = await _make_endpoint(db_session, base_url="https://api.reformboss.com/v1")
    await _make_credential(db_session, endpoint.id)

    probe_calls = await _run_discovery(monkeypatch, db_session)

    assert probe_calls == [], "probe sweep must not run for ReformBoss endpoints"
    # Discovery listing itself still persisted the model.
    result = await db_session.execute(select(UpstreamModel))
    models = list(result.scalars().all())
    assert [m.upstream_model_id for m in models] == ["brand-new-model"]
    # No verification stamp — the sweep was gated.
    assert "verification_status" not in (models[0].capabilities or {})


async def test_explicit_policy_off_skips_verification(db_session, monkeypatch) -> None:
    endpoint = await _make_endpoint(
        db_session,
        base_url="https://api.fireworks.ai/inference",
        health_policy={"probePolicy": {"catalogVerification": "off"}},
    )
    await _make_credential(db_session, endpoint.id)

    probe_calls = await _run_discovery(monkeypatch, db_session)

    assert probe_calls == []
    result = await db_session.execute(select(UpstreamModel))
    models = list(result.scalars().all())
    assert len(models) == 1
    assert "verification_status" not in (models[0].capabilities or {})


async def test_normal_endpoint_verification_unchanged(db_session, monkeypatch) -> None:
    endpoint = await _make_endpoint(db_session, base_url="https://api.fireworks.ai/inference")
    await _make_credential(db_session, endpoint.id)

    probe_calls = await _run_discovery(monkeypatch, db_session)

    assert probe_calls, "normal endpoints must still run the probe sweep"
    result = await db_session.execute(select(UpstreamModel))
    model = result.scalar_one()
    assert model.capabilities["verification_status"] == "working"


async def test_reformboss_trailing_slash_also_gated(db_session, monkeypatch) -> None:
    endpoint = await _make_endpoint(db_session, base_url="https://api.reformboss.com/v1/")
    await _make_credential(db_session, endpoint.id)

    probe_calls = await _run_discovery(monkeypatch, db_session)
    assert probe_calls == []
