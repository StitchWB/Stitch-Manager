"""Async façade over a ShardX (ShardBrowser) engine session.

The shardx SDK spawns the patched Chromium engine (engine-level spoofing)
with a remote-debugging port; we attach a synchronous DrissionPage
``ChromiumPage`` to that CDP endpoint and expose the async, Playwright-like
surface ``ProfileLauncher`` / the ``open_browser`` worker expect:

- ``start()`` / ``stop()``
- ``get_page()``  → async façade (goto/url/is_closed)
- ``add_cookies(cookies)``
- ``chrome_proc`` → the engine ``subprocess.Popen`` (poll()/pid) for the
  worker liveness watchdog

NOTE: patchright (stealth Playwright) turned out to be unreliable against
this engine in windowed mode (CDP connection drops on the first call), so we
deliberately use raw CDP via DrissionPage instead — it works headless and
windowed alike.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


def build_shard_sdk() -> Any:
    """Create a ready-to-use ``shardx.ShardX`` instance.

    The SDK scans the bundled fingerprint library in ``__init__``, but the
    library itself is downloaded by ``runtime.install()`` on first use.  On a
    fresh machine the first instance therefore sees an empty library and
    ``create_profile()`` raises "No bundled profiles".  Install first, then
    rebuild the facade so the library re-scans the populated cache.
    """
    import sys

    import shardx

    # The SDK prints "→" glyphs unconditionally; on cp1251 (Russian Windows)
    # consoles this raises UnicodeEncodeError mid-launch.  Make streams safe.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:  # noqa: BLE001 — non-TextIOWrapper streams
            pass

    sdk = shardx.ShardX()
    try:
        sdk.runtime.install()
    except Exception as exc:  # noqa: BLE001
        logger.warning("shardx runtime install failed: %s", exc)
    return shardx.ShardX()


def _pick_template_config(sdk: Any, platform: str) -> dict:
    """UTF-8-safe fingerprint template pick.

    shardx's ``Profile.from_file`` reads JSON with the *locale* default
    encoding, which crashes on cp1251 (Russian Windows) because the bundled
    fingerprints contain UTF-8 bytes (GPU/renderer strings).  The SDK then
    silently skips every profile and reports an empty library.  Load manually.
    """
    import json as _json
    import random as _random

    fp_dir = sdk.runtime.fingerprints_dir
    candidates: list[dict] = []
    for path in sorted(fp_dir.glob("*.json")):
        try:
            cfg = _json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        plat = ((cfg.get("navigator") or {}).get("platform") or "")
        if platform and platform.lower() not in str(plat).lower():
            continue
        candidates.append(cfg)
    if not candidates:
        raise RuntimeError(f"No bundled ShardX fingerprints for platform={platform}")
    return _random.choice(candidates)


def create_shard_profile(sdk: Any, platform: str = "Windows") -> Any:
    """Create a persistent profile, bypassing the SDK's locale-dependent JSON read."""
    try:
        return sdk.create_profile(platform=platform)
    except RuntimeError:
        logger.info(
            "ShardBrowser: SDK library unreadable under locale encoding — "
            "loading fingerprint templates as UTF-8"
        )

    import uuid as _uuid

    from shardx import Profile
    from shardx.randomize import randomize_hardware, randomize_platform_version

    cfg = _pick_template_config(sdk, platform)
    pid = _uuid.uuid4().hex
    # Same enrichment the SDK applies in create_profile()
    randomize_hardware(cfg, profile_id=pid)
    randomize_platform_version(cfg)
    profile = Profile(cfg, id=pid)
    sdk.save_profile(profile)
    return profile


class _SyncPageFacade:
    """Async, Playwright-like façade over the synchronous DrissionPage page."""

    def __init__(self, page: Any) -> None:
        self._page = page
        self._closed = False

    @property
    def url(self) -> str:
        try:
            return self._page.url or ""
        except Exception:  # noqa: BLE001
            return ""

    def is_closed(self) -> bool:
        return self._closed

    async def goto(self, url: str, *, wait_until: str = "load", timeout: float | None = None) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._page.get(url))

    async def close(self) -> None:
        self._closed = True


