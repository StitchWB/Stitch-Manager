"""Plugin distribution commands — pending failure-report management (plan §7 Phase 4).

Exposes the pending-report store to the UI:
  - ``get_pending_reports``: list metadata for all pending reports
  - ``get_report_preview``: preview the exact bundle that will be sent
  - ``send_report``: POST the bundle via :class:`ReportClient`, delete on success
  - ``discard_report``: delete a pending report without sending

Frontend calls ``POST /api/{command_name}`` with a JSON body.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from autoreg.plugin.reporter import preview_bundle
from stitch_backend.core.command_registry import register_command

from .activation import ActivationService
from .pending_reports import delete_pending, list_pending, load_pending
from .report_client import ReportClient

logger = logging.getLogger(__name__)


@register_command("get_pending_reports", readonly=True)
async def cmd_get_pending_reports(params: dict) -> dict:
    """List all pending failure reports (metadata only)."""
    return {"reports": list_pending()}


@register_command("get_report_preview", readonly=True)
async def cmd_get_report_preview(params: dict) -> dict:
    """Preview the exact bundle that will be sent for ``id``."""
    report_id = str(params.get("id", ""))
    wrapper = load_pending(report_id)
    if wrapper is None:
        return {"success": False, "error": "not found"}
    bundle: dict[str, Any] = wrapper.get("bundle", {})
    preview = preview_bundle(bundle)
    return {
        "id": report_id,
        "bundle": preview,
        "sensitive_dropped": bool(bundle.get("scrubbed", False)),
    }


@register_command("send_report")
async def cmd_send_report(params: dict) -> dict:
    """Send a pending report via :class:`ReportClient`. Deletes on success."""
    report_id = str(params.get("id", ""))
    wrapper = load_pending(report_id)
    if wrapper is None:
        return {"success": False, "error": "not found"}
    bundle: dict[str, Any] = wrapper.get("bundle", {})
    activation = ActivationService()
    async with httpx.AsyncClient(timeout=15.0) as client:
        rc = ReportClient(activation, client=client)
        ok = await rc.send(bundle)
    if ok:
        delete_pending(report_id)
        return {"success": True}
    return {"success": False, "error": "send failed"}


@register_command("discard_report")
async def cmd_discard_report(params: dict) -> dict:
    """Discard a pending report without sending."""
    report_id = str(params.get("id", ""))
    deleted = delete_pending(report_id)
    if deleted:
        return {"success": True}
    return {"success": False, "error": "not found"}
