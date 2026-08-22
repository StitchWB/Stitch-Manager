"""Service-plugin host health + crash-loop alerting (plan v2 todo 25).

Readonly admin command ``get_service_plugin_health`` returns the runtime
registry's ``status_all()`` enriched with manifest ``version``, a
``last_error`` copy and the ``stderr_tail`` from the host's log ring
buffer — the data source for the "Service plugins" section of the web
Monitoring page (which polls it on its existing 30s refresh).

Alerting choice (documented per todo 25): the stitch_server alert ring
(``stitch_server.monitoring._maybe_add_alert``) lives in a separate
process driven by its own HTTP probe loop, so plugin hosts (which live
in the stitch_backend process) cannot push into it without new
cross-process plumbing — "MUST NOT: новый мониторинг-стек".  Instead the
crash-loop threshold check runs in the health command consumer itself,
and the TG alert reuses the fire-and-forget ephemeral-aiogram-Bot
pattern established by ``domains/groups/notify.py`` (same token source:
``stitch_bot.config.get_settings().tg_bot_token``).  Recipients are all
admin users with a linked ``telegram_id``.  Alerts are deduped per
plugin for ``_ALERT_DEDUPE_SECONDS`` (same 600s window as
``stitch_server.monitoring``).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.plugin_runtime import all_hosts, get_manifest

logger = logging.getLogger(__name__)

#: A host with at least this many restarts is considered crash-looping.
CRASH_LOOP_RESTARTS: int = 2

#: Per-plugin alert dedupe window (seconds) — mirrors stitch_server.
_ALERT_DEDUPE_SECONDS: float = 600.0

#: Max stderr lines embedded in a health entry.
_STDERR_TAIL_LINES: int = 20

#: plugin_id → monotonic timestamp of the last crash-loop alert.
_last_alert: dict[str, float] = {}


def reset_alert_state() -> None:
    """Clear the alert dedupe state (test isolation)."""
    _last_alert.clear()


def build_health_entries() -> list[dict[str, Any]]:
    """Enrich ``status_all()`` with version, last_error and stderr tail."""
    entries: list[dict[str, Any]] = []
    for host in all_hosts():
        status = host.status()
        manifest = get_manifest(host.plugin_id)
        entries.append({
            **status,
            "version": manifest.version if manifest else None,
            "last_error": status.get("error"),
            "stderr_tail": host.get_logs(_STDERR_TAIL_LINES),
        })
    return entries


def check_crash_loops(entries: list[dict[str, Any]]) -> list[str]:
    """Return plugin ids that crossed the crash-loop threshold just now.

    A host qualifies when ``restarts >= CRASH_LOOP_RESTARTS`` and it is
    not being stopped intentionally.  Each qualifying plugin fires at
    most once per ``_ALERT_DEDUPE_SECONDS`` window.
    """
    now = time.monotonic()
    fired: list[str] = []
    for entry in entries:
        if entry["stopping"]:
            continue
        if entry["restarts"] < CRASH_LOOP_RESTARTS:
            continue
        plugin_id = entry["plugin_id"]
        last = _last_alert.get(plugin_id)
        if last is not None and (now - last) < _ALERT_DEDUPE_SECONDS:
            continue
        _last_alert[plugin_id] = now
        fired.append(plugin_id)
    return fired


async def _notify_crash_loop(plugin_id: str, restarts: int) -> None:
    """Send a fire-and-forget TG alert to all admins about a crash-loop.

    Follows the ``domains/groups/notify.py`` pattern: ephemeral aiogram
    ``Bot`` from the shared stitch_bot token, closed right after the
    send.  All failures are swallowed at ``logger.debug`` — alerting
    must never break the health command.
    """
    try:
        from sqlalchemy import select

        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.auth.models import User

        factory = get_session_factory()
        async with factory() as db:
            result = await db.execute(
                select(User.telegram_id).where(
                    User.role == "admin",
                    User.telegram_id.is_not(None),
                )
            )
            targets = [row[0] for row in result.all()]

        if not targets:
            logger.debug(
                "Crash-loop alert skipped: no admin telegram_id (%s)", plugin_id
            )
            return

        from aiogram import Bot
        from stitch_bot.config import get_settings as _get_bot_settings

        token = _get_bot_settings().tg_bot_token
        if not token:
            logger.debug("Crash-loop alert skipped: TG_BOT_TOKEN not configured")
            return

        text = (
            f"⚠️ Stitch: сервисный плагин '{plugin_id}' в crash-loop "
            f"({restarts} рестартов). Monitoring → Service plugins."
        )
        bot = Bot(token=token)
        try:
            for telegram_id in targets:
                try:
                    await bot.send_message(telegram_id, text)
                except Exception:  # noqa: BLE001 — one bad target never blocks others
                    logger.debug(
                        "Crash-loop alert send failed for %s", telegram_id,
                        exc_info=True,
                    )
        finally:
            await bot.session.close()
    except Exception:
        logger.debug(
            "Crash-loop alert failed for %s", plugin_id, exc_info=True
        )


@register_command("get_service_plugin_health", readonly=True, admin_only=True)
async def _get_service_plugin_health(
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return enriched health for every service-plugin host (admin-only).

    Each entry is ``host.status()`` (supervisor status, pid,
    uptimeSeconds, restarts, stopping, source) plus ``version``
    (manifest), ``last_error`` and ``stderr_tail``.  Consuming this
    command also runs the crash-loop threshold check and fires deduped
    TG alerts — the Monitoring page polls every 30s, which is the alert
    heartbeat (no separate monitoring loop).
    """
    entries = build_health_entries()
    for plugin_id in check_crash_loops(entries):
        restarts = next(
            e["restarts"] for e in entries if e["plugin_id"] == plugin_id
        )
        logger.warning(
            "[Plugin:%s] crash-loop detected (%s restarts) — alerting admins",
            plugin_id, restarts,
        )
        await _notify_crash_loop(plugin_id, restarts)
    return entries