class AsyncShardBrowserWrapper:
    """Async façade over a ShardX engine session driven via DrissionPage/CDP."""

    def __init__(
        self,
        *,
        shard_profile_id: str | None = None,
        proxy: str | None = None,
        headless: bool = False,
        platform: str = "Windows",
    ) -> None:
        self._shard_profile_id = shard_profile_id
        self._proxy = proxy
        self._headless = headless
        self._platform = platform

        self._sdk: Any = None
        self._sess: Any = None          # shardx BrowserSession (owns engine Popen)
        self._page: Any = None          # DrissionPage ChromiumPage
        self._facade: _SyncPageFacade | None = None

    @property
    def shard_profile_id(self) -> str | None:
        return self._shard_profile_id

    @property
    def chrome_proc(self) -> Any:
        """The engine subprocess (Popen) — poll()/pid for the worker watchdog."""
        return getattr(self._sess, "process", None)

    async def start(self) -> AsyncShardBrowserWrapper:
        from urllib.parse import urlparse

        from DrissionPage import ChromiumOptions, ChromiumPage

        try:
            import shardx  # noqa: F401
        except ImportError:
            raise RuntimeError(
                "ShardBrowser engine requires the 'shardx' package. "
                "Install it with:  pip install shardx"
            ) from None

        self._sdk = build_shard_sdk()
        sdk = self._sdk

        profile = None
        if self._shard_profile_id:
            try:
                profile = sdk.open_profile(self._shard_profile_id)
                logger.info("ShardBrowser: reusing saved profile %s", self._shard_profile_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ShardBrowser: saved profile %s not found (%s), creating new one",
                    self._shard_profile_id,
                    exc,
                )
        if profile is None:
            profile = create_shard_profile(sdk, self._platform)
            logger.info(
                "ShardBrowser: created new %s profile id=%s",
                self._platform,
                getattr(profile, "id", "?"),
            )
        self._shard_profile_id = getattr(profile, "id", self._shard_profile_id)

        # Spawn the engine with a CDP endpoint (synchronous, no event loop).
        sess = sdk.launch(
            profile,
            proxy=self._proxy,
            headless=self._headless,
            cdp=True,
        )
        if not sess.cdp_url:
            sess.stop()
            raise RuntimeError("ShardBrowser engine failed to expose a CDP endpoint")

        address = urlparse(sess.cdp_url).netloc
        try:
            options = ChromiumOptions()
            options.set_address(address)
            options.set_argument('--disable-infobars')
            options.set_argument('--no-first-run')
            options.set_argument('--no-default-browser-check')
            options.set_argument('--disable-logging')
            options.set_argument('--log-level=3')
            page = ChromiumPage(addr_or_opts=options)
        except Exception:
            # Never leave the engine process orphaned on attach failure.
            sess.stop()
            raise
        self._sess = sess
        self._page = page
        self._facade = _SyncPageFacade(page)

        logger.info(
            "ShardBrowser session started (profile_id=%s, proxy=%s, headless=%s, cdp=%s)",
            self._shard_profile_id,
            self._proxy or "none",
            self._headless,
            address,
        )
        return self

    async def get_page(self) -> _SyncPageFacade:
        """Return the async façade over the live DrissionPage page."""
        if self._facade is None:
            await self.start()
        assert self._facade is not None
        return self._facade

    async def add_cookies(self, cookies: list[dict[str, Any]]) -> None:
        if not cookies:
            return
        if self._page is None:
            await self.start()
        assert self._page is not None
        loop = asyncio.get_event_loop()

        def _inject() -> int:
            ok = 0
            for c in cookies:
                if not isinstance(c, dict):
                    continue
                try:
                    self._page.set.cookies(c)
                    ok += 1
                except Exception:  # noqa: BLE001
                    pass
            return ok

        try:
            ok = await loop.run_in_executor(None, _inject)
            logger.info("ShardBrowser: injected %d/%d cookies", ok, len(cookies))
        except Exception as exc:  # noqa: BLE001
            logger.warning("ShardBrowser: cookie injection failed (non-fatal): %s", exc)

    async def stop(self) -> None:
        sess, self._sess = self._sess, None
        page, self._page = self._page, None
        if self._facade is not None:
            self._facade._closed = True
            self._facade = None
        try:
            if sess is not None:
                sess.stop()  # terminates the engine process
            if page is not None:
                try:
                    page.quit()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("ShardBrowser close error: %s", exc)
        logger.info("ShardBrowser session stopped")

    async def __aenter__(self) -> AsyncShardBrowserWrapper:
        return await self.start()

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()
