"""Result-shape mapping and failure-report bundle for PluginScenarioProvider."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .executor import ExecutorResult
    from .provider_adapter import PluginScenarioProvider


def build_result(
    self: PluginScenarioProvider,
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
        # totp.register captures the TOTP secret; built-in providers return it as "totp_secret"
        "totp_secret": outputs.get("account.totp_ref"),
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


def fail(self: PluginScenarioProvider, email: str | None, error: str) -> dict[str, Any]:
    """Build a failure result dict."""
    return {
        "success": False,
        "provider": self._service,
        "email": email or "",
        "error": error,
        "scenario_source": self._scenario_source,
    }


def build_failure_report(
    self: PluginScenarioProvider, *, consent: bool = False
) -> dict[str, Any] | None:
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
