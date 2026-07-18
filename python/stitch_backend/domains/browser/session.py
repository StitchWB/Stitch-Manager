"""Browser session manager — launch CloakBrowser/Chrome with a persistent profile.

Handles:
- Locating CloakBrowser (bundled or system Chrome fallback)
- Launching browser with --user-data-dir for profile persistence
- Cookie injection via CDP / DrissionPage (optional post-launch step)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ── CloakBrowser discovery ─────────────────────────────────────────────────

def _find_cloakbrowser() -> Path | None:
    """Return the path to CloakBrowser/Chrome executable, or None."""
    # 1. Env override (set by Tauri or scripts)
    env_path = os.environ.get("CLOAKBROWSER_BUNDLED_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p

    # 2. Bundled resources (Tauri production layout)
    system = platform.system()
    exe_name = "chrome.exe" if system == "Windows" else "chrome"
    candidates = [
        Path.cwd() / "resources" / "cloakbrowser" / exe_name,
        Path.cwd().parent / "resources" / "cloakbrowser" / exe_name,
    ]
    # Walk up up to 5 parents (handles dev vs. installed layout)
    current = Path.cwd()
    for _ in range(5):
        candidates.append(current / "resources" / "cloakbrowser" / exe_name)
        parent = current.parent
        if parent == current:
            break
        current = parent

    for c in candidates:
        if c.exists():
            return c

    # 3. System Chrome (last resort)
    if system == "Windows":
        for base_env in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
            base = os.environ.get(base_env)
            if base:
                sys_chrome = Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"
                if sys_chrome.exists():
                    return sys_chrome
    return None


# ── Profile helpers ────────────────────────────────────────────────────────

def _profile_dir_for_account(account_id: int, email: str = "") -> Path:
    """Return a stable profile directory for a given account."""
    home = Path.home() / ".stitch" / "profiles"
    # Use email-based slug if available, otherwise account_id
    if email:
        slug = email.replace("@", "_at_").replace(".", "_")
    else:
        slug = f"account_{account_id}"
    profile = home / slug
    profile.mkdir(parents=True, exist_ok=True)
    return profile


# ── Launch browser ─────────────────────────────────────────────────────────

_PROVIDER_URLS: dict[str, str] = {
    "kiro": "https://app.kiro.dev/home",
    "kiro_v2": "https://app.kiro.dev/home",
    "windsurf": "https://codeium.com/profile",
    "github": "https://github.com/settings/profile",
    "trae": "https://trae.sh/",
    "cursor": "https://cursor.sh/",
    "fireworks": "https://app.fireworks.ai/",
    "openai": "https://platform.openai.com/",
    "bitbucket": "https://bitbucket.org/",
}


@dataclass
class LaunchResult:
    """Result of a browser launch attempt."""
    success: bool
    profile_path: str = ""
    pid: int | None = None
    url: str = ""
    error: str | None = None


async def launch_account_browser(
    account_id: int,
    provider: str,
    email: str = "",
    profile_path: str | None = None,
    cookies_json: str | None = None,
    proxy_url: str | None = None,
    headless: bool = False,
    extra_url: str | None = None,
) -> LaunchResult:
    """Launch CloakBrowser (or Chrome) with a persistent profile for an account.

    The browser opens the provider's URL.  If *cookies_json* is provided it
    is injected via DrissionPage after launch (best-effort).
    """
    browser_exe = _find_cloakbrowser()
    if browser_exe is None:
        return LaunchResult(success=False, error="No CloakBrowser or Chrome found")

    profile = Path(profile_path) if profile_path else _profile_dir_for_account(account_id, email)

    url = extra_url or _PROVIDER_URLS.get(provider.lower(), "https://google.com")

    cmd = [
        str(browser_exe),
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
    ]
    if headless:
        cmd.append("--headless=new")
    if proxy_url:
        cmd.append(f"--proxy-server={proxy_url}")
    cmd.append(url)

    logger.info("Launching browser: %s  profile=%s", " ".join(cmd[:3]), profile)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        return LaunchResult(success=False, error=f"Failed to launch: {exc}")

    # Optional cookie injection (best-effort, non-blocking)
    if cookies_json:
        asyncio.create_task(_inject_cookies(proc, cookies_json, profile))

    return LaunchResult(
        success=True,
        profile_path=str(profile),
        pid=proc.pid,
        url=url,
    )


async def _inject_cookies(proc: asyncio.subprocess.Process, cookies_json: str, profile: Path) -> None:
    """Best-effort cookie injection via DrissionPage CDP.

    Waits a moment for the browser to start, then connects via CDP
    and sets cookies.  Silently ignores errors.
    """
    await asyncio.sleep(3)  # give the browser time to start

    try:
        from DrissionPage import ChromiumPage, ChromiumOptions

        co = ChromiumOptions()
        co.set_user_data_path(str(profile))
        co.set_local_port(9222)

        page = ChromiumPage(co)
        cookies = json.loads(cookies_json)
        if isinstance(cookies, list):
            for cookie in cookies:
                page.set.cookies(cookie)
        logger.info("Injected %d cookies via CDP", len(cookies) if isinstance(cookies, list) else 0)
    except Exception:
        logger.debug("Cookie injection skipped (DrissionPage not available or browser not ready)")


# ── Kill browser ───────────────────────────────────────────────────────────

async def kill_account_browser(pid: int | None = None) -> dict[str, Any]:
    """Kill a browser process by PID, or all Chrome/CloakBrowser processes."""
    killed = 0

    if pid:
        try:
            import psutil
            p = psutil.Process(pid)
            p.terminate()
            killed = 1
        except Exception:
            pass
    else:
        # Kill all chrome-like processes (broad — use with care)
        try:
            import psutil
            for p in psutil.process_iter(["name"]):
                name = (p.info.get("name") or "").lower()
                if "chrome" in name or "cloakbrowser" in name:
                    p.terminate()
                    killed += 1
        except ImportError:
            if platform.system() == "Windows":
                subprocess.run(
                    ["taskkill", "/F", "/IM", "chrome.exe"],
                    capture_output=True, text=True,
                )
                killed = 1

    return {"success": True, "killed": killed}
