"""Cookie loading for profile launches: Playwright cookie dicts or Netscape files."""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any


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
