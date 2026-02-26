"""ProfileLauncher - persistent Camoufox profile launcher.

Goals (explicitly safe/stability-only):
- Persistent profile dirs (user_data_dir)
- Proxy parsing + normalization + health-check (fail fast)
- Locale / timezone / Accept-Language defaults (configurable)
- Auto timezone/geolocation resolution via IP-geo lookup when set to "Auto"
- Cookie injection (Playwright cookie list preferred; Netscape cookie file supported)
- File lock on profile dir to prevent concurrent launches

Non-goals (explicitly NOT implemented):
- Any stealth/fingerprint spoofing (canvas/webgl/audio/webrtc/mac/etc.)
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, cast

from ..core.paths import get_paths
from .firefox_profile_manager import FirefoxProfileManager


if TYPE_CHECKING:  # pragma: no cover
    from playwright.async_api import BrowserContext, Page


WaitUntil = Literal["commit", "domcontentloaded", "load", "networkidle"]


DEFAULT_LOCALE = "en-US"
DEFAULT_TIMEZONE_ID = "America/New_York"
DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9"


@dataclass(frozen=True)
class ProxySpec:
    scheme: str  # http|https|socks5
    host: str
    port: int
    username: str | None = None
    password: str | None = None

    def to_url(self, *, include_auth: bool = True) -> str:
        auth = ""
        if include_auth and self.username:
            password = self.password or ""
            auth = f"{self.username}:{password}@"
        return f"{self.scheme}://{auth}{self.host}:{self.port}"


def _is_auto(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() == "auto"


def _safe_stderr(msg: str) -> None:
    try:
        sys.stderr.write(msg.rstrip() + os.linesep)
        sys.stderr.flush()
    except Exception:
        pass


def _sanitize_profile_id(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (raw or "")).strip("._-")
    return cleaned or "default"


def _parse_proxy_any(proxy: Any) -> ProxySpec | None:
    """Parse common proxy formats into a normalized ProxySpec.

    Accepted formats:
    - None / "" -> None
    - "http://user:pass@host:port" (or https/socks5)
    - "host:port" (defaults to http)
    - "user:pass@host:port" (defaults to http)
    - "host:port:user:pass" (defaults to http)
    - dict: {"type": "http", "host": "1.2.3.4", "port": 8080, "username": "u", "password": "p"}
    """

    if proxy is None:
        return None

    if isinstance(proxy, dict):
        scheme = str(proxy.get("type") or proxy.get("scheme") or "http").strip().lower()
        host = str(proxy.get("host") or "").strip()
        port = proxy.get("port")
        username = proxy.get("username") or proxy.get("user")
        password = proxy.get("password") or proxy.get("pass")
        if not host or port is None:
            raise ValueError(f"Invalid proxy dict (expected host+port): {proxy}")
        try:
            port_i = int(port)
        except Exception as e:
            raise ValueError(f"Invalid proxy port: {port}") from e
        return ProxySpec(
            scheme=scheme, host=host, port=port_i, username=username, password=password
        )

    if not isinstance(proxy, str):
        raise ValueError(f"Invalid proxy type: {type(proxy).__name__}")

    value = proxy.strip()
    if not value:
        return None

    # host:port:user:pass
    hpup = re.match(r"^(?P<host>[^:]+):(?P<port>\d+):(?P<user>[^:]+):(?P<password>.+)$", value)
    if hpup:
        return ProxySpec(
            scheme="http",
            host=hpup.group("host"),
            port=int(hpup.group("port")),
            username=hpup.group("user"),
            password=hpup.group("password"),
        )

    # Ensure scheme is present for consistent parsing.
    if "://" not in value:
        value = f"http://{value}"

    # scheme://[user:pass@]host:port
    match = re.match(
        r"^(?P<scheme>https?|socks5)://(?:(?P<user>[^:@/]+):(?P<password>[^@/]+)@)?(?P<host>[^:/]+):(?P<port>\d+)$",
        value,
        re.IGNORECASE,
    )
    if not match:
        raise ValueError(
            "Invalid proxy format. Expected type://user:pass@host:port or host:port (optional auth). "
            f"Got: {proxy}"
        )

    scheme = match.group("scheme").lower()
    host = match.group("host")
    port = int(match.group("port"))
    user = match.group("user")
    password = match.group("password")
    return ProxySpec(scheme=scheme, host=host, port=port, username=user, password=password)


def _looks_like_json(text: str) -> bool:
    stripped = text.lstrip()
    return stripped.startswith("[") or stripped.startswith("{")


def _parse_netscape_cookie_lines(lines: Iterable[str]) -> list[dict[str, Any]]:
    """Parse Netscape cookies.txt format into Playwright cookie dicts."""

    cookies: list[dict[str, Any]] = []
    for raw in lines:
        line = raw.strip("\n")
        if not line or line.startswith("#") and not line.startswith("#HttpOnly_"):
            continue

        http_only = False
        if line.startswith("#HttpOnly_"):
            http_only = True
            line = line[len("#HttpOnly_") :]

        parts = line.split("\t")
        if len(parts) != 7:
            # Not a valid Netscape cookie row.
            continue

        domain, _include_subdomains, path, secure, expires, name, value = parts
        cookie: dict[str, Any] = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": path or "/",
            "secure": secure.upper() == "TRUE",
            "httpOnly": http_only,
        }
        try:
            exp_i = int(float(expires))
            if exp_i > 0:
                cookie["expires"] = exp_i
        except Exception:
            pass

        cookies.append(cookie)
    return cookies


def _normalize_playwright_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for c in cookies:
        if not isinstance(c, dict):
            continue

        cookie = dict(c)

        # Chrome export compatibility.
        if "expires" not in cookie and "expirationDate" in cookie:
            try:
                cookie["expires"] = float(cookie["expirationDate"])
            except Exception:
                pass

        # Sometimes expires is in ms.
        if "expires" in cookie:
            try:
                exp = float(cookie["expires"])
                if exp > 10_000_000_000:  # ~2286 in seconds
                    exp = exp / 1000.0
                cookie["expires"] = exp
            except Exception:
                cookie.pop("expires", None)

        normalized.append(cookie)

    return normalized


def _load_cookies_from_config(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Load cookies from config.

    Supported:
    - cookies: [ {PlaywrightCookie}, ... ]
    - cookies_file / cookie_file: path to Playwright JSON or Netscape cookies.txt
    - cookies: "path/to/file" (string)
    """

    cookies_value = config.get("cookies")
    cookies_file = config.get("cookies_file") or config.get("cookie_file")

    if isinstance(cookies_value, list):
        return _normalize_playwright_cookies([c for c in cookies_value if isinstance(c, dict)])

    if isinstance(cookies_value, str) and cookies_value.strip():
        cookies_file = cookies_value.strip()

    if not cookies_file:
        return []

    cookie_path = Path(cookies_file)
    if not cookie_path.is_absolute():
        # Interpret relative to project working dir.
        cookie_path = Path.cwd() / cookie_path
    if not cookie_path.exists():
        raise FileNotFoundError(f"Cookie file does not exist: {cookie_path}")

    text = cookie_path.read_text(encoding="utf-8", errors="replace")
    if _looks_like_json(text):
        payload = json.loads(text)
        if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
            return _normalize_playwright_cookies(payload["cookies"])
        if isinstance(payload, list):
            return _normalize_playwright_cookies([c for c in payload if isinstance(c, dict)])
        raise ValueError("Unsupported cookies JSON format (expected list or {cookies: [...]})")

    return _parse_netscape_cookie_lines(text.splitlines())


