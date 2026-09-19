"""Plugin submission + moderation commands (Feature 2, Phase C).

User-facing (dist Bearer token from ``.activation``):
  - ``submit_plugin``   — forward a release-spec JSON or a local zip (≤5MB,
    enforced client-side too) to ``POST /plugins/submit``.
  - ``my_submissions``  — the server exposes no per-user list; the queue is
    admin-keyed, so this is gated to admin callers (``_caller_role``).

Admin moderation (``admin_only`` at the dispatcher, ``X-Admin-Key`` upstream):
  - ``list_submissions`` / ``get_submission`` / ``approve_submission`` /
    ``reject_submission`` / ``delist_submission`` / ``set_plugin_badges``.

Attestation upload is intentionally NOT proxied — the offline signing CLI
(``stitch_plugin_tools attest``) talks to the server directly (OC3).

All commands return ``{success: False, error}`` dicts and never raise.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from stitch_backend.core.command_registry import register_command

from .activation import ActivationService
from .admin_router import _admin_key, _make_client, _upstream_headers
from .config import data_dir, server_url, standalone_mode

logger = logging.getLogger(__name__)

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_SUBMISSIONS_LOG = "plugin_submissions.json"


# ── Shared upstream plumbing ──────────────────────────────────────────────────


def _error_from_response(resp: httpx.Response) -> dict[str, Any]:
    """Map an upstream non-2xx response to a command error dict.

    422 gate failures carry ``detail = {"error": "gate_failure", "gates":
    {...}}`` — passed through as ``gate_report`` for the UI.
    """
    detail: Any = None
    try:
        detail = resp.json().get("detail")
    except ValueError:
        pass
    if resp.status_code == 401:
        return {"success": False, "error": "distribution server rejected the credentials"}
    if isinstance(detail, dict):
        return {
            "success": False,
            "error": str(detail.get("error") or f"distribution server error: {resp.status_code}"),
            "gate_report": detail,
        }
    return {
        "success": False,
        "error": str(detail or f"distribution server error: {resp.status_code}"),
    }


async def _proxy_request(
    method: str,
    path: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    data: dict[str, str] | None = None,
    files: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call the distribution server and return a command result dict."""
    url = f"{server_url()}{path}"
    async with _make_client() as client:
        try:
            resp = await client.request(
                method,
                url,
                headers=headers,
                json=json_body,
                params=params,
                data=data,
                files=files,
            )
        except httpx.HTTPError as exc:
            logger.warning("Distribution server unreachable: %s", exc)
            return {"success": False, "error": "distribution server unreachable"}
    if resp.status_code < 400:
        body = resp.json()
        if isinstance(body, dict):
            return {"success": True, **body}
        return {"success": True, "result": body}
    return _error_from_response(resp)


def _standalone_error() -> dict[str, Any] | None:
    if standalone_mode():
        return {"success": False, "error": "distribution server disabled"}
    return None


