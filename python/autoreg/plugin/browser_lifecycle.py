"""Browser lifecycle helpers for PluginScenarioProvider."""

from __future__ import annotations

import logging
import shutil
import tempfile
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .provider_adapter import PluginScenarioProvider

logger = logging.getLogger("autoreg.plugin.provider_adapter")


def create_browser(
    self: PluginScenarioProvider, proxy: str | None = None, email: str | None = None
) -> Any:
    """Create a DrissionPage-style browser for the scenario executor.

    The executor duck-types the browser (``.get``, ``.ele``, ``.url``,
    ``.cookies``, ``.run_js``).  ``browser_factory`` kwarg allows tests
    to inject a mock without launching a real browser.

    A fresh user-data dir is created per run via ``tempfile.mkdtemp`` —
    a persistent profile would leak cookies/sessions between runs.  The
    path is stored on ``self._profile_dir`` so ``_build_result`` records
    it truthfully as ``browser_profile_path``; on failure the dir is
    removed, on success it is kept for session reuse.
    """
    if self._browser_factory is not None:
        return self._browser_factory()
    # lazy import — DrissionPage is heavy and may be absent (e.g. CI without a display)
    try:
        from DrissionPage import ChromiumOptions, ChromiumPage
    except ImportError as exc:
        raise RuntimeError(
            "DrissionPage not available for plugin scenario execution"
        ) from exc

    # fresh per-run user-data dir — no cookie/session leakage between runs
    profile_dir = tempfile.mkdtemp(prefix="stitch-plugin-profile-")
    self._profile_dir = profile_dir

    options = ChromiumOptions()
    options.set_user_data_path(profile_dir)
    if self._headless:
        options.headless()
    if proxy:
        options.set_argument(f"--proxy-server={proxy}")
    page = ChromiumPage(options)
    return page


def close_browser(browser: Any) -> None:
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


def cleanup_profile_dir(self: PluginScenarioProvider) -> None:
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