async def _fetch_json_with_optional_proxy(
    url: str,
    *,
    proxy: ProxySpec | None,
    timeout_s: float,
) -> dict[str, Any]:
    """Fetch JSON with optional http/https/socks5 proxy."""

    try:
        import aiohttp
    except Exception as e:  # pragma: no cover
        raise RuntimeError("aiohttp is required for proxy checks and geo lookup") from e

    timeout = aiohttp.ClientTimeout(total=timeout_s)

    if proxy and proxy.scheme.startswith("socks"):
        try:
            from aiohttp_socks import ProxyConnector
        except Exception as e:  # pragma: no cover
            raise RuntimeError("aiohttp-socks is required for socks proxies") from e

        connector = ProxyConnector.from_url(proxy.to_url(include_auth=True))
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            async with session.get(url, headers={"Accept": "application/json"}) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise RuntimeError(f"HTTP {resp.status} from {url}: {data}")
                if not isinstance(data, dict):
                    raise RuntimeError(f"Unexpected response from {url}: {type(data).__name__}")
                return data

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            url,
            headers={"Accept": "application/json"},
            proxy=(proxy.to_url(include_auth=True) if proxy else None),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 400:
                raise RuntimeError(f"HTTP {resp.status} from {url}: {data}")
            if not isinstance(data, dict):
                raise RuntimeError(f"Unexpected response from {url}: {type(data).__name__}")
            return data


