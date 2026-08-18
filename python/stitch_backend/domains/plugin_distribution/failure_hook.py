"""Failure-report wiring — build + save a pending report on plugin run failure.

Called from :meth:`RegistrationService._run` after a provider run completes.
Reads telemetry consent from the ``settings`` table, asks the provider to
build a scrubbed bundle (if it is a plugin-backed provider that exposes
``build_failure_report``), and stores it as a pending report via
:mod:`.pending_reports`.  Never raises — telemetry must not break a run.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text as sql_text

from stitch_backend.database import run_in_read_session

from .pending_reports import save_pending_report

logger = logging.getLogger(__name__)

_CONSENT_KEY = "telemetry_consent"


async def _read_consent() -> bool:
    """Read ``telemetry_consent`` from the settings table (default off).

    Absent key = off.  String values ``"true"``/``"false"`` (case-insensitive).
    """
    async def _fetch(session: Any) -> bool:
        r = await session.execute(
            sql_text("SELECT value FROM settings WHERE key = :k"),
            {"k": _CONSENT_KEY},
        )
        row = r.first()
        return row is not None and str(row[0]).lower() == "true"

    try:
        return await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — never break a run
        logger.warning("failure_hook: consent read failed: %s", exc)
        return False


async def maybe_save_failure_report(
    provider: Any, result: dict[str, Any],
) -> None:
    """On plugin scenario failure with consent, build + save a pending report.

    Duck-types the provider for a ``build_failure_report`` method (only
    :class:`~autoreg.plugin.provider_adapter.PluginScenarioProvider` has it).
    Never raises.
    """
    if result.get("success"):
        return
    build_fn = getattr(provider, "build_failure_report", None)
    if build_fn is None:
        return
    try:
        consent = await _read_consent()
        if not consent:
            return
        bundle = build_fn(consent=True)
        if bundle is None:
            return
        report_id = save_pending_report(bundle)
        if report_id:
            logger.info(
                "Pending failure report saved: %s (plugin=%s step=%s)",
                report_id,
                bundle.get("plugin_id", ""),
                bundle.get("step", ""),
            )
    except Exception as exc:  # noqa: BLE001 — never break a run
        logger.warning("maybe_save_failure_report: failed: %s", exc)
