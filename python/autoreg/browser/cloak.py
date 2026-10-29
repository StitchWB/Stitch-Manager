"""CloakBrowser launch handle (Zone-1 provider kit).

Generalized from the provider-local cloak handles (abliteration, moda):
launches the hub's anti-detect Chromium (resources/cloakbrowser) as a
subprocess, waits for CDP, and connects DrissionPage. ``page`` is the
connected tab; ``close()`` tears the process tree down and removes the
profile directory. No provider-specific logic — providers pass their own
``profile_prefix`` and drive ``handle.page``.
"""

from __future__ import annotations

import http.client
import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable
from typing import Any

from .chrome_process_utils import kill_chrome_for_profile

try:
    from .cloakbrowser_finder import find_cloakbrowser
except ImportError:  # open-core: CloakBrowser kit is a closed module
    find_cloakbrowser = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CREATION_FLAGS = 0x8 | 0x200 if platform.system() == "Windows" else 0


class CloakBrowserHandle:
    """Owns the CloakBrowser process lifecycle; ``page`` is the DrissionPage tab."""

    def __init__(
        self,
        headless: bool = False,
        proxy: str | None = None,
        *,
        profile_prefix: str = "cloak",
        page_factory: Callable[[str], Any] | None = None,
    ) -> None:
        self._temp_profile = os.path.join(
            tempfile.gettempdir(), f"{profile_prefix}_{uuid.uuid4().hex[:8]}"
        )
        os.makedirs(self._temp_profile, exist_ok=True)

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        debug_port = sock.getsockname()[1]
        sock.close()

        if find_cloakbrowser is None:
            raise RuntimeError("CloakBrowser kit is unavailable in this build")

        cmd = [
            find_cloakbrowser(strict=True),
            f"--user-data-dir={self._temp_profile}",
            f"--remote-debugging-port={debug_port}",
            "--profile-directory=Default",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "about:blank",
        ]
        if headless:
            cmd.extend(["--headless", "--disable-gpu"])
        if proxy:
            # Chrome --proxy-server rejects credentials; strip them (fireworks base pattern).
            cleaned = re.sub(r"^(\w+://)[^@]+@", r"\1", proxy)
            cmd.append(f"--proxy-server={cleaned}")
            if cleaned != proxy:
                logger.warning(
                    "proxy credentials are not supported by --proxy-server; stripped"
                )
        else:
            cmd.append("--no-proxy-server")

        self._proc = subprocess.Popen(
            cmd,
            creationflags=_CREATION_FLAGS,
            close_fds=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._wait_cdp(debug_port)
        if page_factory is not None:
            self.page = page_factory(f"127.0.0.1:{debug_port}")
        else:
            from DrissionPage import ChromiumPage

            self.page = ChromiumPage(f"127.0.0.1:{debug_port}")
        try:
            self.page.set.timeouts(page_load=30, script=20)
        except Exception:  # noqa: BLE001 - advisory page tuning
            pass

    def _wait_cdp(self, port: int) -> None:
        deadline = time.time() + 30.0
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError("CloakBrowser exited during startup")
            try:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                conn.request("GET", "/json/version")
                resp = conn.getresponse()
                data = json.loads(resp.read().decode("utf-8")) if resp.status == 200 else {}
                conn.close()
                if data.get("webSocketDebuggerUrl"):
                    return
            except Exception:  # noqa: BLE001 - CDP not up yet
                pass
            time.sleep(0.5)
        raise RuntimeError(f"CloakBrowser CDP connection failed after 30s (port {port})")

    def close(self) -> None:
        try:
            if self.page is not None:
                self.page.quit(timeout=3)
        except Exception:  # noqa: BLE001 - best-effort teardown
            try:
                self.page.quit()
            except Exception:  # noqa: BLE001
                pass
        if self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                self._proc.kill()
        kill_chrome_for_profile(self._temp_profile)
        if os.path.exists(self._temp_profile):
            shutil.rmtree(self._temp_profile, ignore_errors=True)

    def __enter__(self) -> CloakBrowserHandle:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


__all__ = ["CloakBrowserHandle"]
