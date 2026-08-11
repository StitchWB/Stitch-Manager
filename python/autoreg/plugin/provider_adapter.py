"""Plugin-backed provider adapter (plan §3.3 decision 9).

When a signed/installed plugin package exists for the requested provider
service, :class:`PluginScenarioProvider` runs the package's data-only scenario
via :class:`~autoreg.plugin.executor.ScenarioExecutor`.  The adapter is
duck-typed to match the built-in provider interface used by
``RegistrationService._build_provider`` — no inheritance from
``BaseProvider``/``CommonProvider`` (those live in Zone 2 and cannot be
imported at module level from Zone 1 without tripping the zone-boundary
leak-guard).

Graceful degradation: any failure to load/parse the plugin package is
caught at the dispatch layer (``_build_provider``), which falls back to
the built-in provider chain with a warning log.  A broken scenario file
raises from ``__init__`` so the dispatch can catch it and fall back;
selectors/profile failures are non-fatal warnings.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..scenario.parse_v2 import parse_scenario_v2
from .executor import ScenarioExecutor
from .manifest import validate_manifest

if TYPE_CHECKING:
    from collections.abc import Callable

    from ..scenario.schema import ScenarioStep, ScenarioV2
    from .capabilities import StepResult
    from .executor import ExecutorResult
    from .manifest import PluginManifest

logger = logging.getLogger(__name__)


class PluginScenarioProvider:
    """Provider adapter that runs a plugin package's data-only scenario.

    Duck-typed to match the built-in provider interface used by
    ``RegistrationService._build_provider`` / ``_run()``::

        provider.set_log_callback(callback)
        result = provider.register(
            email=..., password=..., name=...,
            transport=event_transport, proxy=outbound_proxy,
        )
        provider.close()

    Constructed with the package directory and the same base kwargs that
    built-in providers accept (``headless``, ``imap_config``, etc.).
    Unknown kwargs are silently absorbed (``**_unused``) so the adapter
    can be instantiated from the same ``base_kwargs`` dict as built-in
    providers without each provider's specific extras causing a
    ``TypeError``.
    """

    def __init__(
        self,
        package_dir: Path | str,
        *,
        headless: bool = True,
        imap_config: dict[str, Any] | None = None,
        # email_strategy / base_email / addyio_config / *_config are
        # accepted for kwarg-compatibility with _build_provider_kwargs
        # output; they are not used by the scenario executor in v1
        # (email is seeded into the store by register()).
        email_strategy: str = "mailtm",
        base_email: str | None = None,
        addyio_config: Any = None,
        thirty_three_mail_config: dict[str, Any] | None = None,
        mailtm_inbox_config: dict[str, Any] | None = None,
        browser_factory: Callable[[], Any] | None = None,
        **_unused: Any,
    ) -> None:
        self._package_dir = Path(package_dir)
        self._headless = headless
        self._imap_config = imap_config
        self._browser_factory = browser_factory
        self._log_callback: Callable[[str], None] | None = None
        self._browser: Any | None = None

        # Read + validate manifest.
        manifest_path = self._package_dir / "plugin.json"
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self._manifest: PluginManifest = validate_manifest(raw_manifest)
        self._service = self._manifest.service

        # Pre-parse entry files.  A broken scenario raises so the dispatch
        # layer can catch it and fall back to built-in.  Selectors/profile
        # failures are non-fatal warnings.
        self._scenario: ScenarioV2 | None = None
        self._profile: dict[str, Any] = {}
        self._selectors: dict[str, Any] = {}
        self._load_entry_files()

    # ── Entry-file loading ───────────────────────────────────────────────

    def _load_entry_files(self) -> None:
        """Read scenario / selectors / profile from the package dir.

        Scenario parse failures propagate (so the dispatch can fall back
        to built-in).  Selectors/profile failures are non-fatal warnings.
        """
        entry = self._manifest.entry

        # Scenario — required for data plugins; parse failure propagates
        # so the dispatch layer can fall back to built-in (graceful
        # degradation, plan §3.3 decision 9).
        scenario_rel = entry.get("scenario", "scenario.json")
        scenario_path = self._package_dir / scenario_rel
        scenario_raw = json.loads(scenario_path.read_text(encoding="utf-8"))
        self._scenario = parse_scenario_v2(scenario_raw)

        # Selectors (v1.1 selector-pack channel — read + validated, not
        # the primary selector source in v1; scenario has inline candidates).
        selectors_rel = entry.get("selectors", "selectors.json")
        selectors_path = self._package_dir / selectors_rel
        if selectors_path.is_file():
            try:
                self._selectors = json.loads(
                    selectors_path.read_text(encoding="utf-8")
                )
            except (OSError, ValueError):
                logger.warning(
                    "selectors.json unreadable in %s", self._package_dir
                )

        # Profile (spoofer persona hints — read for future use, not
        # applied in v1).
        profile_rel = entry.get("profile", "profile.json")
        profile_path = self._package_dir / profile_rel
        if profile_path.is_file():
            try:
                self._profile = json.loads(
                    profile_path.read_text(encoding="utf-8")
                )
            except (OSError, ValueError):
                logger.warning(
                    "profile.json unreadable in %s", self._package_dir
                )

    # ── Duck-typed provider interface ───────────────────────────────────

    def set_log_callback(self, callback: Callable[[str], None]) -> None:
        """Store a log callback (matches CommonProvider.set_log_callback)."""
        self._log_callback = callback

    def log(self, message: str) -> None:
        """Log with provider prefix (matches BaseProvider.log pattern)."""
        prefixed = f"[{self._service.upper()}] {message}"
        print(prefixed, flush=True)
        if self._log_callback is not None:
            self._log_callback(prefixed)

    def register(
        self,
        email: str | None = None,
        password: str | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute the plugin scenario and return a result dict.

        Returns a dict compatible with built-in providers::
            {success, provider, email, password, name, session_data,
             error, token, refresh_token, api_key, ...}
        """
        transport = kwargs.get("transport")
        proxy: str | None = kwargs.get("proxy")

        if self._scenario is None:
            return self._fail(email, "plugin scenario not loaded")

        # Create browser.
        try:
            browser = self._create_browser(proxy)
        except Exception as exc:
            self.log(f"browser launch failed: {exc}")
            return self._fail(email, f"browser launch failed: {exc}")
        self._browser = browser

        # Seed store with credentials so scenario steps can reference them
        # via ${account.email} / ${account.password} / ${account.name}.
        store: dict[str, Any] = {
            "account.email": email,
            "account.password": password,
            "account.name": name,
        }

        try:
            executor = _EventEmittingExecutor(
                self._scenario,
                browser,
                store=store,
                imap_config=self._imap_config,
                transport=transport,
            )
            self.log(
                f"executing {len(self._scenario.steps)} steps "
                f"from plugin package {self._manifest.id}@{self._manifest.version}"
            )
            result: ExecutorResult = executor.run()
            return self._build_result(result, email, password, name)
        except Exception as exc:
            self.log(f"scenario execution failed: {exc}")
            return self._fail(email, str(exc))
        finally:
            self._close_browser(browser)
            self._browser = None

    def close(self) -> None:
        """Cleanup browser resources (matches BaseProvider.close)."""
        self._close_browser(self._browser)
        self._browser = None

    # ── Internals ────────────────────────────────────────────────────────

    def _create_browser(self, proxy: str | None = None) -> Any:
        """Create a DrissionPage-style browser for the scenario executor.

        The executor duck-types the browser (``.get``, ``.ele``, ``.url``,
        ``.cookies``, ``.run_js``).  ``browser_factory`` kwarg allows tests
        to inject a mock without launching a real browser.
        """
        if self._browser_factory is not None:
            return self._browser_factory()
        # Lazy import — DrissionPage is a heavy dependency and may not be
        # available in all environments (e.g. CI without a display).
        try:
            from DrissionPage import ChromiumOptions, ChromiumPage
        except ImportError as exc:
            raise RuntimeError(
                "DrissionPage not available for plugin scenario execution"
            ) from exc

        options = ChromiumOptions()
        if self._headless:
            options.headless()
        if proxy:
            options.set_argument(f"--proxy-server={proxy}")
        return ChromiumPage(options)

    def _close_browser(self, browser: Any) -> None:
        """Close a browser instance, trying quit() then close()."""
        if browser is None:
            return
        for method_name in ("quit", "close"):
            fn = getattr(browser, method_name, None)
            if fn is not None:
                try:
                    fn()
                except Exception:
                    pass
                break

    def _build_result(
        self,
        result: ExecutorResult,
        email: str | None,
        password: str | None,
        name: str | None,
    ) -> dict[str, Any]:
        """Map ExecutorResult + outputs to the built-in provider result shape.

        The ``account.save`` capability collects declared outputs from the
        store (e.g. ``account.email``, ``account.session``).  These are
        mapped to the keys the downstream ``RegistrationService._run()``
        reads via ``result.get(...)``.
        """
        outputs = result.outputs or {}
        return {
            "success": result.success,
            "provider": self._service,
            "email": outputs.get("account.email") or email or "",
            "password": outputs.get("account.password") or password or "",
            "name": name or "",
            "token": outputs.get("account.token"),
            "refresh_token": outputs.get("account.refresh_token"),
            "api_key": outputs.get("account.api_key"),
            "session_data": outputs.get("account.session") or {},
            "error": result.error,
            "steps_completed": result.steps_completed,
            "human_pause": result.human_pause,
            "human_pause_reason": result.human_pause_reason,
        }

    def _fail(self, email: str | None, error: str) -> dict[str, Any]:
        """Build a failure result dict."""
        return {
            "success": False,
            "provider": self._service,
            "email": email or "",
            "error": error,
        }


