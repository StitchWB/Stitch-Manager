"""Tests for install-scoped revocable proxy keys (model-sync targets).

Covers: hash-only storage, the 5-per-(purpose,target) cap, revoke semantics,
loopback-only enforcement (127.0.0.1 / ::1 / ::ffff:127.0.0.1 accepted,
non-loopback rejected without fall-through), PoolScope(None, (), True)
resolution, single-session resolution (no nested session), and batched
last_used_at flushing.
"""

from __future__ import annotations

import hashlib
import sys
import types
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import Base, _import_all_models
from stitch_backend.domains.ai_gateway import install_key_service as iks
from stitch_backend.domains.ai_gateway.install_key_service import (
    _MAX_ENABLED_INSTALL_KEYS_PER_TARGET,
    InstallKeyService,
    _hash_install_key,
    flush_install_key_last_used_at,
)
from stitch_backend.domains.ai_proxy.litellm_gateway import _is_loopback_client

LOCAL_TOKEN = "test-local-chat-token"


@pytest.fixture
async def session_factory():
    """In-memory SQLite shared across sessions via StaticPool."""
    _import_all_models()
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture(autouse=True)
def _clean_last_used_batch():
    iks._install_last_used_batch.clear()
    yield
    iks._install_last_used_batch.clear()


async def _create_key(session_factory, purpose="model-sync", target="opencode", label=None):
    async with session_factory() as session:
        svc = InstallKeyService(session)
        row, raw = await svc.create_install_key(purpose, target=target, label=label)
        await session.commit()
        return row.id, raw


# ── Service-level tests ─────────────────────────────────────────────────────


async def test_hash_only_storage(session_factory):
    async with session_factory() as session:
        svc = InstallKeyService(session)
        row, raw = await svc.create_install_key("model-sync", target="opencode", label="oc")
        await session.commit()

    assert len(raw) == 48  # secrets.token_hex(24)
    assert row.token_hash == hashlib.sha256(raw.encode()).hexdigest()
    assert row.token_hash == _hash_install_key(raw)
    assert len(row.token_hash) == 64
    assert raw not in row.token_hash
    # nowhere on the row is the raw key persisted
    assert not any(isinstance(v, str) and raw in v for v in vars(row).values())


async def test_cap_five_enabled_keys_per_target(session_factory):
    async with session_factory() as session:
        svc = InstallKeyService(session)
        for _ in range(_MAX_ENABLED_INSTALL_KEYS_PER_TARGET):
            await svc.create_install_key("model-sync", target="opencode")
        with pytest.raises(StitchError, match="enabled install keys"):
            await svc.create_install_key("model-sync", target="opencode")
        # a different target is unaffected by the cap
        await svc.create_install_key("model-sync", target="omp")
        # a different purpose with the same target is unaffected too
        await svc.create_install_key("other-purpose", target="opencode")
        await session.commit()


async def test_cap_counts_only_enabled(session_factory):
    ids = []
    async with session_factory() as session:
        svc = InstallKeyService(session)
        for _ in range(_MAX_ENABLED_INSTALL_KEYS_PER_TARGET):
            row, _raw = await svc.create_install_key("model-sync", target="opencode")
            ids.append(row.id)
        await session.commit()
    async with session_factory() as session:
        svc = InstallKeyService(session)
        await svc.revoke_install_key(ids[0])
        # revoking one frees a slot under the cap
        await svc.create_install_key("model-sync", target="opencode")
        await session.commit()


async def test_revoke_semantics(session_factory):
    key_id, raw = await _create_key(session_factory)

    async with session_factory() as session:
        svc = InstallKeyService(session)
        assert await svc.resolve_install_key(raw) is not None

    async with session_factory() as session:
        svc = InstallKeyService(session)
        assert await svc.revoke_install_key(key_id) is True
        await session.commit()

    async with session_factory() as session:
        svc = InstallKeyService(session)
        # revoked keys no longer resolve
        assert await svc.resolve_install_key(raw) is None
        row = await svc.get_by_pk(key_id)
        assert row.enabled is False
        assert row.revoked_at is not None

    async with session_factory() as session:
        svc = InstallKeyService(session)
        with pytest.raises(StitchError, match="not found"):
            await svc.revoke_install_key("does-not-exist")


