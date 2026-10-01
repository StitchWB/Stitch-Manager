"""Engine capability handlers for StepKind v2 (plan §4.3, §4.4).

Each capability is a pure function taking a step + dependencies and returning
a :class:`StepResult`.  Capabilities never touch the DB -- ``account.save``
only collects outputs from the store for the caller to persist.

Implementations live in the ``capabilities_<concern>.py`` modules; this module
keeps the import-time SPI registration and the public entry points.
"""

from __future__ import annotations

import logging
import time  # noqa: F401 — tests monkeypatch capabilities.time.sleep
from collections.abc import Callable
from typing import Any

from ..scenario.schema import ScenarioStep, SelectorCandidate
from ..stitch_backend_bridge import (
    get_database_path,
    register_builtin_spis,
    resolve_email_verification,
)
from . import capabilities_account as _account_impl
from . import capabilities_branch as _branch_impl
from . import capabilities_captcha as _captcha_impl
from . import capabilities_extract as _extract_impl
from . import capabilities_firebase as _firebase_impl
from . import capabilities_mail as _mail_impl
from . import capabilities_stripe as _stripe_impl
from . import capabilities_totp as _totp_impl
from .capabilities_account import _capture_session
from .capabilities_base import (
    _TEMPLATE_RE,
    ExecutorError,
    StepResult,
    build_selector,
    resolve_all_selectors,
    resolve_selector,
    resolve_template,
)
from .capabilities_captcha import (
    _CAPTCHA_SOLVERS,
    _resolve_aliyun_solver,
    _resolve_turnstile_solver,
    _solve_aliyun,
    _solve_im_human,
)
from .capabilities_extract import _cookie_value
from .capabilities_firebase import (
    _firebase_get_api_key,
    _firebase_login_direct,
    _firebase_login_worker,
)
from .capabilities_stripe import _fill_stripe_via_mixin
from .capabilities_totp import (
    _BASE32_RE,
    _extract_totp_secret_from_page,
    _generate_totp,
    _persist_totp_secret,
)

# Import-time SPI registration — enables resolve(SPI_EMAIL_VERIFICATION) before any bootstrap import.
register_builtin_spis()

logger = logging.getLogger(__name__)

__all__ = [
    "ExecutorError",
    "SelectorCandidate",
    "StepResult",
    "_BASE32_RE",
    "_CAPTCHA_SOLVERS",
    "_TEMPLATE_RE",
    "_capture_session",
    "_cookie_value",
    "_extract_totp_secret_from_page",
    "_fill_stripe_via_mixin",
    "_firebase_get_api_key",
    "_firebase_login_direct",
    "_firebase_login_worker",
    "_generate_totp",
    "_persist_totp_secret",
    "_resolve_aliyun_solver",
    "_resolve_turnstile_solver",
    "_solve_aliyun",
    "_solve_im_human",
    "_solve_turnstile",
    "account_save_capability",
    "branch_capability",
    "build_selector",
    "captcha_solve_capability",
    "extract_capability",
    "firebase_auth_capability",
    "get_database_path",
    "imap_otp_capability",
    "register_builtin_spis",
    "resolve_all_selectors",
    "resolve_email_verification",
    "resolve_selector",
    "resolve_template",
    "stripe_fill_checkout_capability",
    "totp_register_capability",
]


def extract_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    return _extract_impl.extract_capability(step, browser, store)


def branch_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    return _branch_impl.branch_capability(step, browser, store)


def imap_otp_capability(
    step: ScenarioStep,
    imap_config: dict[str, Any] | None,
    imap_factory: Callable[[dict[str, Any]], Any] | None,
    store: dict[str, Any],
) -> StepResult:
    return _mail_impl.imap_otp_capability(step, imap_config, imap_factory, store)


def captcha_solve_capability(step: ScenarioStep, browser: Any) -> StepResult:
    return _captcha_impl.captcha_solve_capability(step, browser)


def _solve_turnstile(browser: Any, step: ScenarioStep) -> bool:
    return _captcha_impl._solve_turnstile(
        browser, step, resolve_solver=_resolve_turnstile_solver
    )


def stripe_fill_checkout_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    return _stripe_impl.stripe_fill_checkout_capability(
        step, browser, store, fill_mixin=_fill_stripe_via_mixin
    )


def totp_register_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    return _totp_impl.totp_register_capability(step, browser, store)


def account_save_capability(
    step: ScenarioStep, store: dict[str, Any], browser: Any = None
) -> StepResult:
    return _account_impl.account_save_capability(step, store, browser)


def firebase_auth_capability(
    step: ScenarioStep, store: dict[str, Any], proxy: str | None = None
) -> StepResult:
    return _firebase_impl.firebase_auth_capability(
        step,
        store,
        proxy,
        login_direct=_firebase_login_direct,
        get_api_key=_firebase_get_api_key,
    )
