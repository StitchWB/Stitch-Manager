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
from datetime import datetime, timezone
from typing import Any

from stitch_backend.config import REPO_ROOT
from stitch_backend.core.event_bus import event_bus
from stitch_backend.core.event_schemas import LogEntryPayload, ObsEventPayload

logger = logging.getLogger(__name__)


# ── Provider factory ────────────────────────────────────────────────────────

def _resolve_imap_password_from_db(host: str) -> str:
    """Synchronously resolve the real IMAP/Gmail password from the settings DB."""
    import sqlite3 as _sqlite3
    from stitch_backend.config import _app_data_dir, PYTHON_DIR, REPO_ROOT
    # Mirror the same DB-path logic as _default_db_url()
    canonical = _app_data_dir() / "stitch-manager"
    if canonical.is_dir():
        db_path = canonical / "stitch.db"
    else:
        db_path = REPO_ROOT / "stitch.db"
        # Also try python/stitch.db (dev layout)
        if not db_path.exists():
            db_path = PYTHON_DIR / "stitch.db"
    key = "gmailAppPassword" if "gmail" in host.lower() else "imapPassword"
    try:
        con = _sqlite3.connect(str(db_path), timeout=5)
        row = con.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        con.close()
        return row[0] if row and row[0] else ""
    except Exception as exc:
        logger.warning("_resolve_imap_password_from_db failed: %s", exc)
        return ""


def _build_imap_config(config: dict) -> dict | None:
    """Extract IMAP config from frontend config dict.

    Accepts both camelCase (from frontend JSON) and snake_case keys.
    When the password is the sentinel '********' (masked by settings API),
    resolves the real password from the settings DB synchronously.
    """
    server = config.get("imap_server") or config.get("imapServer")
    user = config.get("imap_user") or config.get("imapUser")
    password = config.get("imap_password") or config.get("imapPassword")
    if server and user and password:
        port_raw = config.get("imap_port") or config.get("imapPort") or 993
        # Resolve sentinel — frontend sends '********' when the password is
        # stored in the DB (to avoid echoing it to the UI).
        if password in ("********", "••••••••", ""):
            real_pwd = _resolve_imap_password_from_db(str(server))
            if real_pwd:
                logger.debug("_build_imap_config: resolved DB password for %s", server)
                password = real_pwd
            else:
                logger.warning(
                    "_build_imap_config: sentinel received but no password in DB for %s",
                    server,
                )
                return None  # Don't build a broken imap_config
        logger.debug(
            "_build_imap_config: server=%s user=%s password_len=%d",
            server, user, len(password),
        )
        return {
            "host": server,
            "user": user,
            "password": password,
            "port": int(port_raw),
        }
    return None


def _build_addyio_config(config: dict):
    """Extract AddyIO config from frontend config dict."""
    if not (config.get("addyio_enabled") or config.get("addyioEnabled")):
        return None
    from autoreg.services.addyio import AddyIoConfig
    return AddyIoConfig(
        api_token=config.get("addyio_api_token") or config.get("addyioApiToken") or "",
        domain=config.get("addyio_domain") or config.get("addyioDomain") or "",
        alias_format=config.get("addyio_alias_format") or config.get("addyioAliasFormat") or "uuid",
        auto_delete=bool(config.get("addyio_auto_delete") or config.get("addyioAutoDelete")),
    )


def _build_mailtm_config(config: dict) -> dict | None:
    """Extract MailTM inbox config from frontend config dict."""
    address = (config.get("inbox_mailtm_address") or config.get("inboxMailtmAddress") or "").strip()
    password = (config.get("inbox_mailtm_password") or config.get("inboxMailtmPassword") or "").strip()
    if not address or not password:
        return None
    return {
        "address": address,
        "password": password,
        "base_url": config.get("inbox_mailtm_base_url", "https://api.mail.tm"),
    }


def _build_33mail_config(config: dict) -> dict | None:
    """Extract 33mail config from frontend config dict."""
    if not (config.get("thirty_three_mail_enabled") or config.get("thirtyThreeMailEnabled")):
        return None
    username = (config.get("thirty_three_mail_username") or config.get("thirtyThreeMailUsername") or "").strip()
    if not username:
        return None
    return {
        "username": username,
        "domain": config.get("thirty_three_mail_domain") or config.get("thirtyThreeMailDomain") or "33mail.com",
    }


def _build_provider_kwargs(config: dict) -> dict[str, Any]:
    """Build common provider kwargs from frontend config dict.

    Accepts both camelCase (from frontend JSON) and snake_case keys.
    """
    kwargs: dict[str, Any] = {
        "headless": config.get("headless", True),
        "imap_config": _build_imap_config(config),
        "email_strategy": config.get("email_strategy") or config.get("emailStrategy") or "mailtm",
        "base_email": config.get("base_email") or config.get("baseEmail") or None,
        "addyio_config": _build_addyio_config(config),
        "thirty_three_mail_config": _build_33mail_config(config),
        "mailtm_inbox_config": _build_mailtm_config(config),
    }
    return kwargs


