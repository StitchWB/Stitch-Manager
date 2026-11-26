"""Ownership-boundary regressions for the AI Gateway.

The desktop install is a single-user trust domain even when the operator is
logged in: install-scoped keys are machine credentials and must be able to
serve the connection that the desktop UI just saved.  Hosted multi-user
installs keep strict per-owner isolation.
"""

from __future__ import annotations

import socket
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from stitch_backend import startup
from stitch_backend.config import get_settings
from stitch_backend.database import Base
import stitch_backend.database as database
from stitch_backend.domains.ai_gateway.commands.save_connection import (
    cmd_save_connection,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,  # noqa: F401 - FK metadata
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.ownership import (
    backfill_desktop_instance_shared,
)
from stitch_backend.domains.ai_gateway.routing_engine import (
    GatewayRequest,
    PoolScope,
    RoutingEngine,
    RoutingError,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)
from stitch_backend.domains.ai_proxy.commands.accounts import (
    cmd_create_ai_proxy_account,
)
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.models import Group, GroupMember  # noqa: F401 - FK metadata
from stitch_backend.domains.settings.models import Setting

_DOMAIN_TABLES = [
    Setting.__table__,
    User.__table__,
    Group.__table__,
    GroupMember.__table__,
    CredentialGroupShare.__table__,
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
        f"sqlite+aiosqlite:///{tmp_path / 'owner-isolation.db'}",
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


@pytest.fixture
def desktop_mode(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STITCH_DESKTOP_MODE", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def hosted_mode(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("STITCH_DESKTOP_MODE", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _deterministic_public_dns(monkeypatch: pytest.MonkeyPatch):
    """Endpoint creation validates HTTPS DNS; keep the test offline."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port or 443))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


def _seed_user(db_session, user_id: int, username: str) -> None:
    db_session.add(User(
        id=user_id,
        username=username,
        password_hash="test-hash",
        role="admin" if user_id == 1 else "user",
    ))


async def _save_connection_as(db_session, user_id: int):
    return await cmd_save_connection.__wrapped__(
        db_session,
        {
            "name": "Desktop provider",
            "adapterType": "openai_compatible",
            "baseUrl": "https://api.test.invalid/v1",
            "auth": {"type": "api_key", "secrets": ["sk-desktop-live"]},
            "_caller_user_id": user_id,
            "_caller_role": "admin",
        },
    )


async def _create_legacy_account_as(db_session, user_id: int) -> Credential:
    await cmd_create_ai_proxy_account.__wrapped__(
        db_session,
        {
            "account": {
                "provider": "openai",
                "name": "legacy-desktop-key",
                "apiKey": "sk-legacy-alias",
                "baseUrl": "https://legacy.test.invalid/v1",
                "enabled": True,
            },
            "_caller_user_id": user_id,
            "_caller_role": "admin",
        },
    )
    result = await db_session.execute(
        select(Credential).where(Credential.label == "legacy-desktop-key")
    )
    return result.scalar_one()


async def _wire_public_route(db_session, endpoint, credential, owner_id=None):
    upstream = await UpstreamModelService(db_session).upsert_model(
        endpoint.id,
        "upstream-chat",
        capabilities={},
    )
    await CredentialModelAccessService(db_session).upsert_access(
        credential.id,
        upstream.id,
        status="available",
    )
    public = await PublicModelService(db_session).create_public_model(
        "desktop-chat",
        display_name="desktop-chat",
        owner_id=owner_id,
    )
    await RouteTargetService(db_session).create_target(public.id, upstream.id, priority=10)
    await db_session.flush()


async def test_desktop_admin_session_connection_is_routable_by_install_key_scope(
    db_session,
    desktop_mode,
):
    """Regression: the first desktop setup used an authenticated admin session.

    Before the fix that saved owner-bound rows, while install keys resolve to
    the machine scope ``PoolScope(None, (), True)`` — so routing witnessed
    ``No eligible credentials`` for a connection that visibly existed.
    """
    _seed_user(db_session, 1, "desktop-admin")
    saved = await _save_connection_as(db_session, 1)
    credential = saved.credentials[0]
    await _wire_public_route(
        db_session,
        saved.endpoint,
        credential,
        owner_id=saved.endpoint.owner_id,
    )

    results = await RoutingEngine().route(
        db_session,
        GatewayRequest(model="desktop-chat", messages=[]),
        pool=PoolScope(None, (), True),  # install key / local install token
    )

    assert [result.credential.id for result in results] == [credential.id]
    assert saved.endpoint.owner_id is None
    assert credential.owner_id is None

    # The legacy aiProxy alias is still a live creation path for the desktop UI.
    legacy_credential = await _create_legacy_account_as(db_session, 1)
    assert legacy_credential.owner_id is None
    legacy_endpoint = await db_session.get(
        ProviderEndpoint, legacy_credential.provider_endpoint_id
    )
    assert legacy_endpoint is not None
    assert legacy_endpoint.owner_id is None


async def test_hosted_mode_keeps_per_owner_routing_isolation(db_session, hosted_mode):
    """The owner boundary is real on hosted multi-user backends."""
    _seed_user(db_session, 1, "owner-admin")
    _seed_user(db_session, 2, "other-user")
    saved = await _save_connection_as(db_session, 1)
    credential = saved.credentials[0]
    await _wire_public_route(
        db_session,
        saved.endpoint,
        credential,
        owner_id=saved.endpoint.owner_id,
    )

    with pytest.raises(RoutingError, match="No eligible credentials"):
        await RoutingEngine().route(
            db_session,
            GatewayRequest(model="desktop-chat", messages=[]),
            pool=PoolScope(2, (), True),
        )

    owner_results = await RoutingEngine().route(
        db_session,
        GatewayRequest(model="desktop-chat", messages=[]),
        pool=PoolScope(1, (), True),
    )
    assert [result.credential.id for result in owner_results] == [credential.id]
    assert saved.endpoint.owner_id == 1
    assert credential.owner_id == 1

    legacy_credential = await _create_legacy_account_as(db_session, 1)
    assert legacy_credential.owner_id == 1


async def test_desktop_backfill_clears_existing_gateway_row_owners(db_session):
    """Existing desktop installs hit by the trap are repaired once at startup."""
    _seed_user(db_session, 1, "legacy-desktop-admin")
    endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="Legacy desktop provider",
        adapter_type="openai_compatible",
        base_url="https://api.test.invalid/v1",
        owner_id=1,
    )
    credential = await CredentialService(db_session).create_credential(
        endpoint.id,
        "legacy-key",
        "api_key",
        "sk-legacy",
        owner_id=1,
    )
    public = await PublicModelService(db_session).create_public_model(
        "legacy-chat",
        owner_id=1,
    )

    counts = await backfill_desktop_instance_shared(db_session)

    assert counts == {"endpoints": 1, "credentials": 1, "public_models": 1}
    assert endpoint.owner_id is None
    assert credential.owner_id is None
    assert public.owner_id is None


async def test_startup_backfill_is_desktop_only_and_runs_once(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    """Hosted rows are untouched; later explicit desktop claims stay claimed."""
    _seed_user(db_session, 1, "startup-desktop-admin")
    endpoint = await ProviderEndpointService(db_session).create_endpoint(
        name="Startup migration provider",
        adapter_type="openai_compatible",
        base_url="https://startup.test.invalid/v1",
        owner_id=1,
    )
    await db_session.commit()

    factory = async_sessionmaker(bind=db_session.bind, expire_on_commit=False)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)

    await startup.backfill_desktop_gateway_instance_shared(
        SimpleNamespace(desktop_mode=False)
    )
    await db_session.refresh(endpoint)
    assert endpoint.owner_id == 1

    await startup.backfill_desktop_gateway_instance_shared(
        SimpleNamespace(desktop_mode=True)
    )
    await db_session.refresh(endpoint)
    assert endpoint.owner_id is None

    # The guard is deliberate: an operator may explicitly claim a row later;
    # startup must not keep undoing that explicit admin action every boot.
    endpoint.owner_id = 1
    await db_session.commit()
    await startup.backfill_desktop_gateway_instance_shared(
        SimpleNamespace(desktop_mode=True)
    )
    await db_session.refresh(endpoint)
    assert endpoint.owner_id == 1
