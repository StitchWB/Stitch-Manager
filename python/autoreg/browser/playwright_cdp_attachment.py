"""Playwright CDP attachment for CloakBrowser.

Connects REAL Playwright to an already-running CloakBrowser via its
``--remote-debugging-port`` and hands real Playwright Page/BrowserContext
objects to the scenario runners. This replaces the hand-rolled
DrissionPage-to-Playwright adapter (``async_cloakbrowser_wrapper``): console
events, expose_binding, persistent init scripts, multi-tab and tracing all
become native instead of reimplemented.

Design notes:
- The CloakBrowserProfileManager stays the LAUNCHER (binary, profile locks,
  proxy auth, extension). This module is the DRIVER: pages, environment
  overrides (timezone/headers/geolocation) and cookie injection go through
  Playwright's CDP session.
- ``connect_over_cdp`` can hang on tabs with stuck navigations (playwright#41093);
  the manager deliberately restores session tabs, so we probe every restored
  page and recover only the unresponsive ones.
- Do NOT pass ``no_defaults=True``: the runners live in the default context.
- CloakBrowser strips console CDP notifications at the binary level
  (Runtime.consoleAPICalled/Log.entryAdded never fire — verified via raw CDP).
  Driver-independent; the recorder's ``expose_binding`` channel works.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from playwright.async_api import async_playwright

from .cloakbrowser_profile_manager import CloakBrowserProfileManager

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT_MS = 30_000
_CONNECT_ATTEMPTS = 2
_PAGE_PROBE_TIMEOUT_S = 3.0
_PAGE_RECOVER_TIMEOUT_MS = 5_000


class PlaywrightCdpAttachment:
    """Async Playwright driver attached to a running CloakBrowser.

    Mirrors the outward surface the former AsyncCloakBrowserWrapper exposed to
    ProfileLauncher / open_browser / runners (``start``/``stop``/``get``/
    ``get_page``/``main_tab``/``chrome_proc``/``save_screenshot``/``_manager``),
    but ``page`` and ``page.context`` are real Playwright objects.
    """

    def __init__(self, manager: CloakBrowserProfileManager):
        self._manager = manager
        self._pw: Any | None = None
        self._browser: Any | None = None
        self._context: Any | None = None
        self._main_page: Any | None = None

    # ── Compat surface ────────────────────────────────────────────────

    @property
    def main_tab(self) -> Any | None:
        return self._main_page

    @property
    def chrome_proc(self):
        """Underlying Chrome subprocess (open_browser watchdog reads this)."""
        return getattr(self._manager, "_chrome_proc", None)

    @property
    def context(self) -> Any | None:
        return self._context

    async def __aenter__(self) -> PlaywrightCdpAttachment:
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()

    # ── Lifecycle ─────────────────────────────────────────────────────

    async def start(self) -> PlaywrightCdpAttachment:
        if self._main_page is not None:
            return self

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._manager.start)

        debug_port = getattr(self._manager, "_debug_port", None)
        if not debug_port:
            raise RuntimeError("CloakBrowser manager did not expose a debug port")

        endpoint = f"http://127.0.0.1:{debug_port}"
        self._pw = await async_playwright().start()
        try:
            await self._connect(endpoint)
            self._context = self._default_context()
            await self._recover_stuck_pages()
            self._main_page = await self._pick_main_page()
            await self._apply_env_overrides()
        except Exception:
            await self._teardown_playwright()
            raise

        logger.info(
            "Playwright attached to CloakBrowser at %s (%d page(s))",
            endpoint,
            len(self._context.pages),
        )
        return self

    async def stop(self) -> None:
        await self._teardown_playwright()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._manager.stop)

    # ── Page access ───────────────────────────────────────────────────

    async def get_page(self) -> Any:
        """Return the main page, re-picking if it was closed."""
        if self._context is None:
            await self.start()
        assert self._context is not None
        if self._main_page is None or self._main_page.is_closed():
            self._main_page = await self._pick_main_page()
        return self._main_page

    async def get(self, url: str, *, new_tab: bool = False, new_window: bool = False) -> Any:
        if new_window:
            logger.warning("new_window is not supported over CDP; using a tab instead")
        if new_tab:
            assert self._context is not None
            page = await self._context.new_page()
        else:
            page = await self.get_page()
        await page.goto(url)
        return page

    async def save_screenshot(self, path: str) -> None:
        page = await self.get_page()
        await page.screenshot(path=path)

    async def add_cookies(self, cookies: list[dict[str, Any]]) -> None:
        """Inject cookies — native context API with per-cookie CDP fallback."""
        assert self._context is not None
        normalized: list[dict[str, Any]] = []
        for c in cookies:
            cookie = dict(c)
            if "expires" in cookie:
                try:
                    exp = float(cookie["expires"])
                    if exp > 10_000_000_000:  # ms → s
                        exp = exp / 1000.0
                    cookie["expires"] = exp
                except Exception:
                    cookie.pop("expires", None)
            normalized.append(cookie)
        try:
            await self._context.add_cookies(normalized)
            return
        except Exception:
            logger.warning("context.add_cookies failed; retrying per-cookie via CDP", exc_info=True)
        page = await self.get_page()
        session = await self._context.new_cdp_session(page)
        for cookie in normalized:
            try:
                await session.send("Network.setCookie", cookie)
            except Exception as e:
                logger.debug("Cookie injection failed for %s: %s", cookie.get("name"), e)

    # ── Internals ─────────────────────────────────────────────────────

    async def _apply_env_overrides(self) -> None:
        """Apply timezone/headers/geolocation via the CDP session.

        Moved out of the manager (previously one-shot DrissionPage calls);
        these must match the proxy egress, which the browser engine cannot
        know about. Applied to the main page target, same as before.
        """
        mgr = self._manager
        if not (mgr.timezone_id or mgr.extra_http_headers or mgr.geolocation):
            return
        assert self._context is not None and self._main_page is not None
        session = await self._context.new_cdp_session(self._main_page)

        if mgr.timezone_id:
            try:
                await session.send("Emulation.setTimezoneOverride", {"timezoneId": mgr.timezone_id})
                logger.info("Timezone set: %s", mgr.timezone_id)
            except Exception as e:
                logger.warning("Timezone override failed: %s", e)

        if mgr.extra_http_headers:
            try:
                await session.send("Network.setExtraHTTPHeaders", {"headers": mgr.extra_http_headers})
                logger.info("Extra HTTP headers set: %s", list(mgr.extra_http_headers.keys()))
            except Exception as e:
                logger.warning("Extra headers failed: %s", e)

        geo = mgr.geolocation
        if isinstance(geo, dict):
            try:
                await session.send(
                    "Emulation.setGeolocationOverride",
                    {
                        "latitude": geo.get("latitude", 0),
                        "longitude": geo.get("longitude", 0),
                        "accuracy": geo.get("accuracy", 50),
                    },
                )
                logger.info("Geolocation set: %s", geo)
            except Exception as e:
                logger.warning("Geolocation override failed: %s", e)

    async def _connect(self, endpoint: str) -> None:
        assert self._pw is not None
        last_err: Exception | None = None
        for attempt in range(1, _CONNECT_ATTEMPTS + 1):
            try:
                self._browser = await self._pw.chromium.connect_over_cdp(
                    endpoint,
                    timeout=_CONNECT_TIMEOUT_MS,
                )
                return
            except Exception as e:
                last_err = e
                logger.warning("connect_over_cdp attempt %d/%d failed: %s", attempt, _CONNECT_ATTEMPTS, e)
        raise RuntimeError(f"Could not attach Playwright to CloakBrowser at {endpoint}: {last_err}")

    def _default_context(self) -> Any:
        assert self._browser is not None
        contexts = list(getattr(self._browser, "contexts", []) or [])
        if not contexts:
            raise RuntimeError("No default browser context on the CDP connection")
        return contexts[0]

    async def _recover_stuck_pages(self) -> None:
        """Recover tabs whose navigation is stuck (restored-session hang guard).

        Healthy restored tabs are left untouched; only unresponsive ones get
        navigated to about:blank so later evaluate/goto calls cannot wedge.
        """
        assert self._context is not None
        for page in list(self._context.pages):
            try:
                if page.is_closed():
                    continue
            except Exception:
                continue
            try:
                await asyncio.wait_for(
                    page.evaluate("1"),
                    timeout=_PAGE_PROBE_TIMEOUT_S,
                )
                continue  # healthy tab
            except Exception:
                pass
            logger.warning("Recovering unresponsive tab: %s", getattr(page, "url", "?"))
            try:
                await page.goto("about:blank", wait_until="commit", timeout=_PAGE_RECOVER_TIMEOUT_MS)
            except Exception as e:
                logger.warning("Tab recovery failed (continuing): %s", e)

    async def _pick_main_page(self) -> Any:
        assert self._context is not None
        pages = [p for p in self._context.pages if not p.is_closed()]
        if pages:
            page = pages[-1]
        else:
            page = await self._context.new_page()
        try:
            await page.bring_to_front()
        except Exception:
            pass
        return page

    async def _teardown_playwright(self) -> None:
        browser, self._browser = self._browser, None
        if browser is not None:
            try:
                # For CDP-attached browsers close() only disconnects; the
                # browser process itself is owned (and killed) by the manager.
                await browser.close()
            except Exception:
                pass
        pw, self._pw = self._pw, None
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass
        self._context = None
        self._main_page = None


__all__ = ["PlaywrightCdpAttachment"]