async def test_list_never_returns_raw_keys(session_factory):
    key_id, raw = await _create_key(session_factory, label="opencode default")

    async with session_factory() as session:
        svc = InstallKeyService(session)
        rows = await svc.list_install_keys(purpose="model-sync")

    assert len(rows) == 1
    entry = rows[0]
    assert entry["id"] == key_id
    assert entry["purpose"] == "model-sync"
    assert entry["target"] == "opencode"
    assert entry["label"] == "opencode default"
    assert entry["enabled"] is True
    # fingerprint = first 8 chars of the sha256 hash, never the raw key
    assert entry["fingerprint"] == hashlib.sha256(raw.encode()).hexdigest()[:8]
    assert len(entry["fingerprint"]) == 8
    assert "token_hash" not in entry
    assert raw not in str(entry)


async def test_resolve_unknown_and_empty_keys(session_factory):
    async with session_factory() as session:
        svc = InstallKeyService(session)
        assert await svc.resolve_install_key("") is None
        assert await svc.resolve_install_key("f" * 48) is None


async def test_last_used_batching(session_factory):
    key_id, raw = await _create_key(session_factory)

    async with session_factory() as session:
        svc = InstallKeyService(session)
        row = await svc.resolve_install_key(raw)
        assert row is not None
        # in-memory accumulate only — the row itself is untouched
        assert row.last_used_at is None
        assert key_id in iks._install_last_used_batch
        await session.commit()

    # a fresh session still sees NULL — nothing was written per request
    async with session_factory() as session:
        svc = InstallKeyService(session)
        assert (await svc.get_by_pk(key_id)).last_used_at is None

    async with session_factory() as session:
        count = await flush_install_key_last_used_at(session)
        await session.commit()
    assert count == 1
    assert not iks._install_last_used_batch

    async with session_factory() as session:
        svc = InstallKeyService(session)
        assert (await svc.get_by_pk(key_id)).last_used_at is not None

    # empty batch is a no-op
    async with session_factory() as session:
        assert await flush_install_key_last_used_at(session) == 0


# ── Loopback helper unit tests ──────────────────────────────────────────────


def _request_with_client(host: str | None) -> Request:
    scope = {"type": "http", "method": "GET", "path": "/", "headers": []}
    if host is not None:
        scope["client"] = (host, 12345)
    return Request(scope)


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "::ffff:127.0.0.1"]
)
def test_loopback_accepted(host):
    assert _is_loopback_client(_request_with_client(host)) is True


@pytest.mark.parametrize(
    "host", ["10.0.0.5", "192.168.1.1", "8.8.8.8", "::ffff:10.0.0.5", "fe80::1", "not-an-ip"]
)
def test_non_loopback_rejected(host):
    assert _is_loopback_client(_request_with_client(host)) is False


def test_missing_client_rejected():
    assert _is_loopback_client(_request_with_client(None)) is False


def test_x_forwarded_for_never_trusted():
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", b"127.0.0.1")],
        "client": ("10.0.0.5", 12345),
    }
    assert _is_loopback_client(Request(scope)) is False


# ── Gateway-level tests (full /v1/models round-trip) ────────────────────────


class _FakeExecutor:
    """Stand-in for LiteLLMExecutor — records the pool it was invoked with."""

    last_pool = None

    def __init__(self, load_config=None):
        pass

    async def models(self, pool=None):
        type(self).last_pool = pool
        return {"object": "list", "data": []}

    async def chat(self, payload, pool=None):
        return {}

    async def messages(self, payload, pool=None):
        return {}

    async def responses(self, payload, pool=None):
        return {}


def _client_host_wrapper(app, host):
    async def wrapper(scope, receive, send):
        if scope["type"] == "http":
            scope = dict(scope)
            scope["client"] = (host, 12345)
        await app(scope, receive, send)

    return wrapper


