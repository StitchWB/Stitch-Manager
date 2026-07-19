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

    # Inject cookies into the Chrome profile BEFORE launching.
    # This is the only reliable method — CDP post-launch injection fails
    # because we can't know the CDP port of a freshly spawned browser.
    if cookies_json:
        _write_cookies_to_profile(cookies_json, profile)

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


def _write_cookies_to_profile(cookies_json: str, profile: Path) -> None:
    """Write cookies directly into the Chrome profile's SQLite Cookies database.

    This must be done BEFORE the browser launches.  Chrome encrypts cookies
    on Windows (DPAPI) starting with Chrome 80+ — we can only write *session*
    cookies (no encrypted value) reliably from outside Chrome.  For Kiro/AWS
    the session is maintained by HttpOnly session cookies which Chrome will
    rewrite on first use after we seed them, so this approach works for the
    "restore authenticated session" use-case.

    Falls back silently if the profile has no Cookies DB yet (first launch).
    """
    import sqlite3
    import time as _time

    try:
        cookies = json.loads(cookies_json)
        if not isinstance(cookies, list) or not cookies:
            return
    except (json.JSONDecodeError, TypeError):
        return

    # Chrome stores cookies in Default/Cookies (SQLite)
    default_dir = profile / "Default"
    default_dir.mkdir(parents=True, exist_ok=True)
    cookies_db = default_dir / "Cookies"

    try:
        with sqlite3.connect(str(cookies_db)) as conn:
            # Create table if this is a fresh profile with no Cookies file yet
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cookies (
                    creation_utc     INTEGER NOT NULL UNIQUE PRIMARY KEY,
                    host_key         TEXT NOT NULL,
                    top_frame_site_key TEXT NOT NULL DEFAULT '',
                    name             TEXT NOT NULL,
                    value            TEXT NOT NULL,
                    encrypted_value  BLOB DEFAULT '',
                    path             TEXT NOT NULL,
                    expires_utc      INTEGER NOT NULL,
                    is_secure        INTEGER NOT NULL,
                    is_httponly      INTEGER NOT NULL,
                    last_access_utc  INTEGER NOT NULL,
                    has_expires      INTEGER NOT NULL DEFAULT 1,
                    is_persistent    INTEGER NOT NULL DEFAULT 1,
                    priority         INTEGER NOT NULL DEFAULT 1,
                    samesite         INTEGER NOT NULL DEFAULT -1,
                    source_scheme    INTEGER NOT NULL DEFAULT 0,
                    source_port      INTEGER NOT NULL DEFAULT -1,
                    last_update_utc  INTEGER NOT NULL DEFAULT 0,
                    source_type      INTEGER NOT NULL DEFAULT 0,
                    has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0
                )
            """)

            # Chrome time = microseconds since 1601-01-01
            # Python time = seconds since 1970-01-01; offset = 11644473600s
            _CHROME_EPOCH_OFFSET = 11_644_473_600 * 1_000_000
            now_chrome = int(_time.time() * 1_000_000) + _CHROME_EPOCH_OFFSET

            inserted = 0
            for i, c in enumerate(cookies):
                if not isinstance(c, dict):
                    continue
                name = c.get("name", "")
                value = c.get("value", "")
                domain = c.get("domain", "")
                path_ = c.get("path", "/")
                secure = int(bool(c.get("secure", False)))
                http_only = int(bool(c.get("httpOnly", c.get("http_only", False))))
                expires_raw = c.get("expires", c.get("expirationDate", 0)) or 0
                if expires_raw and expires_raw > 1e10:
                    # Already in microseconds (Chrome format) — use as-is
                    expires_chrome = int(expires_raw)
                elif expires_raw:
                    # Unix seconds → Chrome microseconds
                    expires_chrome = int(expires_raw * 1_000_000) + _CHROME_EPOCH_OFFSET
                else:
                    # Session cookie
                    expires_chrome = 0

                # Unique creation time (must not collide)
                creation_utc = now_chrome + i

                try:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO cookies
                            (creation_utc, host_key, top_frame_site_key,
                             name, value, encrypted_value,
                             path, expires_utc, is_secure, is_httponly,
                             last_access_utc, has_expires, is_persistent,
                             priority, samesite, source_scheme, source_port,
                             last_update_utc, source_type, has_cross_site_ancestor)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            creation_utc, domain, "",
                            name, value, b"",
                            path_, expires_chrome, secure, http_only,
                            creation_utc,
                            1 if expires_chrome else 0,
                            1 if expires_chrome else 0,
                            1, -1, 0, -1,
                            creation_utc, 0, 0,
                        ),
                    )
                    inserted += 1
                except Exception:  # noqa: BLE001
                    pass  # Skip individual bad cookies

            conn.commit()
        logger.info("Wrote %d/%d cookies to profile %s", inserted, len(cookies), profile)
    except Exception as exc:
        logger.debug("Cookie write to profile failed (non-fatal): %s", exc)


async def _inject_cookies(proc: asyncio.subprocess.Process, cookies_json: str, profile: Path) -> None:
    """Legacy CDP cookie injection — kept for reference but no longer used.

    _write_cookies_to_profile() is called before launch instead.
    """
    # no-op: pre-launch injection now handles this
    pass


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
