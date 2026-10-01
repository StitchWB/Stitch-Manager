"""RegistrationService — in-process provider execution with real-time log streaming.

Replaces the Rust-era subprocess pattern.  Autoreg providers are called
directly via ``asyncio.to_thread()`` with ``log_callback`` wired to the
EventBus so the frontend receives logs over WebSocket in real-time.

Architecture note — Log bridging
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Providers and pipeline code use Python's standard ``logging`` module
(``logger.info(...)``), NOT ``self.log()``.  The ``_LogBridgeHandler``
installed in ``_run()`` captures ALL ``logging`` output from the
``autoreg`` and ``pipeline`` logger hierarchies and forwards it to the
EventBus via ``log_callback``.  Without this bridge, ZERO provider logs
reach the frontend.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from stitch_backend.core.event_bus import event_bus
from stitch_backend.core.event_schemas import LogEntryPayload, ObsEventPayload
from stitch_backend.domains.registration.cards import _load_cards
from stitch_backend.domains.registration.entitlement import _check_entitlement
from stitch_backend.domains.registration.log_bridge import (
    _install_log_bridge,
    _remove_log_bridge,
)
from stitch_backend.domains.registration.persistence import _save_registration_account
from stitch_backend.domains.registration.provider_factory import (
    _build_provider,
)
from stitch_backend.domains.registration.provider_factory import (
    _build_provider_kwargs as _build_provider_kwargs,
)
from stitch_backend.domains.registration.provider_factory import (
    _resolve_imap_password_from_db as _resolve_imap_password_from_db,
)
from stitch_backend.domains.registration.transport import (
    _make_event_bus_transport,
    cleanup_transport,
)
from stitch_backend.domains.registration.transport import (
    push_control_to_transport as push_control_to_transport,
)
from stitch_backend.domains.registration.v0_app import _prepare_v0_app

logger = logging.getLogger(__name__)


# ── Log callback factory ─────────────────────────────────────────────────

def _infer_level(message: str) -> str:
    """Derive log level from message content."""
    lower = message.lower()
    if "error" in lower or "failed" in lower or "fail" in lower:
        return "error"
    if "warn" in lower:
        return "warn"
    if "debug" in lower:
        return "debug"
    if "success" in lower or "created" in lower or "completed" in lower or "ok" in lower:
        return "success"
    return "info"


def _build_log_callback(job_id: str, provider_name: str):
    """Build a log_callback compatible with ``CommonProvider.set_log_callback``.

    The callback is called from the worker thread with a single string
    argument (``Callable[[str], None]``).  It emits both ``obs:event``
    (for the registration log panel) and ``logs:new`` (for the global
    Logs page).
    """
    def log_callback(message: str) -> None:
        level = _infer_level(message)
        obs = ObsEventPayload(
            source="python",
            subsystem="registration",
            level=level,
            message=message,
            jobId=job_id,
            provider=provider_name,
        )
        event_bus.emit_sync("obs:event", obs.model_dump(exclude_none=True))

        log_entry = LogEntryPayload(
            id=f"reg_{uuid.uuid4().hex[:12]}",
            timestamp=datetime.now(UTC).isoformat(),
            level=level,
            source="registration",
            message=message,
            channel="backend",
        )
        event_bus.emit_sync("logs:new", log_entry.model_dump())
    return log_callback


# ── Service ────────────�����������────────────────────────────────────────────────────

class RegistrationService:
    """In-process registration runner with real-time EventBus streaming."""

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}

    async def submit(self, provider_name: str, config: dict) -> str:
        """Submit a registration job.  Returns immediately with a job_id.

        The registration runs in a background ``asyncio.Task``.
        Progress is streamed via EventBus; final result is emitted as
        ``registration.completed`` or ``registration.failed``.

        ── Entitlement run-gate (plan §distribution) ──────────────────────
        Before creating the job, the caller's effective entitlements are
        checked against the canonical plugin id resolved from
        ``provider_name`` (service id, e.g. "kiro") via
        :func:`resolve_provider_plugin_id`.  When the plugin is not
        installed (``plugin_id is None``) the gate is skipped and the
        existing "provider not installed" error path in
        :func:`_build_provider` handles it — unchanged.

        Caller context (``_caller_user_id`` threaded as ``owner_id`` and
        ``_caller_role``) is read from ``config``.  Desktop / no-auth
        (both ``None``) → :func:`get_effective_entitlements` returns
        ``{"*"}`` → gate passes.  Role changes apply at next submission;
        in-flight jobs keep their submission-time entitlement snapshot
        (the gate runs once here, not per-step).

        A non-entitled caller is rejected with ``ValueError`` so the
        command dispatcher maps it to a 400 with the clear message
        ``"plugin '<id>' is not entitled for your role — contact admin"``.
        """
        await _check_entitlement(provider_name, config)

        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(UTC).isoformat()
        task = asyncio.create_task(self._run(job_id, provider_name, config))
        self._jobs[job_id] = {
            "id": job_id,
            "provider": provider_name,
            "state": "running",
            "step": "start",
            "progress": 0,
            "email": config.get("email", ""),
            "result": None,
            "error": None,
            "task": task,
            "created_at": now,
            "completed_at": None,
        }
        return job_id

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running registration job.

        Cancels the underlying ``asyncio.Task`` so the provider stops
        executing.  Returns ``True`` if the job was cancelled.
        """
        job = self._jobs.get(job_id)
        if not job or job["state"] != "running":
            return False

        task: asyncio.Task | None = job.get("task")
        if task and not task.done():
            task.cancel()
            job["state"] = "cancelled"
            await event_bus.emit("registration.failed", {
                "jobId": job_id,
                "provider": job.get("provider", ""),
                "error": "Cancelled by user",
                "message": "Registration cancelled by user",
            })
            return True
        return False

    async def run(self, provider_name: str, config: dict) -> dict:
        """Run registration synchronously (await until complete).

        Useful for simple callers that want to wait for the result.
        """
        # FIX 2 (P0): run() must gate on entitlements matching submit().
        await _check_entitlement(provider_name, config)
        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(UTC).isoformat()
        task = asyncio.create_task(self._run(job_id, provider_name, config))
        self._jobs[job_id] = {
            "id": job_id,
            "provider": provider_name,
            "state": "running",
            "step": "start",
            "progress": 0,
            "email": config.get("email", ""),
            "result": None,
            "error": None,
            "task": task,
            "created_at": now,
            "completed_at": None,
        }
        return await task

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[dict[str, Any]]:
        """Return all jobs sorted by created_at descending."""
        return sorted(
            self._jobs.values(),
            key=lambda j: j.get("created_at", ""),
            reverse=True,
        )

    def clear_jobs(self, status: str | None = None) -> int:
        """Remove completed/failed/cancelled jobs.  Returns count removed."""
        terminal = {"succeeded", "failed", "cancelled", "completed"}
        to_remove = [
            jid for jid, j in self._jobs.items()
            if j["state"] in terminal and (status is None or j["state"] == status)
        ]
        for jid in to_remove:
            del self._jobs[jid]
        return len(to_remove)

    def to_frontend_dict(self, job: dict[str, Any]) -> dict[str, Any]:
        """Convert internal job dict to RegistrationJob shape for frontend."""
        state = job.get("state", "unknown")
        # Map internal states to frontend-friendly statuses
        status_map = {
            "running": "running",
            "succeeded": "completed",
            "completed": "completed",
            "failed": "failed",
            "cancelled": "cancelled",
        }
        # Wrap the raw result dict in {data: ...} so waitForJobResult can read it
        raw_result = job.get("result")
        result_payload = {"data": raw_result} if raw_result else None
        return {
            "id": job.get("id", ""),
            "provider": job.get("provider", ""),
            "status": status_map.get(state, state),
            "step": job.get("step", ""),
            "progress": job.get("progress", 0),
            "email": job.get("email", ""),
            "error": job.get("error"),
            "createdAt": job.get("created_at"),
            "completedAt": job.get("completed_at"),
            "resultPayload": result_payload,
        }

    # ── Internal ──────────────────────────────────────────────────────────

    async def _run(self, job_id: str, provider_name: str, config: dict) -> dict:
        """Execute a single registration in a thread with log streaming."""

        log_callback = _build_log_callback(job_id, provider_name)

        # Idempotent migration here because offline/standalone jobs skip lifespan().
        try:
            from stitch_backend.database import create_all_tables as _migrate_db
            await _migrate_db()
        except Exception as _mig_exc:
            log_callback(f"[db] Schema migration warning: {_mig_exc!r}")

        # Providers use `logger.info()` not `self.log()` — bridge forwards to EventBus.
        bridge_handlers = _install_log_bridge(log_callback)

        provider = None
        _donor_id: str | None = None  # track donor for post-save increment
        try:
            # ── v0_app: auto-select proxy + referral donor ─────────────────
            if provider_name == "v0_app":
                config, _donor_id = await _prepare_v0_app(job_id, config, log_callback)

            # Build provider
            provider = _build_provider(provider_name, config)
            provider.set_log_callback(log_callback)


            event_transport = _make_event_bus_transport(job_id, provider_name)

            # Load card pool if configured
            _load_cards(provider_name, config)

            # Emit start event
            await event_bus.emit("registration.progress", {
                "jobId": job_id,
                "step": "start",
                "message": f"Starting {provider_name} registration...",
            })

            # Outbound proxy prevents IP leak during token exchange inside provider.
            outbound_proxy: str | None = None
            try:
                from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
                outbound_proxy = _get_outbound_proxy()
            except Exception:
                pass

            result = await asyncio.to_thread(
                provider.register,
                email=config.get("email"),
                password=config.get("password"),
                name=config.get("name"),
                transport=event_transport,
                proxy=outbound_proxy,
            )

            # Update job state
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "succeeded" if result.get("success") else "failed"
                job["step"] = "done"
                job["progress"] = 100
                job["result"] = result
                job["completed_at"] = datetime.now(UTC).isoformat()
                if result.get("email"):
                    job["email"] = result["email"]

            # Log provider result keys — missing/false `success` silently skips DB save.
            log_callback(
                f"[db] Provider result: success={result.get('success')!r} "
                f"email={result.get('email')!r} keys={sorted(result.keys())}"
            )
            if result.get("success"):
                # ── Persist account to the `accounts` table (UI source) ────
                reg_email = result.get("email") or config.get("email") or ""
                account_id = await _save_registration_account(
                    job_id, provider_name, config, result, reg_email, _donor_id, log_callback,
                )

                # ── Notify frontend: ACCOUNT_ADDED ─────────────────────────
                await event_bus.emit("registration.account_added", {
                    "jobId": job_id,
                    "id": account_id or "",
                    "email": reg_email,
                    "provider": provider_name,
                    "has_token": bool(result.get("token") or result.get("api_key")),
                })

                await event_bus.emit("registration.completed", {
                    "jobId": job_id,
                    "provider": provider_name,
                    "email": reg_email,
                    "accounts": result.get("accounts", []),
                    "success": True,
                })
            else:
                error_msg = result.get("error", "Unknown error")
                await event_bus.emit("registration.failed", {
                    "jobId": job_id,
                    "provider": provider_name,
                    "error": error_msg,
                    "message": f"Registration failed: {error_msg}",
                })

                try:
                    from stitch_backend.domains.plugin_distribution.failure_hook import (
                        maybe_save_failure_report,
                    )
                    await maybe_save_failure_report(provider, result)
                except Exception as _report_exc:  # noqa: BLE001
                    logger.debug("Failure report hook skipped: %s", _report_exc)

            return cast("dict[Any, Any]", result)

        except asyncio.CancelledError:
            logger.info("Registration %s cancelled by user", job_id)
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "cancelled"
                job["step"] = "cancelled"
                job["error"] = "Cancelled by user"
                job["completed_at"] = datetime.now(UTC).isoformat()
            return {"success": False, "error": "Cancelled by user", "provider": provider_name}

        except Exception as exc:
            logger.exception("Registration %s failed: %s", job_id, exc)
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "failed"
                job["step"] = "error"
                job["error"] = str(exc)
                job["completed_at"] = datetime.now(UTC).isoformat()

            await event_bus.emit("registration.failed", {
                "jobId": job_id,
                "provider": provider_name,
                "error": str(exc),
                "message": f"Registration failed: {exc}",
            })

            return {"success": False, "error": str(exc), "provider": provider_name}

        finally:
            # Remove logging bridge FIRST so cleanup logs still flow
            _remove_log_bridge(bridge_handlers)
            if provider and hasattr(provider, "close"):
                try:
                    provider.close()
                except Exception:
                    pass
            # Remove transport from registry so stale job_ids don't leak
            cleanup_transport(job_id)


# ── Singleton ───────────────────────────────────────────────────────────────

registration_service = RegistrationService()