def _build_provider(provider_name: str, config: dict):
    """Instantiate the correct autoreg provider from config dict."""

    base_kwargs = _build_provider_kwargs(config)

    if provider_name == "fireworks":
        from autoreg.providers.fireworks import FireworksProvider
        return FireworksProvider(
            **base_kwargs,
            proxy_enabled=bool(config.get("proxy_url")),
            proxy_url=config.get("proxy_url"),
            proxy_type=config.get("proxy_type", "http"),
            proxy_username=config.get("proxy_username"),
            proxy_password=config.get("proxy_password"),
        )

    if provider_name == "qoder":
        from autoreg.providers.qoder.provider import QoderProvider
        return QoderProvider(
            **base_kwargs,
            proxy_enabled=bool(config.get("proxy_url")),
            proxy_url=config.get("proxy_url"),
            proxy_type=config.get("proxy_type", "http"),
            proxy_username=config.get("proxy_username"),
            proxy_password=config.get("proxy_password"),
        )

    if provider_name in ("kiro", "kiro_v2"):
        from autoreg.providers.kiro_v2 import KiroV2Provider
        return KiroV2Provider(**base_kwargs)

    if provider_name == "windsurf":
        from autoreg.providers.windsurf import WindsurfProvider
        return WindsurfProvider(**base_kwargs)

    if provider_name == "trae":
        from autoreg.providers.trae import TraeProvider
        return TraeProvider(**base_kwargs)

    if provider_name == "openai":
        from autoreg.providers.openai import OpenAIProvider
        return OpenAIProvider(
            **base_kwargs,
            proxy_enabled=bool(config.get("proxy_url")),
            proxy_url=config.get("proxy_url"),
            proxy_type=config.get("proxy_type", "http"),
            proxy_username=config.get("proxy_username"),
            proxy_password=config.get("proxy_password"),
        )

    if provider_name == "github":
        from autoreg.providers.github import GithubProvider
        return GithubProvider(**base_kwargs)

    if provider_name == "bitbucket":
        from autoreg.providers.bitbucket import BitbucketProvider
        return BitbucketProvider(**base_kwargs)

    raise ValueError(f"Unknown provider: {provider_name}")


# ── Logging bridge ─────────────────────────────────────────────────────────
#
# CRITICAL: Providers (FireworksProvider, KiroProvider, etc.) and pipeline
# code use ``logger.info()`` — they NEVER call ``self.log()``.  Without this
# bridge, zero logs reach the frontend.
#
# We install a custom logging.Handler on the ``autoreg`` and ``pipeline``
# logger hierarchies.  Every log record is formatted and forwarded to the
# log_callback, which emits obs:event + logs:new to the EventBus.

class _LogBridgeHandler(logging.Handler):
    """Forward Python logging records to a ``Callable[[str], None]`` callback."""

    # Stable marker so we can recognise bridge handlers even across module
    # hot-reloads (where isinstance() fails because the class object differs).
    _is_stitch_log_bridge = True

    def __init__(self, callback: "callable[[str], None]") -> None:
        super().__init__(level=logging.DEBUG)
        self._callback = callback

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self._callback(msg)
        except Exception:
            pass  # Never let logging crash the provider


# Logger names to bridge — covers all autoreg providers + pipeline code
_BRIDGE_LOGGER_NAMES = ("autoreg",)


def _install_log_bridge(callback: "callable[[str], None]") -> list[_LogBridgeHandler]:
    """Attach ``_LogBridgeHandler`` to all autoreg/pipeline loggers.

    Idempotent: any previously-attached bridge handlers are removed first so
    that concurrent/overlapping jobs in the same backend process can NEVER
    accumulate multiple handlers (which would deliver each log N times).
    """
    handlers: list[_LogBridgeHandler] = []
    for name in _BRIDGE_LOGGER_NAMES:
        lg = logging.getLogger(name)
        # Purge any stale bridge handlers left over from a previous job.
        # Match by marker attribute (not isinstance) so handlers from a
        # hot-reloaded module are also removed — otherwise they accumulate
        # and every log line is delivered N times.
        for h in list(lg.handlers):
            if getattr(h, "_is_stitch_log_bridge", False):
                lg.removeHandler(h)
                try:
                    h.close()
                except Exception:
                    pass
        handler = _LogBridgeHandler(callback)
        handler.setFormatter(logging.Formatter("%(message)s"))
        lg.addHandler(handler)
        # Ensure the logger level allows info/debug records through.
        if lg.level == logging.NOTSET or lg.level > logging.DEBUG:
            lg.setLevel(logging.DEBUG)
        # Disable propagation so records don't ALSO go to the root logger.
        lg.propagate = False
        handlers.append(handler)
    return handlers