def _redact_proxy_for_logs(proxy: ProxySpec) -> str:
    if proxy.username:
        return f"{proxy.scheme}://{proxy.username}:***@{proxy.host}:{proxy.port}"
    return f"{proxy.scheme}://{proxy.host}:{proxy.port}"


async def _proxy_health_check(proxy: ProxySpec, *, timeout_s: float = 8.0) -> None:
    """Fail-fast proxy check by performing a simple JSON request."""

    # NOTE: use a stable endpoint with very small payload.
    endpoints = [
        "https://api.ipify.org?format=json",
        "https://httpbin.org/ip",
    ]

    last_error: Exception | None = None
    for url in endpoints:
        try:
            data = await _fetch_json_with_optional_proxy(url, proxy=proxy, timeout_s=timeout_s)
            # ipify -> {"ip": "x.x.x.x"}, httpbin -> {"origin": "..."}
            if "ip" in data or "origin" in data:
                return
            # Still fine; request succeeded.
            return
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(
        "Proxy health-check failed. "
        f"Proxy: {_redact_proxy_for_logs(proxy)}. "
        f"Last error: {type(last_error).__name__}: {last_error}"
    )


async def _resolve_geo_and_timezone(
    *,
    proxy: ProxySpec | None,
    timeout_s: float = 5.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve geolocation + timezone from IP.

    Returns:
        (geolocation_dict_for_playwright, timezone_id)
    """

    providers = [
        ("https://ipwho.is/", "ipwho"),
        ("https://ipapi.co/json/", "ipapi"),
    ]

    last_error: Exception | None = None
    for url, provider in providers:
        try:
            data = await _fetch_json_with_optional_proxy(url, proxy=proxy, timeout_s=timeout_s)

            if provider == "ipwho":
                if data.get("success") is False:
                    raise RuntimeError(str(data.get("message") or "geo lookup failed"))
                lat = data.get("latitude")
                lon = data.get("longitude")
                tz = (
                    (data.get("timezone") or {}).get("id")
                    if isinstance(data.get("timezone"), dict)
                    else None
                )
            else:
                lat = data.get("latitude")
                lon = data.get("longitude")
                tz = data.get("timezone")

            geolocation: dict[str, Any] | None = None
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                geolocation = {"latitude": float(lat), "longitude": float(lon), "accuracy": 50}
            timezone_id = str(tz) if isinstance(tz, str) and tz.strip() else None
            return geolocation, timezone_id

        except Exception as e:
            last_error = e
            continue

    _safe_stderr(
        "[ProfileLauncher] Auto geo/timezone lookup failed; using defaults. "
        f"Last error: {type(last_error).__name__}: {last_error}"
    )
    return None, None


class ProfileLauncher:
    """Launches/opens a persistent Camoufox profile with safety utilities."""

    def __init__(
        self,
        *,
        profile_id: str,
        profiles_root: str | Path | None = None,
        headless: bool = False,
        proxy: Any = None,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.profile_id = _sanitize_profile_id(profile_id)
        self.profiles_root = (
            Path(profiles_root) if profiles_root is not None else get_paths().browser_profiles_dir
        )
        self.profile_path = self.profiles_root / self.profile_id
        self.headless = headless

        self._config: dict[str, Any] = config or {}
        self._proxy = _parse_proxy_any(proxy if proxy is not None else self._config.get("proxy"))
        self._manager: FirefoxProfileManager | None = None
        self._lock = None

    async def __aenter__(self) -> ProfileLauncher:
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    def _lock_path(self) -> Path:
        return self.profile_path / ".profile.lock"

    def _acquire_profile_lock(self) -> None:
        try:
            from filelock import FileLock, Timeout
        except Exception as e:  # pragma: no cover
            raise RuntimeError("filelock is required for profile locking") from e

        self.profile_path.mkdir(parents=True, exist_ok=True)
        lock = FileLock(str(self._lock_path()))
        try:
            lock.acquire(timeout=0)
        except Timeout as e:
            raise RuntimeError(
                f"Profile '{self.profile_id}' is already locked (in use). Path: {self.profile_path}"
            ) from e
        self._lock = lock

    def _release_profile_lock(self) -> None:
        lock = self._lock
        self._lock = None
        if lock is None:
            return
        try:
            lock.release()
        except Exception:
            pass

    def _effective_locale(self) -> str:
        locale = self._config.get("locale") or self._config.get("browser_locale")
        return str(locale).strip() if isinstance(locale, str) and locale.strip() else DEFAULT_LOCALE

    def _effective_timezone(self) -> str | None:
        tz = self._config.get("timezone_id")
        if tz is None:
            tz = self._config.get("timezone")
        if _is_auto(tz):
            return "Auto"
        if isinstance(tz, str) and tz.strip():
            return tz.strip()
        return None

    def _effective_geolocation(self) -> Any:
        geo = self._config.get("geolocation")
        if _is_auto(geo):
            return "Auto"
        return geo

    def _effective_extra_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        raw = self._config.get("extra_http_headers") or self._config.get("headers") or {}
        if isinstance(raw, dict):
            for k, v in raw.items():
                if isinstance(k, str) and isinstance(v, (str, int, float)):
                    headers[k] = str(v)

        # Enforce Accept-Language default if not provided.
        if not any(k.lower() == "accept-language" for k in headers.keys()):
            headers["Accept-Language"] = (
                self._config.get("accept_language") or DEFAULT_ACCEPT_LANGUAGE
            )
        return headers

    async def start(self) -> BrowserContext:
        if self._manager is not None:
            return await self._manager.start()

        # Lock first to prevent concurrent profile use.
        self._acquire_profile_lock()

        try:
            if self._proxy is not None:
                await _proxy_health_check(self._proxy)

            locale = self._effective_locale()
            timezone_id = self._effective_timezone()
            geolocation = self._effective_geolocation()
            extra_headers = self._effective_extra_headers()

            # Auto-resolve if requested.
            if timezone_id == "Auto" or geolocation == "Auto":
                resolved_geo, resolved_tz = await _resolve_geo_and_timezone(proxy=self._proxy)
                if timezone_id == "Auto":
                    timezone_id = resolved_tz or DEFAULT_TIMEZONE_ID
                if geolocation == "Auto":
                    geolocation = resolved_geo

            # Enforce timezone default if not provided.
            if not timezone_id:
                timezone_id = DEFAULT_TIMEZONE_ID

            launch_kwargs: dict[str, Any] = {
                # Keep options within safe Playwright/Camoufox surface.
                "locale": locale,
                "timezone_id": timezone_id,
                "extra_http_headers": extra_headers,
            }

            if (
                isinstance(geolocation, dict)
                and "latitude" in geolocation
                and "longitude" in geolocation
            ):
                launch_kwargs["geolocation"] = geolocation
                # Permissions can also be granted later per-origin; this keeps it explicit.
                launch_kwargs["permissions"] = ["geolocation"]

            # Allow callers to pass additional safe kwargs.
            raw_launch_kwargs = self._config.get("launch_kwargs")
            if isinstance(raw_launch_kwargs, dict):
                # Avoid overriding our enforced defaults unless explicitly requested.
                launch_kwargs.update(raw_launch_kwargs)

            proxy_url = self._proxy.to_url(include_auth=True) if self._proxy else None

            manager = FirefoxProfileManager(
                profile_id=self.profile_id,
                profiles_root=self.profiles_root,
                headless=self.headless,
                proxy_url=proxy_url,
                launch_kwargs=launch_kwargs,
            )

            context = await manager.start()
            self._manager = manager

            # Cookie injection (best-effort). Do before navigation.
            cookies = _load_cookies_from_config(self._config)
            if cookies:
                # Playwright expects a cookie parameter sequence; keep runtime flexible.
                await cast(Any, context).add_cookies(cookies)

            return context
        except Exception:
            # If start fails, release lock.
            self._release_profile_lock()
            self._manager = None
            raise

    async def open(self, url: str, *, wait_until: WaitUntil = "domcontentloaded") -> Page:
        if not url:
            raise ValueError("url is required")
        if self._manager is None:
            await self.start()
        assert self._manager is not None

        page = await self._manager.get_page()
        await page.goto(url, wait_until=cast(WaitUntil, wait_until))
        return page

    async def close(self) -> None:
        manager = self._manager
        self._manager = None
        try:
            if manager is not None:
                await manager.stop()
        finally:
            self._release_profile_lock()