class _EventEmittingExecutor(ScenarioExecutor):
    """ScenarioExecutor subclass that emits step events via transport.

    Events: ``step_started``, ``step_completed``, ``step_failed`` — matching
    the event names built-in providers use through ``PipeTransport``.
    Transport failures are silently swallowed so they never crash the
    scenario execution.
    """

    def __init__(
        self,
        scenario: ScenarioV2,
        browser: Any,
        *,
        store: dict[str, Any] | None = None,
        imap_config: dict[str, Any] | None = None,
        transport: Any = None,
    ) -> None:
        super().__init__(
            scenario, browser, store=store, imap_config=imap_config
        )
        self._transport = transport

    def _dispatch(self, step: ScenarioStep) -> StepResult:
        if self._transport is not None:
            try:
                self._transport.emit("step_started", {
                    "step_id": step.id,
                    "kind": step.kind,
                })
            except Exception:
                pass
        result = super()._dispatch(step)
        if self._transport is not None:
            try:
                if result.success and not result.skipped:
                    self._transport.emit("step_completed", {
                        "step_id": step.id,
                        "kind": step.kind,
                        "matched_candidate": result.matched_candidate,
                    })
                elif not result.success:
                    self._transport.emit("step_failed", {
                        "step_id": step.id,
                        "kind": step.kind,
                        "error": result.error,
                    })
            except Exception:
                pass
        return result
