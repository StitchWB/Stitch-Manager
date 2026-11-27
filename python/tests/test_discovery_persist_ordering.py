"""Regression: out-of-order discovery pass persistence must never downgrade evidence.

A manual/background discovery probe performs HTTP outside the DB.  An older
fetch can finish after a newer one; persisting it must not overwrite fresher
``last_seen_at`` evidence with the stale pass's membership stamped as current.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend.database import Base
from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata
from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
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
        f"sqlite+aiosqlite:///{tmp_path / 'persist_ordering.db'}",
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


def _result_item(endpoint, cred, model_ids, *, observed_at, verification=None):
    return {
        "probe": {
            "endpoint_id": endpoint.id,
            "endpoint_name": endpoint.name,
            "adapter_type": endpoint.adapter_type,
            "base_url": endpoint.base_url,
            "default_headers": {},
            "health_policy": endpoint.health_policy,
            "credentials": [],
            "known_model_ids": set(),
        },
        "credentials": [
            (
                {"credential_id": cred.id, "secret": "sk-test"},
                [ModelMetadata(id=mid) for mid in model_ids],
            ),
        ],
        "verification": verification or {},
        "pricing": {},
        "observed_at": observed_at,
    }


async def _endpoint_and_credential(db_session):
    svc = ProviderEndpointService(db_session)
    endpoint = await svc.create_endpoint(
        name="plain endpoint",
        adapter_type="openai_compatible",
        base_url="https://example.com/v1",
    )
    cred_svc = CredentialService(db_session)
    cred = await cred_svc.create_credential(endpoint.id, "key-1", "api_key", "sk-test")
    await db_session.commit()
    return endpoint, cred


async def test_out_of_order_pass_never_downgrades_last_seen(db_session) -> None:
    svc = ProviderEndpointService(db_session)
    endpoint = await svc.create_endpoint(
        name="plain endpoint",
        adapter_type="openai_compatible",
        base_url="https://example.com/v1",
    )
    cred_svc = CredentialService(db_session)
    cred = await cred_svc.create_credential(endpoint.id, "key-1", "api_key", "sk-test")
    await db_session.commit()

    now = _utcnow()
    t_old = now - timedelta(minutes=10)  # older pass observed the lineup earlier
    t_new = now - timedelta(minutes=5)

    # Newer pass persists FIRST (its HTTP finished first): lineup {b, c}.
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(endpoint, cred, ["b", "c"], observed_at=t_new)],
    )
    # Older pass persists SECOND (slow HTTP): lineup {a, b}.  It must not
    # overwrite the fresher evidence for ``b`` with a later wall-clock stamp,
    # and its own rows must carry the OLDER observation time.
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(endpoint, cred, ["a", "b"], observed_at=t_old)],
    )

    rows = {
        row.upstream_model_id: row
        for row in (
            await db_session.execute(
                select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id),
            )
        ).scalars().all()
    }
    assert set(rows) == {"a", "b", "c"}

    def seen(row):
        value = row.last_seen_at
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=t_new.tzinfo)
        return value

    assert seen(rows["a"]) == t_old
    assert seen(rows["c"]) == t_new
    # ``b`` was observed by both passes; the newer observation must win even
    # though the older pass persisted later.
    assert seen(rows["b"]) == t_new


async def test_out_of_order_pass_never_negates_newer_positive_access(db_session) -> None:
    """Stale absence evidence must not overwrite a newer pass's positive row.

    Realistic ordering: the newer catalog fetch observes ``c`` and persists
    first; the older fetch (which did not contain ``c``) finishes later.  Its
    absence reconciliation must be dropped because the access row already
    carries newer-observed positive evidence.
    """
    endpoint, cred = await _endpoint_and_credential(db_session)
    now = _utcnow()
    t_base = now - timedelta(minutes=15)
    t_old = now - timedelta(minutes=10)
    t_new = now - timedelta(minutes=5)

    # Establish the positive row in an earlier pass first, so the newer pass
    # below is a no-op status-wise.  Its presence evidence must still advance
    # the row watermark; otherwise the stale absence pass can slip underneath.
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(endpoint, cred, ["c"], observed_at=t_base)],
    )
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(endpoint, cred, ["b", "c"], observed_at=t_new)],
    )
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(endpoint, cred, ["a", "b"], observed_at=t_old)],
    )

    upstream_c = (
        await db_session.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint.id,
                UpstreamModel.upstream_model_id == "c",
            ),
        )
    ).scalar_one()
    access_c = (
        await db_session.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.credential_id == cred.id,
                CredentialModelAccess.upstream_model_id == upstream_c.id,
            ),
        )
    ).scalar_one()
    assert access_c.status == "available"
    assert access_c.last_error is None
    access_verified_at = access_c.last_verified_at
    if access_verified_at is not None and access_verified_at.tzinfo is None:
        access_verified_at = access_verified_at.replace(tzinfo=t_new.tzinfo)
    assert access_verified_at == t_new


async def test_out_of_order_pass_never_overwrites_newer_verification(db_session) -> None:
    """A slow older verification result must not overwrite a newer success."""
    endpoint, cred = await _endpoint_and_credential(db_session)
    now = _utcnow()
    t_old = now - timedelta(minutes=10)
    t_new = now - timedelta(minutes=5)

    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(
            endpoint,
            cred,
            ["c"],
            observed_at=t_new,
            verification={"c": {"ok": True, "latencyMs": 12}},
        )],
    )
    await DiscoveryWorker._persist_results(
        db_session,
        [_result_item(
            endpoint,
            cred,
            ["c"],
            observed_at=t_old,
            verification={"c": {"ok": False, "latencyMs": 99, "reason": "stale failure"}},
        )],
    )

    upstream_c = (
        await db_session.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint.id,
                UpstreamModel.upstream_model_id == "c",
            ),
        )
    ).scalar_one()
    caps = upstream_c.capabilities or {}
    assert caps["verification_status"] == "working"
    assert caps["verified_at"] == t_new.isoformat()
    assert caps.get("verification_reason") is None