async def _admin_proxy(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """X-Admin-Key proxy for the moderation endpoints; never raises."""
    pre = _standalone_error()
    if pre is not None:
        return pre
    if not _admin_key():
        return {"success": False, "error": "distribution admin key not configured"}
    return await _proxy_request(
        method, path, headers=_upstream_headers(), json_body=json_body, params=params
    )


def _dist_token() -> str | None:
    """The activation Bearer token, or None when not activated."""
    state = ActivationService().load()
    if state is None or not state.token:
        return None
    return state.token


def _domains(params: dict) -> list[str]:
    """Normalize the ``declared_domains`` param (list or comma string)."""
    raw = params.get("declared_domains")
    if isinstance(raw, list):
        return [str(d).strip() for d in raw if str(d).strip()]
    if isinstance(raw, str):
        return [d.strip() for d in raw.split(",") if d.strip()]
    return []


def _sub_id(params: dict) -> int | None:
    try:
        return int(params.get("id"))
    except (TypeError, ValueError):
        return None


# ── Local submission history ──────────────────────────────────────────────────
#
# The server exposes no per-user submissions list, so each install keeps its
# own append-only record for the Phase E "My submissions" UI.


def _record_submission(
    *,
    submission_id: int | None,
    plugin_id: str,
    version: str,
    source_type: str,
    sha256: str | None,
) -> None:
    """Append a local record of a submission made from this install.

    Best-effort — a log write failure never fails the submission.
    """
    path = data_dir() / _SUBMISSIONS_LOG
    try:
        records: list[dict[str, Any]] = []
        if path.is_file():
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                records = raw
        records.append(
            {
                "submission_id": submission_id,
                "plugin_id": plugin_id,
                "version": version,
                "source_type": source_type,
                "sha256": sha256,
                "submitted_at": datetime.now(UTC).isoformat(),
            }
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(records, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError) as exc:
        logger.warning("Failed to record local submission: %s", exc)


# ── User-facing commands ──────────────────────────────────────────────────────


@register_command("submit_plugin")
async def cmd_submit_plugin(params: dict) -> dict:
    """Submit a plugin to the server moderation queue.

    Params:
        source_type: ``"release"`` (JSON release-spec) or ``"upload"``
            (local zip file, ≤5MB).
        plugin_id, version: required.
        source_url, sha256: required for ``release``.
        declared_domains: list or comma string (goto-step gate, OC4).
        zip_path: local zip path for ``upload``.
    """
    pre = _standalone_error()
    if pre is not None:
        return pre
    token = _dist_token()
    if token is None:
        return {"success": False, "error": "activation required"}

    source_type = str(params.get("source_type", "")).strip()
    plugin_id = str(params.get("plugin_id", "")).strip()
    version = str(params.get("version", "")).strip()
    if not plugin_id or not version:
        return {"success": False, "error": "plugin_id and version required"}

    headers = {"Authorization": f"Bearer {token}"}

    if source_type == "release":
        source_url = str(params.get("source_url", "")).strip()
        sha256 = str(params.get("sha256", "")).strip()
        if not source_url or not sha256:
            return {
                "success": False,
                "error": "source_url and sha256 required for release submit",
            }
        result = await _proxy_request(
            "POST",
            "/plugins/submit",
            headers=headers,
            json_body={
                "plugin_id": plugin_id,
                "version": version,
                "source_type": "release",
                "source_url": source_url,
                "sha256": sha256,
                "declared_domains": _domains(params),
            },
        )
    elif source_type == "upload":
        zip_path = str(params.get("zip_path", "")).strip()
        if not zip_path:
            return {"success": False, "error": "zip_path required for upload submit"}
        path = Path(zip_path)
        if not path.is_file():
            return {"success": False, "error": f"zip not found: {zip_path}"}
        payload = path.read_bytes()
        if len(payload) > _MAX_UPLOAD_BYTES:
            return {"success": False, "error": "zip exceeds 5MB limit"}
        result = await _proxy_request(
            "POST",
            "/plugins/submit",
            headers=headers,
            data={
                "plugin_id": plugin_id,
                "version": version,
                "declared_domains": json.dumps(_domains(params)),
            },
            files={"package": (path.name, payload, "application/zip")},
        )
    else:
        return {
            "success": False,
            "error": f"source_type must be 'release' or 'upload', got {source_type!r}",
        }

    if result.get("success"):
        _record_submission(
            submission_id=result.get("submission_id"),
            plugin_id=plugin_id,
            version=version,
            source_type=source_type,
            sha256=result.get("sha256"),
        )
    return result


@register_command("my_submissions", readonly=True)
async def cmd_my_submissions(params: dict) -> dict:
    """List the submissions queue (admin-keyed upstream → admin callers only).

    LIMITATION: the server has no per-user submissions endpoint, so a
    non-admin caller gets an error; the local record written by
    ``submit_plugin`` is the per-install history (Phase E consumes it).
    """
    if params.get("_caller_role") != "admin":
        return {"success": False, "error": "admin only"}
    return await _admin_proxy("GET", "/admin/submissions")


# ── Admin moderation proxies ──────────────────────────────────────────────────


@register_command("list_submissions", readonly=True, admin_only=True)
async def cmd_list_submissions(params: dict) -> dict:
    """GET /admin/submissions, optional ``status`` / ``plugin_id`` filters."""
    query: dict[str, Any] = {}
    if params.get("status"):
        query["status"] = str(params["status"])
    if params.get("plugin_id"):
        query["plugin_id"] = str(params["plugin_id"])
    return await _admin_proxy("GET", "/admin/submissions", params=query or None)


@register_command("get_submission", readonly=True, admin_only=True)
async def cmd_get_submission(params: dict) -> dict:
    """GET /admin/submissions/{id} — detail + manifest + gate_report."""
    sub_id = _sub_id(params)
    if sub_id is None:
        return {"success": False, "error": "id required"}
    return await _admin_proxy("GET", f"/admin/submissions/{sub_id}")


@register_command("approve_submission", admin_only=True)
async def cmd_approve_submission(params: dict) -> dict:
    """POST /admin/submissions/{id}/approve — re-run gates + publish."""
    sub_id = _sub_id(params)
    if sub_id is None:
        return {"success": False, "error": "id required"}
    reviewer = str(params.get("reviewer", "")).strip()
    if not reviewer:
        return {"success": False, "error": "reviewer required"}
    return await _admin_proxy(
        "POST", f"/admin/submissions/{sub_id}/approve", json_body={"reviewer": reviewer}
    )


@register_command("reject_submission", admin_only=True)
async def cmd_reject_submission(params: dict) -> dict:
    """POST /admin/submissions/{id}/reject with a reason."""
    sub_id = _sub_id(params)
    if sub_id is None:
        return {"success": False, "error": "id required"}
    reason = str(params.get("reason", "")).strip()
    if not reason:
        return {"success": False, "error": "reason required"}
    body: dict[str, Any] = {"reason": reason}
    reviewer = str(params.get("reviewer", "")).strip()
    if reviewer:
        body["reviewer"] = reviewer
    return await _admin_proxy(
        "POST", f"/admin/submissions/{sub_id}/reject", json_body=body
    )


@register_command("delist_submission", admin_only=True)
async def cmd_delist_submission(params: dict) -> dict:
    """POST /admin/submissions/{id}/delist — hide an approved submission (OC10)."""
    sub_id = _sub_id(params)
    if sub_id is None:
        return {"success": False, "error": "id required"}
    return await _admin_proxy("POST", f"/admin/submissions/{sub_id}/delist")


@register_command("set_plugin_badges", admin_only=True)
async def cmd_set_plugin_badges(params: dict) -> dict:
    """PUT /admin/plugins/{id}/badges — ``badges`` ⊆ {recommended, works, not_works}.

    ``verified`` is computed server-side from the attestation (OC12) and is
    rejected when set manually.
    """
    plugin_id = str(params.get("plugin_id", "")).strip()
    if not plugin_id:
        return {"success": False, "error": "plugin_id required"}
    raw_badges = params.get("badges")
    if not isinstance(raw_badges, list):
        return {"success": False, "error": "badges must be a list"}
    badges = [str(b) for b in raw_badges]
    return await _admin_proxy(
        "PUT", f"/admin/plugins/{plugin_id}/badges", json_body={"badges": badges}
    )
