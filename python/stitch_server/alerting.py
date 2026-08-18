"""Threshold alerting for report aggregation (plan §6 Phase 4, §7 Phase 4).

AlertSink is a pluggable abstraction: LoggingAlertSink (default) logs a
warning; WebhookAlertSink POSTs JSON {text, context} to a configured URL
(TG-stand-in — a real TG bot webhook can be wired to the same URL later
without code change). The checker fires at most once per
(plugin, version, step) per window via an in-memory dedupe map.

All alerting is guarded: failures never break report intake.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx

from stitch_server.aggregation import count_reports_for_group
from stitch_server.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Sink protocol ──────────────────────────────────────────────────────────────


class AlertSink:
    """Abstract alert sink. Subclasses implement ``emit``."""

    async def emit(self, message: str, context: Mapping[str, object]) -> None:
        raise NotImplementedError


class LoggingAlertSink(AlertSink):
    """Default sink: logs a warning with the message and context."""

    async def emit(self, message: str, context: Mapping[str, object]) -> None:
        logger.warning("Alert: %s  context=%s", message, dict(context))


class WebhookAlertSink(AlertSink):
    """POSTs JSON {text, context} to a webhook URL via httpx.

    A real Telegram bot webhook can be wired to the same URL later without
    code change — this sink is the TG-stand-in per plan §7 Phase 4.
    """

    def __init__(
        self,
        url: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._url = url
        self._transport = transport
        self._timeout = timeout

    async def emit(self, message: str, context: Mapping[str, object]) -> None:
        client_kwargs: dict[str, object] = {"timeout": self._timeout}
        if self._transport is not None:
            client_kwargs["transport"] = self._transport
        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.post(
                self._url,
                json={"text": message, "context": dict(context)},
            )
            resp.raise_for_status()


# ── Sink factory ───────────────────────────────────────────────────────────────

_alert_sink: AlertSink | None = None


def get_alert_sink() -> AlertSink:
    """Return the cached alert sink (lazy singleton).

    WebhookAlertSink if STITCH_SERVER_ALERT_WEBHOOK_URL is set,
    LoggingAlertSink otherwise.
    """
    global _alert_sink  # noqa: PLW0603
    if _alert_sink is None:
        settings = get_settings()
        if settings.alert_webhook_url:
            _alert_sink = WebhookAlertSink(settings.alert_webhook_url)
        else:
            _alert_sink = LoggingAlertSink()
    return _alert_sink


def set_alert_sink(sink: AlertSink | None) -> None:
    """Override the alert sink (for tests)."""
    global _alert_sink  # noqa: PLW0603
    _alert_sink = sink


def reset_alert_sink() -> None:
    """Clear the cached sink (for tests)."""
    global _alert_sink  # noqa: PLW0603
    _alert_sink = None


# ── Dedupe + checker ───────────────────────────────────────────────────────────

# In-memory dedupe: {(plugin_id, version, step): datetime_alerted}.
# Atomic within a single event loop — no await between check and set, so
# concurrent requests cannot race past the dedupe guard.
_alerted: dict[tuple[str, str, str], datetime] = {}


def _should_alert(
    key: tuple[str, str, str], window_hours: int, now: datetime
) -> bool:
    """Return True if the group has not been alerted within the window."""
    last = _alerted.get(key)
    if last is None:
        return True
    return (now - last).total_seconds() >= window_hours * 3600


def _mark_alerted(key: tuple[str, str, str], now: datetime) -> None:
    _alerted[key] = now


def reset_alert_state() -> None:
    """Clear the dedupe map (for tests)."""
    _alerted.clear()


async def check_alert_for_group(
    db: AsyncSession,
    plugin_id: str,
    version: str,
    step: str,
) -> None:
    """Check if a (plugin, version, step) group has reached the alert threshold.

    Fires the alert sink at most once per group per window. All errors are
    caught — alerting never breaks report intake.
    """
    try:
        settings = get_settings()
        threshold = settings.alert_threshold
        window_hours = settings.alert_window_hours
        count = await count_reports_for_group(db, plugin_id, version, step, window_hours)
        if count < threshold:
            return
        key = (plugin_id, version, step)
        now = datetime.now(UTC)
        # Dedupe check + mark is atomic (no await between them) — concurrent
        # requests for the same group cannot both pass the guard.
        if not _should_alert(key, window_hours, now):
            return
        _mark_alerted(key, now)
        message = (
            f"Report threshold reached: plugin={plugin_id} version={version} "
            f"step={step} count={count} (threshold={threshold}, "
            f"window={window_hours}h)"
        )
        context: dict[str, object] = {
            "plugin_id": plugin_id,
            "version": version,
            "step": step,
            "count": count,
            "threshold": threshold,
            "window_hours": window_hours,
        }
        sink = get_alert_sink()
        await sink.emit(message, context)
    except Exception:
        logger.exception(
            "Alert check failed for %s/%s/%s", plugin_id, version, step
        )
