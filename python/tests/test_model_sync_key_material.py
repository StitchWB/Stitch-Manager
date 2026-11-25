"""Install-key material reuse/provisioning integration with the gateway service."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

if TYPE_CHECKING:
    import pytest

import stitch_backend.database as database
from stitch_backend.domains.ai_gateway.models import InstallProxyKey
from stitch_backend.domains.ai_proxy.model_sync import key_material


async def test_provision_then_reuse_extracted_install_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(InstallProxyKey.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def run_write(fn, **kwargs):
        async with factory() as session:
            result = await fn(session)
            await session.commit()
            return result

    async def run_read(fn, **kwargs):
        async with factory() as session:
            return await fn(session)

    monkeypatch.setattr(database, "run_in_session", run_write)
    monkeypatch.setattr(database, "run_in_read_session", run_read)

    try:
        planned = await key_material.plan_key_material("opencode", None)
        assert planned.action == "create"

        created = await key_material.provision_key_material("opencode", None)
        assert created.action == "create"
        assert created.raw is not None
        assert created.created_key_id is not None

        preview_reuse = await key_material.plan_key_material("opencode", created.raw)
        assert preview_reuse.action == "reuse"
        assert preview_reuse.raw == created.raw
        assert preview_reuse.fingerprint == key_material.sha256_key(created.raw)

        apply_reuse = await key_material.provision_key_material("opencode", created.raw)
        assert apply_reuse.action == "reuse"
        assert apply_reuse.raw == created.raw
        assert apply_reuse.created_key_id is None

        # Raw material is never exposed in the public metadata fragment.
        assert created.raw not in str(apply_reuse.public_plan())
    finally:
        await engine.dispose()
