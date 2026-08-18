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
from typing import TYPE_CHECKING, Any, cast

from stitch_backend.config import REPO_ROOT

if TYPE_CHECKING:
    from collections.abc import Callable
from stitch_backend.core.event_bus import event_bus
from stitch_backend.core.event_schemas import LogEntryPayload, ObsEventPayload

logger = logging.getLogger(__name__)


# ── Provider factory ────────────────────────────────────────────────────────

def _resolve_imap_password_from_db(
    host: str, owner_id: int | None = None
) -> str:
    """Synchronously resolve the real IMAP/Gmail password from the settings DB.

    When ``owner_id`` is given, the user-scoped key ``u<uid>:<key>`` is tried
    first, falling back to the global key.  When ``owner_id`` is ``None``
    (desktop), only the global key is read — byte-identical to the
    pre-multi-user behaviour.
    """
    import sqlite3 as _sqlite3

    from stitch_backend.config import PYTHON_DIR, _app_data_dir
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
    user_key = f"u{owner_id}:{key}" if owner_id is not None else None
    try:
        con = _sqlite3.connect(str(db_path), timeout=5)
        # Try user-scoped key first, then global.
        if user_key:
            row = con.execute(
                "SELECT value FROM settings WHERE key = ?", (user_key,)
            ).fetchone()
            if row and row[0]:
                con.close()
                return row[0]
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
    Threads ``owner_id`` from config to the resolver for per-user lookup.
    """
    server = config.get("imap_server") or config.get("imapServer")
    user = config.get("imap_user") or config.get("imapUser")
    password = config.get("imap_password") or config.get("imapPassword")
    owner_id = config.get("owner_id") or config.get("_caller_user_id")
    if server and user and password:
        port_raw = config.get("imap_port") or config.get("imapPort") or 993
        # Resolve sentinel — frontend sends '********' when the password is
        # stored in the DB (to avoid echoing it to the UI).
        if password in ("********", "••••••••", ""):
            real_pwd = _resolve_imap_password_from_db(
                str(server), owner_id=owner_id
            )
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


def _autoreg_providers_available() -> bool:
    """Whether ``autoreg.providers`` (Zone 2) is importable in this build.

    Uses ``importlib.util.find_spec`` — no import side effects and no
    ``import autoreg.providers`` statement, so the zone-boundary leak-guard
    does not flag it.  The open-core build ships without ``autoreg/providers/``;
    this lets registration degrade gracefully instead of crashing with
    ImportError.
    """
    import importlib.util

    try:
        return importlib.util.find_spec("autoreg.providers") is not None
    except (ImportError, ValueError):
        return False


def _build_provider(provider_name: str, config: dict):
    """Instantiate the correct autoreg provider from config dict.

    autoreg modules are imported lazily but cached in sys.modules after first
    use.  We purge the kiro_v2 subpackage cache before each instantiation so
    that uvicorn's file watcher triggers a real reload — otherwise code changes
    to browser.py / provider.py are invisible until the whole process restarts.
    """
    base_kwargs = _build_provider_kwargs(config)

    # ── Plugin package resolution (plan §3.3 decision 9) ──────────────
    # Try to resolve a plugin package for this service.  If found, run
    # registration through the plugin's data-only scenario.  If not found
    # or any error occurs, fall back to the built-in provider chain below.
    # A FRESH PluginLoader is created per call — this is the pinning
    # contract (plan §3.2 item 5): a package installed/removed mid-run
    # does not change the resolved version; the next run picks up the
    # change.
    try:
        from autoreg.plugin.loader import PluginLoader
        from autoreg.plugin.provider_adapter import PluginScenarioProvider

        loader = PluginLoader()
        pkg_dir = loader.resolve(provider_name)
        if pkg_dir is not None:
            logger.info(
                "Registration: using plugin package for %s from %s",
                provider_name, pkg_dir,
            )
            # v1.1: pass card/billing config fields so the plugin adapter
            # can seed config.* into the store for ${config.*} templating
            # (stripe.fill_checkout capability).  All optional — tolerate
            # absence (empty string when not configured).
            return PluginScenarioProvider(
                pkg_dir,
                loader=loader,
                **base_kwargs,
                card_number=config.get("card_number") or config.get("cardNumber"),
                card_expiry=config.get("card_expiry") or config.get("cardExpiry"),
                card_cvc=config.get("card_cvc") or config.get("cardCvc"),
                cardholder_name=config.get("cardholder_name")
                or config.get("cardholderName"),
                billing_country=config.get("billing_country")
                or config.get("billingCountry"),
                billing_address=config.get("billing_address")
                or config.get("billingAddress"),
                billing_city=config.get("billing_city") or config.get("billingCity"),
                billing_state=config.get("billing_state") or config.get("billingState"),
                billing_zip=config.get("billing_zip") or config.get("billingZip"),
                kiro_plan=config.get("kiro_plan") or config.get("kiroPlan"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Plugin resolution for %s failed, falling back to built-in: %s",
            provider_name, exc,
        )

    # No plugin package resolved — built-in providers are required from here.
    # In the open-core build (no autoreg/providers/), raise a clear runtime
    # error instead of letting the lazy imports below crash with ImportError.
    if not _autoreg_providers_available():
        raise RuntimeError(
            f"provider '{provider_name}' not available in this build "
            "(autoreg providers are not installed)."
        )

    # Purge built-in provider subpackage cache so uvicorn's file watcher
    # triggers a real reload.  Only reached when built-in providers are
    # available — skipped in the open-core build to avoid side-effecting
    # sys.modules when providers are absent.
    import sys as _sys

    _RELOAD_PREFIXES = (  # noqa: N806 — constant tuple
        "autoreg.providers.kiro_v2",
        "autoreg.providers.fireworks",
        "autoreg.providers.qoder",
        "autoreg.providers.windsurf",
        "autoreg.providers.trae",
        "autoreg.providers.openai",
        "autoreg.providers.github",
        "autoreg.providers.bitbucket",
        "autoreg.providers.v0_app",
    )
    for _key in list(_sys.modules):
        if any(_key == p or _key.startswith(p + ".") for p in _RELOAD_PREFIXES):
            del _sys.modules[_key]

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
        from autoreg.shared.logging_system import LogLevel, StructuredLogger
        debug = bool(config.get("debug") or config.get("debugMode"))
        level = LogLevel.DEBUG if debug else LogLevel.NORMAL
        struct_logger = StructuredLogger(account_id="kiro_v2", log_level=level)

        # Resolve card — explicit config fields take priority, then card pool
        card_number = config.get("card_number") or config.get("cardNumber")
        card_expiry = config.get("card_expiry") or config.get("cardExpiry")
        card_cvc = config.get("card_cvc") or config.get("cardCvc")
        cardholder_name = config.get("cardholder_name") or config.get("cardholderName")
        if not card_number:
            try:
                from autoreg.core.card_pool import get_card_pool
                card = get_card_pool().get_card(provider_name)
                if card:
                    card_number = card.number
                    card_cvc = card.cvv
                    # Normalise expiry → MM/YY
                    yr = card.exp_year[-2:] if len(card.exp_year) == 4 else card.exp_year
                    card_expiry = f"{card.exp_month}/{yr}"
                    logger.info("kiro_v2: using card from pool ****%s", card_number[-4:])
            except Exception as _card_exc:
                logger.debug("kiro_v2: card pool lookup failed: %s", _card_exc)

        return KiroV2Provider(
            **base_kwargs,
            logger_instance=struct_logger,
            speed_multiplier=float(config.get("speed_multiplier") or config.get("speedMultiplier") or 1.0),
            card_number=card_number,
            card_expiry=card_expiry,
            card_cvc=card_cvc,
            cardholder_name=cardholder_name,
            billing_country=config.get("billing_country") or config.get("billingCountry"),
            billing_address=config.get("billing_address") or config.get("billingAddress"),
            billing_city=config.get("billing_city") or config.get("billingCity"),
            billing_state=config.get("billing_state") or config.get("billingState"),
            billing_zip=config.get("billing_zip") or config.get("billingZip"),
            kiro_plan=config.get("kiro_plan") or config.get("kiroPlan") or "free",
            browser_engine=config.get("browser_engine")
            or config.get("browserEngine")
            or "cloakbrowser",
        )

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

    if provider_name == "v0_app":
        from autoreg.providers.v0_app.provider import V0AppProvider
        return V0AppProvider(
            **base_kwargs,
            proxy_enabled=bool(config.get("proxy_url")),
            proxy_url=config.get("proxy_url"),
            proxy_type=config.get("proxy_type", "http"),
            proxy_username=config.get("proxy_username"),
            proxy_password=config.get("proxy_password"),
            signup_url=config.get("signup_url"),
        )

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

    def __init__(self, callback: Callable[[str], None]) -> None:
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


def _install_log_bridge(callback: Callable[[str], None]) -> list[_LogBridgeHandler]:
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
    """Create a PipeTransport subclass that routes events through EventBus
    and receives control commands from ``registration_control`` API calls.

    In-process mode:
    - emit() → EventBus (WebSocket → frontend)
    - read_command() → in-memory queue populated by push_command()
    - push_command() → called by registration_control command handler
    """
    from autoreg.pipeline.transport import PipeTransport

    class EventBusTransport(PipeTransport):
        """PipeTransport backed by EventBus instead of stdin/stdout."""

        def emit(self, event: str, data: dict) -> None:
            # Skip stdout write (parent); emit to EventBus only
            event_bus.emit_sync(
                f"pipeline.{event}",
                {"jobId": job_id, "provider": provider_name, **data},
            )
            logger.debug("Emitted event: %s", event)

        def _ensure_reader(self) -> None:
            # No stdin reader — commands come via push_command()
            self._started = True

        def push_command(self, command: str, step_id=None, data=None) -> None:
            """Called by registration_control to inject a control command."""
            from autoreg.pipeline.transport import PipelineCommand
            cmd = PipelineCommand(
                command=command,
                step_id=step_id,
                data=data or {},
            )
            self._queue.append(cmd)

    transport = EventBusTransport()
    # Register transport in global registry so registration_control can push commands
    _ACTIVE_TRANSPORTS[job_id] = transport
    return transport


# Registry: job_id → EventBusTransport (so registration_control can push commands)
_ACTIVE_TRANSPORTS: dict[str, Any] = {}


def push_control_to_transport(job_id: str, command: str, step_id=None, data=None) -> bool:
    """Called by the registration_control command to forward resume/skip/abort."""
    t = _ACTIVE_TRANSPORTS.get(job_id)
    if t and hasattr(t, "push_command"):
        t.push_command(command, step_id=step_id, data=data)
        return True
    return False


def cleanup_transport(job_id: str) -> None:
    """Remove transport from registry when job completes."""
    _ACTIVE_TRANSPORTS.pop(job_id, None)


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
        """
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

        # Ensure DB schema is up to date before any session work.
        # When the Python backend starts normally this runs in lifespan(), but
        # when the server is offline or the job runs in a separate process the
        # lifespan never fires.  Running it here is idempotent (no-op if schema
        # is already current) and prevents silent OperationalError on old DBs
        # that are missing columns added after their creation (e.g. ref_code,
        # expires_at, registration_source, ...).
        try:
            from stitch_backend.database import create_all_tables as _migrate_db
            await _migrate_db()
        except Exception as _mig_exc:
            log_callback(f"[db] Schema migration warning: {_mig_exc!r}")

        # Install logging bridge: capture ALL logger.info() from autoreg/pipeline
        # and forward to the EventBus.  Without this, zero logs reach the frontend
        # because providers use ``logger.info()`` not ``self.log()``.
        bridge_handlers = _install_log_bridge(log_callback)

        provider = None
        _donor_id: str | None = None  # track donor for post-save increment
        try:
            # ── v0_app: auto-select proxy + referral donor ─────────────────
            if provider_name == "v0_app":
                from stitch_backend.database import run_in_session
                from stitch_backend.domains.registration.proxy_selector import ProxySelector
                from stitch_backend.domains.registration.referral_pool import ReferralPoolService

                # Auto-pick proxy ONLY when explicitly opted in via config flag.
                # Previously this ran whenever ``proxy_url`` was empty, which
                # silently applied a (possibly dead) proxy from the library to
                # every v0_app registration and caused ERR_EMPTY_RESPONSE in the
                # CloakBrowser. Now it is opt-in: registration goes direct unless
                # the caller enables rotation.
                auto_proxy_enabled = bool(
                    config.get("auto_proxy")
                    or config.get("autoProxy")
                    or config.get("proxy_rotation")
                    or config.get("proxyRotation")
                )
                if auto_proxy_enabled and not config.get("proxy_url"):
                    try:
                        async def _pick_proxy(session):
                            return await ProxySelector.next_proxy(session)
                        proxy_entry = await run_in_session(_pick_proxy)
                        if proxy_entry:
                            config = dict(config)  # copy — do not mutate caller's dict
                            config["proxy_url"] = ProxySelector.build_proxy_url(proxy_entry)
                            config["proxy_type"] = proxy_entry.get("proxy_type", "http")
                            config["proxy_username"] = proxy_entry.get("proxy_username")
                            config["proxy_password"] = proxy_entry.get("proxy_password")
                            # Visible in the registration console so a bad proxy
                            # is immediately obvious instead of a silent failure.
                            log_callback(
                                f"[proxy] Auto-rotation ON — using proxy "
                                f"{proxy_entry.get('proxy_url')}"
                            )
                            logger.info(
                                "Registration %s: auto-proxy %s",
                                job_id, proxy_entry.get("proxy_url"),
                            )
                        else:
                            log_callback(
                                "[proxy] Auto-rotation ON but no enabled proxy in "
                                "library — continuing with a direct connection"
                            )
                    except Exception as proxy_exc:
                        log_callback(
                            f"[proxy] Auto-select failed ({proxy_exc}) — "
                            f"continuing with a direct connection"
                        )
                        logger.warning(
                            "Registration %s: proxy auto-select failed (continuing without proxy): %s",
                            job_id, proxy_exc,
                        )
                elif config.get("proxy_url"):
                    log_callback(f"[proxy] Using configured proxy {config.get('proxy_url')}")

                # A custom referral link entered manually in the UI arrives as
                # camelCase ``signupUrl``. Normalize it to ``signup_url`` so the
                # block below treats it as an explicit override and skips donor
                # selection entirely.
                _custom_signup_url = (
                    config.get("signup_url")
                    or config.get("signupUrl")
                )
                if _custom_signup_url and not config.get("signup_url"):
                    config = dict(config)
                    config["signup_url"] = str(_custom_signup_url).strip()

                # Referral donor: manual selection (referred_by_id) takes
                # priority; otherwise auto-pick the oldest eligible donor.
                # Skipped entirely if the caller passed an explicit signup_url.
                if config.get("signup_url"):
                    log_callback(
                        f"[v0_app] Using custom referral link: {config.get('signup_url')}"
                    )
                if not config.get("signup_url"):
                    manual_donor_id = (
                        config.get("referred_by_id") or config.get("referredById")
                    )
                    try:
                        async def _pick_donor(session):
                            if manual_donor_id:
                                return await ReferralPoolService.get_donor_by_id(
                                    session, str(manual_donor_id)
                                )
                            return await ReferralPoolService.get_active_donor(session)
                        donor = await run_in_session(_pick_donor)
                        config = dict(config)
                        config["signup_url"] = ReferralPoolService.get_signup_url(donor)
                        if donor and donor.get("refUrl"):
                            _donor_id = donor.get("id")
                            logger.info(
                                "Registration %s: using %s referral donor id=%s url=%s",
                                job_id,
                                "manual" if manual_donor_id else "auto",
                                _donor_id,
                                config["signup_url"],
                            )
                        else:
                            logger.info(
                                "Registration %s: no usable donor — using seed URL %s",
                                job_id, config["signup_url"],
                            )
                    except Exception as donor_exc:
                        logger.warning(
                            "Registration %s: donor selection failed (using seed URL): %s",
                            job_id, donor_exc,
                        )

            # Build provider
            provider = _build_provider(provider_name, config)
            provider.set_log_callback(log_callback)

            # Create EventBus-backed transport so pipeline events (pause/resume/
            # step_waiting etc.) flow to the frontend over WebSocket.
            event_transport = _make_event_bus_transport(job_id, provider_name)

            # Load card pool if configured
            _load_cards(provider_name, config)

            # Emit start event
            await event_bus.emit("registration.progress", {
                "jobId": job_id,
                "step": "start",
                "message": f"Starting {provider_name} registration...",
            })

            # Run blocking provider.register() in a thread
            # Read outbound proxy from kiro-patch config (prevents IP leak
            # during token exchange HTTP requests inside the provider)
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

            # Emit completion event + persist account to DB
            # Debug visibility: show what the provider actually returned so a
            # missing/false `success` key (which silently skips the DB save)
            # is immediately obvious in the registration console.
            log_callback(
                f"[db] Provider result: success={result.get('success')!r} "
                f"email={result.get('email')!r} keys={sorted(result.keys())}"
            )
            if result.get("success"):
                # ── Persist account to the `accounts` table (UI source) ────
                account_id: str | None = None
                reg_email = result.get("email") or config.get("email") or ""
                try:
                    from stitch_backend.database import run_in_session
                    from stitch_backend.domains.accounts.service import AccountService

                    _donor_id_for_increment = _donor_id  # capture for closure

                    async def _save(session):
                        svc = AccountService(session)
                        account = await svc.add_registered_account(
                            provider=provider_name,
                            email=reg_email,
                            password=config.get("password"),
                            token=result.get("token"),
                            refresh_token=result.get("refresh_token")
                            or result.get("refreshToken"),
                            api_key=result.get("api_key") or result.get("apiKey"),
                            display_name=reg_email,
                            account_type=result.get("plan")
                            or result.get("accountType")
                            or "free",
                            ref_code=result.get("ref_code"),
                            ref_url=result.get("ref_url"),
                            referred_by_id=_donor_id_for_increment,
                        )
                        # Increment donor counter inside the same session
                        if _donor_id_for_increment is not None:
                            from stitch_backend.domains.registration.referral_pool import (
                                ReferralPoolService,
                            )
                            await ReferralPoolService.increment_donor(
                                session, _donor_id_for_increment
                            )
                        return account.id

                    account_id = await run_in_session(_save)
                    logger.info(
                        "Registration %s: account saved to DB id=%s email=%s",
                        job_id, account_id, reg_email,
                    )
                    log_callback(
                        f"[db] Account saved: id={account_id} email={reg_email}"
                    )

                    # Link TOTP key to the account if MFA was registered
                    totp_key_id = result.get("totp_key_id")
                    if totp_key_id and account_id:
                        try:
                            import sqlite3 as _sqlite3

                            from stitch_backend.config import get_settings as _get_settings
                            _db_path = _get_settings().database_url.split("///", 1)[-1]
                            with _sqlite3.connect(_db_path) as _conn:
                                _conn.execute(
                                    "UPDATE totp_keys SET account_id = ? WHERE id = ?",
                                    (str(account_id), totp_key_id),
                                )
                                _conn.commit()
                            log_callback(f"[db] TOTP key {totp_key_id} linked to account {account_id}")
                        except Exception as _totp_exc:
                            log_callback(f"[db] TOTP link failed (non-fatal): {_totp_exc}")

                    # Persist browser profile path + cookies so "Open browser"
                    # button restores the authenticated session instead of
                    # launching a blank profile.
                    _kiro_account = result.get("kiro_account") or {}
                    _profile_path = _kiro_account.get("browser_profile_path") or ""
                    _cookies = _kiro_account.get("cookies") or "[]"
                    _session_data = (_kiro_account.get("session_data")
                                     or result.get("session_data", {}).get("session_data")
                                     or "{}")
                    if _profile_path and account_id:
                        try:
                            import sqlite3 as _sqlite3

                            from stitch_backend.config import get_settings as _get_settings
                            _db_path = _get_settings().database_url.split("///", 1)[-1]
                            with _sqlite3.connect(_db_path) as _conn:
                                _conn.execute(
                                    "UPDATE accounts SET browser_profile_path=?, cookies=?, "
                                    "session_data=? WHERE id=?",
                                    (_profile_path, _cookies, _session_data, str(account_id)),
                                )
                                _conn.commit()
                            log_callback(
                                f"[db] Browser profile saved: {_profile_path}"
                            )
                        except Exception as _bp_exc:
                            log_callback(f"[db] Browser profile save failed (non-fatal): {_bp_exc}")

                    # Persist browser engine + shard profile id via ORM so the
                    # interactive "Open browser" relaunches the account with the
                    # same engine/fingerprint. ORM update works on both legacy
                    # Rust-created and ORM-created schemas.
                    _engine = _kiro_account.get("browser_engine") or "cloakbrowser"
                    _shard_id = _kiro_account.get("shard_profile_id")
                    if account_id:
                        try:
                            from stitch_backend.database import run_in_session
                            from stitch_backend.domains.accounts.models import Account

                            async def _set_engine(session):
                                acc = await session.get(Account, str(account_id))
                                if acc is not None:
                                    acc.browser_engine = _engine
                                    acc.shard_profile_id = _shard_id

                            await run_in_session(_set_engine)
                            log_callback(f"[db] Browser engine saved: {_engine}")
                        except Exception as _eng_exc:
                            log_callback(
                                f"[db] Browser engine save failed (non-fatal): {_eng_exc}"
                            )

                    # ── kiro_v2 also registers an AWS Builder ID ──────────
                    # Persist a companion aws_builder_id account so the AWS
                    # identity appears in the account list (parity with the
                    # legacy v1 behaviour). It reuses the SAME browser
                    # profile/cookies/engine as the kiro_v2 account — both
                    # sessions live in one profile — so "Open browser" on the
                    # AWS account restores the logged-in AWS session.
                    if provider_name == "kiro_v2":
                        try:
                            async def _save_aws(session):
                                svc = AccountService(session)
                                aws_acc = await svc.add_registered_account(
                                    provider="aws_builder_id",
                                    email=reg_email,
                                    password=config.get("password"),
                                    display_name=reg_email,
                                    account_type="free",
                                )
                                return aws_acc.id

                            aws_account_id = await run_in_session(_save_aws)
                            log_callback(
                                f"[db] AWS Builder ID account saved: "
                                f"id={aws_account_id} email={reg_email}"
                            )

                            # Attach the same browser session to the AWS account.
                            if _profile_path and aws_account_id:
                                try:
                                    import sqlite3 as _sqlite3

                                    from stitch_backend.config import get_settings as _get_settings
                                    _db_path = _get_settings().database_url.split("///", 1)[-1]
                                    with _sqlite3.connect(_db_path) as _conn:
                                        _conn.execute(
                                            "UPDATE accounts SET browser_profile_path=?, "
                                            "cookies=?, session_data=? WHERE id=?",
                                            (_profile_path, _cookies, _session_data,
                                             str(aws_account_id)),
                                        )
                                        _conn.commit()
                                except Exception as _aws_bp_exc:
                                    log_callback(
                                        f"[db] AWS browser profile save failed "
                                        f"(non-fatal): {_aws_bp_exc}"
                                    )

                            if aws_account_id:
                                try:
                                    from stitch_backend.domains.accounts.models import Account

                                    async def _set_aws_engine(session):
                                        acc = await session.get(Account, str(aws_account_id))
                                        if acc is not None:
                                            acc.browser_engine = _engine
                                            acc.shard_profile_id = _shard_id

                                    await run_in_session(_set_aws_engine)
                                except Exception as _aws_eng_exc:
                                    log_callback(
                                        f"[db] AWS browser engine save failed "
                                        f"(non-fatal): {_aws_eng_exc}"
                                    )
                        except Exception as _aws_exc:
                            log_callback(
                                f"[db] AWS account save failed (non-fatal): {_aws_exc}"
                            )
                except Exception as db_exc:
                    import traceback as _tb
                    logger.warning(
                        "Registration %s: DB account save failed (non-critical): %s",
                        job_id, db_exc,
                    )
                    # CRITICAL for debugging: without this the account silently
                    # never appears in the UI list. Show the real error + a
                    # trimmed traceback in the registration console.
                    log_callback(
                        f"[db] ACCOUNT SAVE FAILED — the account will NOT "
                        f"appear in the list! Error: {db_exc!r}"
                    )
                    for _line in _tb.format_exc().strip().splitlines()[-4:]:
                        log_callback(f"[db]   {_line}")

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

                # ── Pending failure report (plan §7 Phase 4) ──────────────
                # On plugin scenario failure with telemetry consent, build a
                # scrubbed bundle and store it as a pending report.  Never
                # raises — telemetry must not break a run.
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


def _load_cards(provider_name: str, config: dict) -> None:
    """Load card pool from config (cards_file, cards_text, card_bin)."""
    cards_file = config.get("cards_file") or config.get("cardsFile") or ""
    cards_text = config.get("cards_text") or config.get("cardsText") or ""
    card_bin = config.get("card_bin") or config.get("cardBin") or ""

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