def _remove_log_bridge(handlers: list[_LogBridgeHandler]) -> None:
    """Detach bridge handlers from their loggers and restore propagation."""
    for handler in handlers:
        for name in _BRIDGE_LOGGER_NAMES:
            try:
                lg = logging.getLogger(name)
                lg.removeHandler(handler)
                # Restore propagation so normal logging works outside of jobs
                lg.propagate = True
            except Exception:
                pass
        handler.close()


# ── EventBus pipeline transport ──────────────────────────────────────────────
#
# PipeTransport writes JSON to sys.stdout — designed for subprocess mode.
# In-process mode needs events to go through the EventBus instead.

def _make_event_bus_transport(job_id: str, provider_name: str):
    """Create a PipeTransport subclass that also emits events to EventBus."""
    from autoreg.pipeline.transport import PipeTransport

    class EventBusTransport(PipeTransport):
        """PipeTransport that mirrors emits to the EventBus."""

        def emit(self, event: str, data: dict) -> None:
            # Call parent (writes to stdout for backwards compat)
            super().emit(event, data)
            # Also emit to EventBus as pipeline.* event
            event_bus.emit_sync(
                f"pipeline.{event}",
                {"jobId": job_id, "provider": provider_name, **data},
            )

        def _ensure_reader(self) -> None:
            # In-process: no stdin reader needed — control signals come
            # via the registration_control command, not stdin
            pass

    return EventBusTransport()


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
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            source="registration",
            message=message,
            channel="backend",
        )
        event_bus.emit_sync("logs:new", log_entry.model_dump())
    return log_callback


# ── Service ─────────────────────────────────────────────────────────────────

class RegistrationService:
    """In-process registration runner with real-time EventBus streaming."""

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}

    async def submit(self, provider_name: str, config: dict) -> str:
        """Submit a registration job.  Returns immediately with a job_id.

        The registration runs in a background ``asyncio.Task``.
        Progress is streamed via EventBus; final result is emitted as
        ``registration.completed`` or ``registration.failed``.
        """
        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
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
        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
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

        # Install logging bridge: capture ALL logger.info() from autoreg/pipeline
        # and forward to the EventBus.  Without this, zero logs reach the frontend
        # because providers use ``logger.info()`` not ``self.log()``.
        bridge_handlers = _install_log_bridge(log_callback)

        provider = None
        try:
            # Build provider
            provider = _build_provider(provider_name, config)
            provider.set_log_callback(log_callback)

            # Load card pool if configured
            _load_cards(provider_name, config)

            # Emit start event
            await event_bus.emit("registration.progress", {
                "jobId": job_id,
                "step": "start",
                "message": f"Starting {provider_name} registration...",
            })

            # Run blocking provider.register() in a thread
            result = await asyncio.to_thread(
                provider.register,
                email=config.get("email"),
                password=config.get("password"),
                name=config.get("name"),
            )

            # Update job state
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "succeeded" if result.get("success") else "failed"
                job["step"] = "done"
                job["progress"] = 100
                job["result"] = result
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                if result.get("email"):
                    job["email"] = result["email"]

            # Emit completion event
            if result.get("success"):
                await event_bus.emit("registration.completed", {
                    "jobId": job_id,
                    "provider": provider_name,
                    "email": result.get("email"),
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

            return result

        except asyncio.CancelledError:
            logger.info("Registration %s cancelled by user", job_id)
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "cancelled"
                job["step"] = "cancelled"
                job["error"] = "Cancelled by user"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
            return {"success": False, "error": "Cancelled by user", "provider": provider_name}

        except Exception as exc:
            logger.exception("Registration %s failed: %s", job_id, exc)
            job = self._jobs.get(job_id)
            if job:
                job["state"] = "failed"
                job["step"] = "error"
                job["error"] = str(exc)
                job["completed_at"] = datetime.now(timezone.utc).isoformat()

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


def _load_cards(provider_name: str, config: dict) -> None:
    """Load card pool from config (cards_file, cards_text, card_bin)."""
    cards_file = config.get("cards_file", "")
    cards_text = config.get("cards_text", "")
    card_bin = config.get("card_bin", "")

    if not any([cards_file, cards_text, card_bin]):
        return

    try:
        from autoreg.core.card_pool import get_card_pool
        pool = get_card_pool()
        if cards_file:
            pool.load_from_file(provider_name, cards_file)
        elif cards_text:
            pool.load_from_text(provider_name, cards_text)
        elif card_bin:
            from autoreg.core.card_generator import start_live_card_search
            finder = start_live_card_search(card_bin, max_attempts=50)
            import time
            time.sleep(5)
            if finder.live_card:
                pool.load_from_text(provider_name, finder.live_card)
    except Exception as exc:
        logger.warning("Card pool loading failed: %s", exc)


# ── Singleton ───────────────────────────────────────────────────────────────

registration_service = RegistrationService()