@pytest.fixture
def gateway_client_factory(monkeypatch, session_factory):
    """Build the real litellm gateway router against the test DB.

    Heavy/irrelevant modules are replaced in sys.modules BEFORE the router
    factory runs (its imports are function-local): LiteLLMExecutor (routing)
    and chat_router (local token source).  ``get_db`` is patched on the
    database module so the factory's function-local ``from ... import``
    picks up the test session factory.
    """
    import stitch_backend.database as database
    from stitch_backend.domains.ai_proxy.litellm_gateway import (
        create_litellm_gateway_router,
    )

    session_entries = []

    @asynccontextmanager
    async def test_get_db():
        session_entries.append(1)
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(database, "get_db", test_get_db)

    fake_executor_mod = types.ModuleType("stitch_backend.domains.ai_proxy.litellm_executor")
    fake_executor_mod.LiteLLMExecutor = _FakeExecutor
    monkeypatch.setitem(
        sys.modules, "stitch_backend.domains.ai_proxy.litellm_executor", fake_executor_mod
    )

    fake_chat_mod = types.ModuleType("stitch_backend.domains.ai_proxy.chat_router")
    fake_chat_mod._LOCAL_CHAT_TOKEN = LOCAL_TOKEN
    monkeypatch.setitem(sys.modules, "stitch_backend.domains.ai_proxy.chat_router", fake_chat_mod)

    class _Settings:
        litellm_gateway_enabled = True
        litellm_gateway_local_api_key = None

    def build(host: str) -> httpx.AsyncClient:
        router = create_litellm_gateway_router(_Settings())
        assert router is not None
        app = FastAPI()
        app.include_router(router)
        wrapped = _client_host_wrapper(app, host)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=wrapped),
            base_url="http://testserver",
        )

    build.session_entries = session_entries
    return build


async def test_gateway_install_key_loopback_accepted(gateway_client_factory, session_factory):
    _key_id, raw = await _create_key(session_factory)
    for host in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
        async with gateway_client_factory(host) as client:
            resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"})
        assert resp.status_code == 200, f"{host}: {resp.text}"
        pool = _FakeExecutor.last_pool
        assert pool is not None
        assert pool.owner_user_id is None
        assert pool.group_ids == ()
        assert pool.include_instance_shared is True


async def test_gateway_install_key_non_loopback_rejected(gateway_client_factory, session_factory):
    _key_id, raw = await _create_key(session_factory)
    async with gateway_client_factory("10.0.0.5") as client:
        resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 401
    assert "loopback" in resp.text


async def test_gateway_install_key_no_fallthrough_to_local_token(
    gateway_client_factory,
    session_factory,
    monkeypatch,
):
    """A valid install key from a non-loopback peer must NOT fall through to
    the local-token check — even when the bearer would ALSO match it."""
    key_id, raw = await _create_key(session_factory)
    # Make the local token identical to the install key: if the resolver
    # fell through, the request would authenticate.  It must still 401.
    assert raw != LOCAL_TOKEN  # sanity: distinct secrets in the base case

    # Re-point the fake chat token at the raw install key value.
    sys.modules["stitch_backend.domains.ai_proxy.chat_router"]._LOCAL_CHAT_TOKEN = raw

    async with gateway_client_factory("10.0.0.5") as client:
        resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 401


async def test_gateway_revoked_install_key_rejected(gateway_client_factory, session_factory):
    key_id, raw = await _create_key(session_factory)
    async with session_factory() as session:
        svc = InstallKeyService(session)
        await svc.revoke_install_key(key_id)
        await session.commit()

    async with gateway_client_factory("127.0.0.1") as client:
        resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 401


async def test_gateway_invalid_bearer_rejected(gateway_client_factory, session_factory):
    async with gateway_client_factory("127.0.0.1") as client:
        resp = await client.get("/v1/models", headers={"Authorization": "Bearer " + "0" * 48})
    assert resp.status_code == 401


async def test_gateway_local_token_still_works(gateway_client_factory, session_factory):
    async with gateway_client_factory("127.0.0.1") as client:
        resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {LOCAL_TOKEN}"})
    assert resp.status_code == 200
    pool = _FakeExecutor.last_pool
    assert pool.owner_user_id is None
    assert pool.include_instance_shared is True


async def test_gateway_resolution_uses_single_session(gateway_client_factory, session_factory):
    """Install-key resolution must reuse the request's already-open session —
    exactly one get_db() checkout per request (a nested session would
    deadlock the pool_size=1 write pool)."""
    _key_id, raw = await _create_key(session_factory)
    async with gateway_client_factory("127.0.0.1") as client:
        before = len(gateway_client_factory.session_entries)
        resp = await client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"})
        after = len(gateway_client_factory.session_entries)
    assert resp.status_code == 200
    assert after - before == 1
