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

from .billing import _should_skip_billing, _strip_billing_steps
from .browser_lifecycle import (
    apply_spoofing,
    cleanup_profile_dir,
    close_browser,
    create_browser,
)
from .dependency_resolver import (
    DependencyResolutionError,
    ResolvedDependency,
    resolve_dependencies,
)
from .email_gen import generate_email
from .entry_files import (
    apply_local_override,
    apply_selector_overlay,
    load_entry_files,
)
from .event_executor import _EventEmittingExecutor
from .manifest import validate_manifest
from .results import build_failure_report, build_result, fail

if TYPE_CHECKING:
    from collections.abc import Callable

    from ..scenario.schema import ScenarioV2
    from .executor import ExecutorResult
    from .loader import PluginLoader
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
        # Kwarg-compat with _build_provider_kwargs; unused by scenario executor v1.
        email_strategy: str = "mailtm",
        base_email: str | None = None,
        addyio_config: Any = None,
        thirty_three_mail_config: dict[str, Any] | None = None,
        mailtm_inbox_config: dict[str, Any] | None = None,
        browser_factory: Callable[[], Any] | None = None,
        # Seeded as kiro_plan in store for var_equals plan-upgrade gating.
        kiro_plan: str | None = None,
        # v1.1: config.* fields for ${config.*} template resolution; all optional.
        card_number: str | None = None,
        card_expiry: str | None = None,
        card_cvc: str | None = None,
        cardholder_name: str | None = None,
        billing_country: str | None = None,
        billing_address: str | None = None,
        billing_city: str | None = None,
        billing_state: str | None = None,
        billing_zip: str | None = None,
        loader: PluginLoader | None = None,
        **_unused: Any,
    ) -> None:
        self._package_dir = Path(package_dir)
        self._headless = headless
        self._imap_config = imap_config
        self._browser_factory = browser_factory
        self._log_callback: Callable[[str], None] | None = None
        self._browser: Any | None = None
        self._email_strategy = email_strategy
        self._base_email = base_email
        self._addyio_config = addyio_config
        self._thirty_three_mail_config = thirty_three_mail_config
        self._mailtm_inbox_config = mailtm_inbox_config
        self._kiro_plan = kiro_plan or "free"
        # Per-run fresh user-data dir; None before launch / in tests; kept on success, cleaned on failure.
        self._profile_dir: str | None = None
        self._last_executor_result: ExecutorResult | None = None
        self._config_fields: dict[str, Any] = {
            "config.card_number": card_number,
            "config.card_expiry": card_expiry,
            "config.card_cvc": card_cvc,
            "config.cardholder_name": cardholder_name,
            "config.billing_country": billing_country,
            "config.billing_address": billing_address,
            "config.billing_city": billing_city,
            "config.billing_state": billing_state,
            "config.billing_zip": billing_zip,
        }

        # Read + validate manifest.
        manifest_path = self._package_dir / "plugin.json"
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self._manifest: PluginManifest = validate_manifest(raw_manifest)
        self._service = self._manifest.service

        # Pre-parse entry files; broken scenario raises for dispatch fallback, selectors/profile failures are warnings.
        self._scenario: ScenarioV2 | None = None
        self._profile: dict[str, Any] = {}
        self._selectors: dict[str, Any] = {}
        # v1.1: "override" if user-edited scenario loaded, else "package" — surfaced as scenario_source for provenance.
        self._scenario_source: str = "package"
        self._load_entry_files()

        self._dependencies: list[ResolvedDependency] = []
        self._dep_error: str | None = None
        self._failure_manifest: PluginManifest = self._manifest
        self._failure_scenario: ScenarioV2 | None = self._scenario
        if self._manifest.depends:
            self._resolve_dependencies(loader)

    def _load_entry_files(self) -> None:
        load_entry_files(self)

    def _apply_selector_overlay(self) -> None:
        apply_selector_overlay(self)

    def _apply_local_override(self) -> None:
        apply_local_override(self)

    # ── Duck-typed provider interface ───────────────────────────────────

    def _resolve_dependencies(self, loader: PluginLoader | None) -> None:
        """Resolve + pre-parse dependency scenarios.

        Stores the error string in ``self._dep_error`` if any dependency
        cannot be resolved or its scenario cannot be parsed.  The error is
        returned from ``register()`` before opening any browser — does NOT
        raise, so the dispatch layer does not fall back to built-in when
        the main package IS installed but a dep is missing.
        """
        if loader is None:
            self._dep_error = (
                "plugin declares dependencies but no loader was provided "
                "(cannot resolve dependencies)"
            )
            return
        try:
            self._dependencies = resolve_dependencies(self._manifest, loader)
        except DependencyResolutionError as exc:
            self._dep_error = str(exc)
        except Exception as exc:  # noqa: BLE001 — surface any resolution error
            self._dep_error = f"dependency resolution failed: {exc}"

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

        If the package declares dependencies, each dependency's scenario is
        executed IN ORDER before the main scenario.  All scenarios share
        ONE browser instance and ONE store so outputs from dep steps (e.g.
        ``account.email``) flow into main steps.

        Returns a dict compatible with built-in providers::
            {success, provider, email, password, name, session_data,
             error, token, refresh_token, api_key, ...}
        """
        transport = kwargs.get("transport")
        proxy: str | None = kwargs.get("proxy")

        if self._scenario is None:
            return self._fail(email, "plugin scenario not loaded")

        # Dependency resolution errors surface BEFORE opening any browser.
        if self._dep_error is not None:
            self.log(self._dep_error)
            return self._fail(email, self._dep_error)

        # Generate defaults for missing credentials here (built-in providers do this internally).
        if not email:
            email = self._generate_email()
            if not email:
                return self._fail(
                    None,
                    "no email provided and email generation via strategy "
                    f"'{self._email_strategy}' failed or is not configured",
                )
        if not password:
            from ..shared.password_utils import generate_secure_password

            password = generate_secure_password()
        if not name:
            if email:
                from ..shared.name_utils import generate_name_from_email

                name = generate_name_from_email(email)
            else:
                name = "User"

        # Create browser.
        try:
            browser = self._create_browser(proxy, email=email)
        except Exception as exc:
            self.log(f"browser launch failed: {exc}")
            self._cleanup_profile_dir()
            return self._fail(email, f"browser launch failed: {exc}")
        self._browser = browser

        # Seed store with credentials + config.* for ${account.*}/${config.*} template resolution.
        store: dict[str, Any] = {
            "account.email": email,
            "account.password": password,
            "account.name": name,
            # Plan-selection branch var (kiro-autoreg branch_plan_selection).
            "kiro_plan": self._kiro_plan,
        }
        # Name split for providers with separate first/last fields (windsurf).
        _name_parts = (name or "").split(None, 1)
        store["account.first_name"] = _name_parts[0] if _name_parts else ""
        store["account.last_name"] = _name_parts[1] if len(_name_parts) > 1 else ""
        # Tolerate absence: only seed non-None config values; absent keys resolve to empty string via resolve_template.
        store.update(
            {k: v for k, v in self._config_fields.items() if v is not None}
        )

        # Track whether the run reached account.save (terminal success) so finally decides profile dir cleanup.
        run_succeeded = False

        try:
            plan: list[tuple[PluginManifest, ScenarioV2]] = [
                (dep.manifest, dep.scenario) for dep in self._dependencies
            ]
            plan.append((self._manifest, self._scenario))

            # Billing skip: honor KIRO_SKIP_BILLING=1 (parity with built-in KIRO_V2_SKIP_BILLING).
            if _should_skip_billing(kwargs):
                plan = [(m, _strip_billing_steps(s)) for m, s in plan]
                self.log("billing disabled — stripe.fill_checkout skipped")

            result: ExecutorResult | None = None
            for manifest, scenario in plan:
                executor = _EventEmittingExecutor(
                    scenario,
                    browser,
                    store=store,
                    imap_config=self._imap_config,
                    transport=transport,
                    proxy=proxy,
                )
                self.log(
                    f"executing {len(scenario.steps)} steps "
                    f"from plugin package {manifest.id}@{manifest.version}"
                )
                result = executor.run()
                if not result.success:
                    # Stop on first failure; attribute to this package.
                    self._last_executor_result = result
                    self._failure_manifest = manifest
                    self._failure_scenario = scenario
                    return self._build_result(result, email, password, name)

            # All scenarios succeeded — the last result is the main scenario's.
            if result is not None:
                self._last_executor_result = result
                self._failure_manifest = self._manifest
                self._failure_scenario = self._scenario
                # account.save is terminal — success + completed means profile dir holds a real session worth keeping.
                run_succeeded = result.success and result.completed
                return self._build_result(result, email, password, name)

            # Empty plan guard — main scenario is always in the plan.
            return self._fail(email, "no scenario steps to execute")
        except Exception as exc:
            self.log(f"scenario execution failed: {exc}")
            return self._fail(email, str(exc))
        finally:
            self._close_browser(browser)
            self._browser = None
            if not run_succeeded:
                self._cleanup_profile_dir()

    def close(self) -> None:
        """Cleanup browser resources (matches BaseProvider.close)."""
        self._close_browser(self._browser)
        self._browser = None

    def _generate_email(self) -> str | None:
        return generate_email(self)

    def _create_browser(self, proxy: str | None = None, email: str | None = None) -> Any:
        return create_browser(self, proxy, email=email)

    def _apply_spoofing(self, page: Any, email: str | None) -> None:
        apply_spoofing(self, page, email)

    def _close_browser(self, browser: Any) -> None:
        close_browser(browser)

    def _cleanup_profile_dir(self) -> None:
        cleanup_profile_dir(self)

    def _build_result(
        self,
        result: ExecutorResult,
        email: str | None,
        password: str | None,
        name: str | None,
    ) -> dict[str, Any]:
        return build_result(self, result, email, password, name)

    def _fail(self, email: str | None, error: str) -> dict[str, Any]:
        return fail(self, email, error)

    def build_failure_report(self, *, consent: bool = False) -> dict[str, Any] | None:
        return build_failure_report(self, consent=consent)
