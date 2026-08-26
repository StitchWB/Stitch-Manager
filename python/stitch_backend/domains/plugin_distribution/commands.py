"""Plugin distribution commands — activation + pending failure-report management.

Activation (domain binding — server is the source of truth for entitlements):
  - ``dist_activate``: exchange a one-time code for a token, store ``.activation``
  - ``dist_status``: activation status + server-granted entitlements + tier
  - ``dist_deactivate``: clear the activation (deactivate)

Pending-report store (plan §7 Phase 4):
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

from .activation import ActivationService, derive_hwid
from .config import server_url, standalone_mode
from .pending_reports import delete_pending, list_pending, load_pending
from .report_client import ReportClient

logger = logging.getLogger(__name__)


# ── Activation (domain binding) ───────────────────────────────────────────────


@register_command("dist_activate")
async def cmd_dist_activate(params: dict) -> dict:
    """Exchange a one-time activation code for a token bound to this device.

    Auth-independent (works in desktop mode where ``auth_enabled=False``).
    The server resolves the code's tier against the authoritative tier-rights
    matrix and returns the granted entitlements, which are persisted to
    ``.activation`` and enforced locally.

    Params: ``{code: str}``.
    Returns ``{success, entitlements, tier}`` or ``{success: False, error}``.
    """
    code = str(params.get("code", "")).strip()
    if not code:
        return {"success": False, "error": "Activation code is required"}
    if standalone_mode():
        return {
            "success": False,
            "error": "No distribution server configured (STITCH_SERVER_URL)",
        }

    activation = ActivationService()
    try:
        state = await activation.activate(code, derive_hwid())
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = str(exc.response.json().get("detail", ""))
        except Exception:  # noqa: BLE001 — non-JSON body
            detail = exc.response.reason_phrase or ""
        logger.warning("dist_activate failed: %s %s", exc.response.status_code, detail)
        return {"success": False, "error": detail or f"HTTP {exc.response.status_code}"}
    except httpx.HTTPError as exc:
        logger.warning("dist_activate network error: %s", exc)
        return {"success": False, "error": f"Cannot reach server: {exc}"}
    except Exception as exc:  # noqa: BLE001 — surface as command error
        logger.warning("dist_activate error: %s", exc)
        return {"success": False, "error": str(exc)}

    return {
        "success": True,
        "activated": True,
        "entitlements": list(state.entitlements),
        "tier": state.tier,
        "server_url": server_url(),
    }


@register_command("dist_status", readonly=True)
async def cmd_dist_status(params: dict) -> dict:
    """Return activation status + server-granted entitlements + tier.

    Returns ``{activated, entitlements, tier, degraded, server_url}``.
    """
    activation = ActivationService()
    state = activation.load()
    if state is None:
        return {
            "activated": False,
            "entitlements": [],
            "tier": None,
            "degraded": False,
            "server_url": server_url(),
            "standalone": standalone_mode(),
        }
    return {
        "activated": True,
        "entitlements": list(state.entitlements),
        "tier": state.tier,
        "degraded": bool(state.degraded),
        "server_url": server_url(),
        "standalone": standalone_mode(),
    }


@register_command("dist_deactivate")
async def cmd_dist_deactivate(params: dict) -> dict:
    """Clear the activation (deactivate this device)."""
    activation = ActivationService()
    activation.clear()
    return {"success": True, "activated": False}


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
