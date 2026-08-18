"""In-memory service monitoring: bot heartbeats + periodic health probes.

State is process-local and never persisted. The probe loop is started from
the app lifespan (``main.py``); tests park it by cancelling
``app.state.monitoring_task`` and call :func:`probe_once` directly with an
injected ``httpx`` transport.

Snapshot contract (GET /admin/monitoring) — web frontend is built on this:
``generated_at``, ``server{status,uptime_s,db_ok}``,
``web{status,latency_ms,last_check,detail}``,
``external{status,latency_ms,last_check,url,detail}``,
``bot{status(up|stale|unknown),last_heartbeat,age_s,route,candidates,
polling_errors,uptime_s}``,
``proxies[{url,status,latency_ms,last_check,detail}]``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from stitch_server.config import get_settings

logger = logging.getLogger(__name__)

_PROBE_TIMEOUT: float = 5.0
_TELEGRAM_PROBE_URL: str = "https://api.telegram.org/"


@dataclass
class ProbeResult:
    """One health-probe outcome."""

    status: str = "unknown"  # up | down | unknown
    latency_ms: float | None = None
    last_check: datetime | None = None
    detail: str | None = None


@dataclass
class ProxyProbe(ProbeResult):
    """Health-probe outcome for one TG proxy candidate."""

    url: str = ""


@dataclass
class BotState:
    """Latest bot heartbeat data."""

    route: str | None = None
    candidates: list[str] = field(default_factory=list)
    polling_errors: int | None = None
    uptime_s: float | None = None
    last_heartbeat: datetime | None = None


_web = ProbeResult()
_external = ProbeResult()
_bot = BotState()
_proxies: list[ProxyProbe] = []
_db_ok = True
_started_at = datetime.now(UTC)


def reset_state() -> None:
    """Clear all monitoring state (test isolation)."""
    global _web, _external, _bot, _proxies, _db_ok, _started_at
    _web = ProbeResult()
    _external = ProbeResult()
    _bot = BotState()
    _proxies = []
    _db_ok = True
    _started_at = datetime.now(UTC)


def record_heartbeat(payload: dict[str, Any]) -> None:
    """Store a bot heartbeat (POST /admin/bot-heartbeat body)."""
    _bot.route = payload.get("route")
    _bot.candidates = [str(c) for c in payload.get("candidates") or []]
    _bot.polling_errors = payload.get("polling_errors")
    _bot.uptime_s = payload.get("uptime_s")
    _bot.last_heartbeat = datetime.now(UTC)


def get_snapshot() -> dict[str, Any]:
    """Build the GET /admin/monitoring response (exact contract)."""
    now = datetime.now(UTC)
    settings = get_settings()

    if _bot.last_heartbeat is None:
        bot_status: str = "unknown"
        age_s: float | None = None
    else:
        age_s = (now - _bot.last_heartbeat).total_seconds()
        bot_status = "up" if age_s <= settings.monitoring_bot_stale_seconds else "stale"

    return {
        "generated_at": now,
        "server": {
            "status": "up",
            "uptime_s": (now - _started_at).total_seconds(),
            "db_ok": _db_ok,
        },
        "web": {
            "status": _web.status,
            "latency_ms": _web.latency_ms,
            "last_check": _web.last_check,
            "detail": _web.detail,
        },
        "external": {
            "status": _external.status,
            "latency_ms": _external.latency_ms,
            "last_check": _external.last_check,
            "url": settings.monitoring_external_url,
            "detail": _external.detail,
        },
        "bot": {
            "status": bot_status,
            "last_heartbeat": _bot.last_heartbeat,
            "age_s": age_s,
            "route": _bot.route,
            "candidates": list(_bot.candidates),
            "polling_errors": _bot.polling_errors,
            "uptime_s": _bot.uptime_s,
        },
        "proxies": [
            {
                "url": p.url,
                "status": p.status,
                "latency_ms": p.latency_ms,
                "last_check": p.last_check,
                "detail": p.detail,
            }
            for p in _proxies
        ],
    }


async def _probe_url(client: httpx.AsyncClient, url: str) -> tuple[str, float | None, str | None]:
    """GET ``url``; anything but an exception or 5xx counts as up."""
    started = time.perf_counter()
    try:
        resp = await client.get(url)
        latency = (time.perf_counter() - started) * 1000.0
        if resp.status_code < 500:
            return "up", round(latency, 1), None
        return "down", round(latency, 1), f"HTTP {resp.status_code}"
    except Exception as exc:  # noqa: BLE001 — probes must never raise
        return "down", None, str(exc) or type(exc).__name__


async def probe_once(transport: httpx.BaseTransport | None = None) -> None:
    """Probe web, external URL, DB, and every known proxy candidate once."""
    global _web, _external, _db_ok, _proxies
    settings = get_settings()
    now = datetime.now(UTC)

    client_kwargs: dict[str, Any] = {"timeout": _PROBE_TIMEOUT}
    if transport is not None:
        client_kwargs["transport"] = transport
    async with httpx.AsyncClient(**client_kwargs) as client:
        web_status, web_latency, web_detail = await _probe_url(
            client, settings.monitoring_web_url
        )
        _web = ProbeResult(web_status, web_latency, now, web_detail)
        ext_status, ext_latency, ext_detail = await _probe_url(
            client, settings.monitoring_external_url
        )
        _external = ProbeResult(ext_status, ext_latency, now, ext_detail)

    try:
        from sqlalchemy import text

        from stitch_server.db import get_session_factory

        factory = get_session_factory()
        async with factory() as session:
            await session.execute(text("SELECT 1"))
        _db_ok = True
    except Exception as exc:  # noqa: BLE001 — DB liveness check
        _db_ok = False
        logger.warning("Monitoring DB check failed: %s", exc)

    new_proxies: list[ProxyProbe] = []
    for url in list(_bot.candidates):
        p_kwargs: dict[str, Any] = {"timeout": _PROBE_TIMEOUT}
        if transport is not None:
            p_kwargs["transport"] = transport
        else:
            p_kwargs["proxy"] = url
        try:
            async with httpx.AsyncClient(**p_kwargs) as p_client:
                status, latency, detail = await _probe_url(p_client, _TELEGRAM_PROBE_URL)
        except Exception as exc:  # noqa: BLE001 — bad proxy param etc.
            status, latency, detail = "down", None, str(exc) or type(exc).__name__
        new_proxies.append(ProxyProbe(status, latency, now, detail, url))
    _proxies = new_proxies


async def probe_loop() -> None:
    """Periodic probe loop, started from the app lifespan.

    Sleeps FIRST so test apps (short-lived lifespans) never fire real
    network probes; production picks up its first probe one interval
    (60s) after boot, and heartbeats are visible immediately regardless.
    """
    while True:
        await asyncio.sleep(get_settings().monitoring_probe_interval_seconds)
        try:
            await probe_once()
        except Exception:  # noqa: BLE001 — the loop must survive probe bugs
            logger.exception("Monitoring probe iteration failed")
