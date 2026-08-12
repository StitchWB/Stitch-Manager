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
import os
import shutil
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..scenario.parse_v2 import parse_scenario_v2
from ..scenario.schema import SelectorCandidate
from .dependency_resolver import (
    DependencyResolutionError,
    ResolvedDependency,
    resolve_dependencies,
)
from .executor import ScenarioExecutor
from .manifest import validate_manifest

if TYPE_CHECKING:
    from collections.abc import Callable

    from ..scenario.schema import ScenarioStep, ScenarioV2
    from .capabilities import StepResult
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
        # v1.1: registration config fields seeded into the store as
        # config.<name> so capabilities (e.g. stripe.fill_checkout) can
        # resolve ${config.*} templates.  All optional — tolerate absence.
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
        # Per-run fresh user-data dir (set by _create_browser).  None when
        # browser_factory is used (tests) or before browser launch.  Kept
        # on success for session reuse; cleaned up on failure (see
        # _cleanup_profile_dir).
        self._profile_dir: str | None = None
        self._last_executor_result: ExecutorResult | None = None
        # Registration config fields — seeded into the store as config.* by
        # register() so stripe.fill_checkout can resolve ${config.*}.
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

        # Pre-parse entry files.  A broken scenario raises so the dispatch
        # layer can catch it and fall back to built-in.  Selectors/profile
        # failures are non-fatal warnings.
        self._scenario: ScenarioV2 | None = None
        self._profile: dict[str, Any] = {}
        self._selectors: dict[str, Any] = {}
        # v1.1 LOCAL OVERRIDES (plan §8): "override" when a user-edited
        # override scenario is loaded, "package" otherwise.  Surfaced in
        # _build_result as ``scenario_source`` for provenance.
        self._scenario_source: str = "package"
        self._load_entry_files()

        # Resolve dependencies (plan §3.3 — depends chaining).  Pre-parse
        # dep scenarios in __init__ so errors surface before register()
        # opens any browser.  Unresolvable deps store an error string in
        # _dep_error; register() returns it as a failure before browser
        # launch (does NOT raise — the dispatch layer must not fall back to
        # built-in when the main package IS installed but a dep is missing).
        self._dependencies: list[ResolvedDependency] = []
        self._dep_error: str | None = None
        # Attribution: which package's step was executing when the run
        # ended (dep manifest on dep failure, main manifest otherwise).
        # Used by build_failure_report so the bundle's plugin_id/version
        # come from the package that actually failed.
        self._failure_manifest: PluginManifest = self._manifest
        self._failure_scenario: ScenarioV2 | None = self._scenario
        if self._manifest.depends:
            self._resolve_dependencies(loader)

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

        # v1.1 SELECTOR-PACK channel (plan §8): if a selectors_overlay.json
        # exists in the package dir (downloaded by sync, or placed manually
        # for plugins-local dev packages), merge it into the scenario.  For
        # each step id present in the overlay, REPLACE step.selector_candidates
        # with the overlay list.  Invalid overlay entries are skipped with a
        # warning; the scenario object is otherwise untouched.
        self._apply_selector_overlay()

        # v1.1 LOCAL OVERRIDES (plan §8): if a user-edited override
        # scenario exists at <data_dir>/overrides/<manifest.id>/scenario.json
        # AND parses → use it instead of the package scenario.  Parse
        # failure → warn + keep package scenario.  The override wins at
        # run time; provenance is tracked in _scenario_source.
        self._apply_local_override()

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

    def _apply_selector_overlay(self) -> None:
        """Merge ``selectors_overlay.json`` into the parsed scenario (plan §8).

        Overlay shape: ``{step_id: [{kind, value, weight?}, ...]}``.  For each
        step id present in the overlay, the scenario step's
        ``selector_candidates`` are REPLACED with the overlay list.  Steps
        absent from the overlay keep their inline candidates.  Invalid
        candidate entries (missing kind or value) are skipped with a warning;
        if a step's overlay list has zero valid candidates, that step's
        override is skipped entirely (inline candidates kept).

        Parse failure of the overlay file is non-fatal — the scenario is
        left with its inline candidates and a warning is logged.
        """
        if self._scenario is None:
            return
        overlay_path = self._package_dir / "selectors_overlay.json"
        if not overlay_path.is_file():
            return
        try:
            overlay_raw = json.loads(overlay_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning(
                "selectors_overlay.json unreadable in %s: %s",
                self._package_dir, exc,
            )
            return
        if not isinstance(overlay_raw, dict) or not overlay_raw:
            return

        from dataclasses import replace

        new_steps: list[ScenarioStep] = []
        for step in self._scenario.steps:
            override = overlay_raw.get(step.id)
            if not isinstance(override, list):
                new_steps.append(step)
                continue

            candidates: list[SelectorCandidate] = []
            for idx, item in enumerate(override):
                cand = _parse_overlay_candidate(item, step.id, idx)
                if cand is None:
                    continue
                candidates.append(cand)

            if not candidates:
                logger.warning(
                    "overlay for step %s has zero valid candidates — "
                    "keeping inline candidates",
                    step.id,
                )
                new_steps.append(step)
                continue

            new_steps.append(
                replace(step, selector_candidates=candidates)
            )

        self._scenario = replace(self._scenario, steps=new_steps)

    def _apply_local_override(self) -> None:
        """Apply a user-edited local override scenario (plan §8 v1.1).

        If ``<data_dir>/overrides/<manifest.id>/scenario.json`` exists AND
        parses → replace ``self._scenario`` with the override and mark
        provenance ``"override"``.  Parse failure → warn + keep package
        scenario (provenance stays ``"package"``).  No override file →
        no-op.
        """
        if self._scenario is None:
            return
        from .layout import _base_dir

        override_path = _base_dir() / "overrides" / self._manifest.id / "scenario.json"
        if not override_path.is_file():
            return
        try:
            override_raw = json.loads(override_path.read_text(encoding="utf-8"))
            override_scenario = parse_scenario_v2(override_raw)
        except (OSError, ValueError) as exc:
            logger.warning(
                "override scenario for %s unreadable at %s: %s — keeping package scenario",
                self._manifest.id, override_path, exc,
            )
            return
        self._scenario = override_scenario
        self._scenario_source = "override"
        logger.warning("override active for %s", self._manifest.id)

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

        # Generate defaults for missing credentials.  Built-in providers
        # do this internally; the plugin path has nobody to do it, so we
        # generate here before seeding the store.  Reuses the existing
        # generators in autoreg.shared (no new dependencies).
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
            browser = self._create_browser(proxy)
        except Exception as exc:
            self.log(f"browser launch failed: {exc}")
            self._cleanup_profile_dir()
            return self._fail(email, f"browser launch failed: {exc}")
        self._browser = browser

        # Seed store with credentials so scenario steps can reference them
        # via ${account.email} / ${account.password} / ${account.name}.
        # The same store dict is shared across all dep + main scenarios.
        # v1.1: also seed config.* from the registration config kwargs so
        # capabilities (e.g. stripe.fill_checkout) can resolve ${config.*}.
        store: dict[str, Any] = {
            "account.email": email,
            "account.password": password,
            "account.name": name,
        }
        # Tolerate absence: only seed non-None config values; absent keys
        # resolve to empty string via resolve_template.
        store.update(
            {k: v for k, v in self._config_fields.items() if v is not None}
        )

        # Track whether the run reached account.save (terminal success) so
        # the finally block can decide whether to keep or clean up the
        # per-run profile dir.  False on every path except a completed run.
        run_succeeded = False

        try:
            # Build the execution plan: dependencies in declared order,
            # then the main package's scenario.  Each entry is a
            # (manifest, scenario) pair so failure attribution can point
            # at the package whose step actually failed.
            plan: list[tuple[PluginManifest, ScenarioV2]] = [
                (dep.manifest, dep.scenario) for dep in self._dependencies
            ]
            plan.append((self._manifest, self._scenario))

            # Billing skip: honor KIRO_SKIP_BILLING=1 (parity with the
            # built-in KIRO_V2_SKIP_BILLING).  Remove stripe.fill_checkout
            # steps from all scenarios (deps + main) before execution.
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
                # account.save is terminal — success + completed means the
                # profile dir holds a real session worth keeping.
                run_succeeded = result.success and result.completed
                return self._build_result(result, email, password, name)

            # No steps to execute (empty plan — should not happen since the
            # main scenario is always in the plan, but guard anyway).
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

    # ── Internals ────────────────────────────────────────────────────────

    def _create_browser(self, proxy: str | None = None) -> Any:
        """Create a DrissionPage-style browser for the scenario executor.

        The executor duck-types the browser (``.get``, ``.ele``, ``.url``,
        ``.cookies``, ``.run_js``).  ``browser_factory`` kwarg allows tests
        to inject a mock without launching a real browser.

        A fresh user-data dir is created per run via ``tempfile.mkdtemp`` so
        cookies/sessions never leak between runs (run #9 regression: the
        default persistent profile inherited the previous run's AWS cookies
        and showed the password page for the wrong email).  The path is
        stored on ``self._profile_dir`` so ``_build_result`` can record it
        truthfully as ``browser_profile_path`` for the account's session
        reuse.  Cleanup: on failure (account.save not reached) the dir is
        removed to avoid temp-dir litter; on success it is kept for session
        reuse (OS temp cleanup handles it eventually).
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

        # Fresh per-run user-data dir — no cookie/session leakage between
        # runs.  Mirrors the established pattern in autoreg/browser/base.py
        # (_setup_chrome_options) and providers/openai/browser.py.
        profile_dir = tempfile.mkdtemp(prefix="stitch-plugin-profile-")
        self._profile_dir = profile_dir

        options = ChromiumOptions()
        options.set_user_data_path(profile_dir)
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

    def _cleanup_profile_dir(self) -> None:
        """Remove the per-run profile dir on failure (no session worth keeping).

        On success the dir is kept for session reuse (the account's
        ``browser_profile_path`` points at it).  On failure — browser
        launch error, scenario exception, or a failed step before
        ``account.save`` was reached — the dir is removed to avoid
        temp-dir litter.  OS temp cleanup is the final backstop.
        """
        if self._profile_dir is None:
            return
        shutil.rmtree(self._profile_dir, ignore_errors=True)
        self._profile_dir = None

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

        ``kiro_account.browser_profile_path`` records the per-run temp
        profile dir truthfully (the temp path IS the profile for this
        account) so the downstream service can persist it for session
        reuse — same shape as the built-in kiro_v2 provider's result.
        """
        outputs = result.outputs or {}
        session_data = outputs.get("account.session") or {}
        profile_path = self._profile_dir or ""
        return {
            "success": result.success,
            "provider": self._service,
            "email": outputs.get("account.email") or email or "",
            "password": outputs.get("account.password") or password or "",
            "name": name or "",
            "token": outputs.get("account.token"),
            "refresh_token": outputs.get("account.refresh_token"),
            "api_key": outputs.get("account.api_key"),
            "session_data": session_data,
            "kiro_account": {
                "email": outputs.get("account.email") or email or "",
                "browser_profile_path": profile_path,
                "cookies": session_data.get("cookies", "[]"),
                "session_data": session_data.get("session_data", "{}"),
            },
            "error": result.error,
            "steps_completed": result.steps_completed,
            "human_pause": result.human_pause,
            "human_pause_reason": result.human_pause_reason,
            "scenario_source": self._scenario_source,
        }

    def _fail(self, email: str | None, error: str) -> dict[str, Any]:
        """Build a failure result dict."""
        return {
            "success": False,
            "provider": self._service,
            "email": email or "",
            "error": error,
            "scenario_source": self._scenario_source,
        }

    def build_failure_report(self, *, consent: bool = False) -> dict[str, Any] | None:
        """Build a scrubbed failure-report bundle from the last executor run.

        Called by the backend's failure hook after ``register()`` returns a
        failed result.  Returns ``None`` when there is no executor result or
        when consent is off (mirrors :func:`build_report_bundle`).

        Attribution: the bundle's ``plugin_id`` / ``version`` / ``step``
        come from the package whose step actually failed — a dependency's
        manifest on dep failure, the main manifest on main failure.
        """
        if self._last_executor_result is None:
            return None
        scenario = self._failure_scenario or self._scenario
        if scenario is None:
            return None
        from .reporter import build_report_bundle

        manifest = self._failure_manifest or self._manifest
        return build_report_bundle(
            manifest.id,
            manifest.version,
            scenario,
            self._last_executor_result,
            artifacts=self._last_executor_result.artifacts or None,
            consent=consent,
        )


def _should_skip_billing(kwargs: dict[str, Any]) -> bool:
    """Check if billing should be skipped (env var or kwargs flag)."""
    return (
        os.environ.get("KIRO_SKIP_BILLING", "0") == "1"
        or os.environ.get("KIRO_V2_SKIP_BILLING", "0") == "1"
        or bool(kwargs.get("skipBilling") or kwargs.get("skip_billing"))
    )


def _parse_overlay_candidate(
    item: Any, step_id: str, idx: int
) -> SelectorCandidate | None:
    """Parse one overlay candidate entry into a SelectorCandidate.

    Returns None (and logs a warning) when the entry is missing ``kind``
    or ``value``.  Mirrors the tolerant parse in ``parse_v2`` but emits a
    warning instead of raising — an overlay with one bad entry should not
    abort the whole merge.
    """
    if not isinstance(item, dict):
        logger.warning(
            "overlay step %s: candidate[%d] not a dict — skipped",
            step_id, idx,
        )
        return None
    value = item.get("value")
    if not isinstance(value, str):
        logger.warning(
            "overlay step %s: candidate[%d] missing string 'value' — skipped",
            step_id, idx,
        )
        return None
    kind = item.get("kind", "css")
    if not isinstance(kind, str):
        logger.warning(
            "overlay step %s: candidate[%d] 'kind' not a string — skipped",
            step_id, idx,
        )
        return None
    weight = item.get("weight", 1.0)
    if not isinstance(weight, int | float) or isinstance(weight, bool):
        weight = 1.0
    return SelectorCandidate(kind=kind, value=value, weight=float(weight))


def _strip_billing_steps(scenario: ScenarioV2) -> ScenarioV2:
    """Remove stripe.fill_checkout steps from a scenario (billing skip)."""
    from dataclasses import replace

    filtered = [s for s in scenario.steps if s.kind != "stripe.fill_checkout"]
    if len(filtered) == len(scenario.steps):
        return scenario
    return replace(scenario, steps=filtered)


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
