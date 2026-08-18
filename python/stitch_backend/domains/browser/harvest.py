"""Web-session harvester — browser-based cookie capture for web2api providers.

Replaces manual DevTools copy-paste for web-session providers (``web-gemini``,
``web-deepseek``, ...): the account's persistent browser is launched with a
known CDP port at the provider's login page; after the user logs in, cookies
are read back through CDP ``Network.getAllCookies`` (decrypted by the browser
itself — no DPAPI handling needed), serialized into the cookie-jar string the
adapters consume, and stored on the account row.

Flow (two commands, user-confirm in between):
  1. ``open_web_login_browser``  — launch browser, remember CDP port in
     ``session_data`` (``state: harvest_in_progress``).
  2. ``capture_web_session_cookies`` — pull cookies via CDP, validate the
     required set, persist jar + profile-reseed JSON, mark account active.

The JSON cookie list (for :func:`browser.session._write_cookies_to_profile`
re-seeding) is kept in ``session_data["cookiesJson"]``; the ``cookies`` column
holds the jar string consumed by the adapters.
"""

from __future__ import annotations

import json
import logging
import socket
from typing import Any

from sqlalchemy import select, update

from stitch_backend.database import run_in_session

logger = logging.getLogger(__name__)

# Per-provider harvest configuration. ``cookie_domains`` are suffix-matched
# against the cookie domain; ``required_cookies`` must all be present for the
# capture to count as a successful login.
WEB_SESSION_HARVEST_CONFIG: dict[str, dict[str, Any]] = {
    "web-gemini": {
        "login_url": "https://gemini.google.com/app",
        "cookie_domains": ("google.com",),
        "required_cookies": ("SID", "HSID", "SSID", "SAPISID", "__Secure-1PSID"),
    },
    "web-deepseek": {
        "login_url": "https://chat.deepseek.com",
        "cookie_domains": ("deepseek.com",),
        # DeepSeek auth lives in the Bearer token; cookies alone are kept for
        # WAF session continuity. No required-cookie gate.
        "required_cookies": (),
    },
}


def pick_free_port() -> int:
    """Reserve a free localhost TCP port for the CDP endpoint."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def filter_provider_cookies(
    cookies: list[dict[str, Any]], domains: tuple[str, ...]
) -> list[dict[str, Any]]:
    """Keep cookies whose domain suffix-matches one of ``domains``."""
    out: list[dict[str, Any]] = []
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        domain = str(cookie.get("domain", "")).lstrip(".")
        if any(domain == d or domain.endswith("." + d) for d in domains):
            out.append(cookie)
    return out


def build_cookie_jar(cookies: list[dict[str, Any]]) -> str:
    """Serialize cookies into the ``"name=value; name2=value2"`` jar string."""
    parts: list[str] = []
    seen: set[str] = set()
    for cookie in cookies:
        name = str(cookie.get("name", ""))
        if not name or name in seen:
            continue
        seen.add(name)
        parts.append(f"{name}={cookie.get('value', '')}")
    return "; ".join(parts)


def missing_required_cookies(
    cookies: list[dict[str, Any]], required: tuple[str, ...]
) -> list[str]:
    names = {str(c.get("name", "")) for c in cookies if isinstance(c, dict)}
    return [r for r in required if r not in names]


# ─── CDP access (injectable for tests) ───────────────────────────────────────


async def cdp_get_all_cookies(port: int) -> list[dict[str, Any]]:
    """Fetch every cookie from the running browser via CDP.

    Uses ``/json/version`` for the browser websocket URL, then
    ``Network.getAllCookies``. Raises on connection errors so the caller can
    surface "browser not running / not ready".
    """
    import httpx
    import websockets

    async with httpx.AsyncClient(timeout=5) as client:
        version = await client.get(f"http://127.0.0.1:{port}/json/version")
        version.raise_for_status()
        ws_url = version.json()["webSocketDebuggerUrl"]

    async with websockets.connect(ws_url, max_size=8 * 1024 * 1024) as ws:
        await ws.send(
            json.dumps({"id": 1, "method": "Network.enable", "params": {}})
        )
        await ws.recv()
        await ws.send(
            json.dumps({"id": 2, "method": "Network.getAllCookies", "params": {}})
        )
        while True:
            message = json.loads(await ws.recv())
            if message.get("id") == 2:
                if "error" in message:
                    raise RuntimeError(f"CDP getAllCookies failed: {message['error']}")
                return list(message.get("result", {}).get("cookies", []))


# ─── Orchestration ───────────────────────────────────────────────────────────


async def _get_account_row(account_id: int) -> dict[str, Any] | None:
    from stitch_backend.domains.accounts.models import Account

    async def _op(session):
        result = await session.execute(
            select(Account).where(Account.id == str(account_id))
        )
        acc = result.scalars().first()
        if acc is None:
            return None
        return {
            "id": acc.id,
            "provider": acc.provider,
            "email": acc.email,
            "profile_path": acc.profile_path,
            "session_data": acc.session_data,
        }

    return await run_in_session(_op)


async def open_web_login(account_id: int) -> dict[str, Any]:
    """Launch the account browser at the provider login page with CDP."""
    row = await _get_account_row(account_id)
    if row is None:
        return {"success": False, "error": f"Account {account_id} not found"}
    provider = str(row["provider"] or "")
    config = WEB_SESSION_HARVEST_CONFIG.get(provider)
    if config is None:
        return {
            "success": False,
            "error": f"Provider {provider!r} has no web-session harvest config",
        }

    from stitch_backend.domains.browser.session import launch_account_browser

    port = pick_free_port()
    result = await launch_account_browser(
        account_id=account_id,
        provider=provider,
        email=str(row["email"] or ""),
        profile_path=row["profile_path"],
        extra_url=str(config["login_url"]),
        cdp_port=port,
    )
    if not result.success:
        return {"success": False, "error": result.error}

    session_data = _merge_session_data(
        str(row["session_data"] or "{}"),
        {
            "state": "harvest_in_progress",
            "cdpPort": port,
            "pid": result.pid,
            "provider": provider,
        },
    )
    await _update_account_fields(
        account_id, {"session_data": session_data, "profile_path": result.profile_path}
    )
    return {"success": True, "port": port, "pid": result.pid}


async def capture_web_cookies(
    account_id: int,
    *,
    cdp_client: Any = None,
) -> dict[str, Any]:
    """Read provider cookies via CDP and persist them on the account."""
    row = await _get_account_row(account_id)
    if row is None:
        return {"success": False, "error": f"Account {account_id} not found"}
    provider = str(row["provider"] or "")
    config = WEB_SESSION_HARVEST_CONFIG.get(provider)
    if config is None:
        return {
            "success": False,
            "error": f"Provider {provider!r} has no web-session harvest config",
        }

    try:
        session_json = json.loads(str(row["session_data"] or "{}"))
    except json.JSONDecodeError:
        session_json = {}
    port = int(session_json.get("cdpPort") or 0)
    if not port:
        return {
            "success": False,
            "error": "No harvest session open (call open_web_login_browser first)",
        }

    fetch = cdp_client or cdp_get_all_cookies
    try:
        all_cookies = await fetch(port)
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error": f"Browser CDP unreachable on port {port}: {exc}",
        }

    provider_cookies = filter_provider_cookies(
        all_cookies, tuple(config["cookie_domains"])
    )
    missing = missing_required_cookies(
        provider_cookies, tuple(config["required_cookies"])
    )
    if missing:
        return {
            "success": False,
            "error": "Login not detected yet (missing cookies: "
            + ", ".join(missing)
            + ")",
        }

    jar = build_cookie_jar(provider_cookies)
    session_data = _merge_session_data(
        str(row["session_data"] or "{}"),
        {
            "state": "harvest_ready",
            "cookiesJson": json.dumps(provider_cookies),
        },
    )
    await _update_account_fields(
        account_id,
        {"cookies": jar, "session_data": session_data, "status": "active"},
    )
    logger.info(
        "web-harvest: captured %d cookies for account %d (%s)",
        len(provider_cookies),
        account_id,
        provider,
    )
    return {"success": True, "cookies": len(provider_cookies)}


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _merge_session_data(raw: str, patch: dict[str, Any]) -> str:
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            data = {}
    except json.JSONDecodeError:
        data = {}
    data.update(patch)
    return json.dumps(data)


async def _update_account_fields(account_id: int, fields: dict[str, Any]) -> None:
    from datetime import UTC, datetime

    from stitch_backend.domains.accounts.models import Account

    values = dict(fields)
    values["updated_at"] = datetime.now(UTC)

    async def _op(session):
        await session.execute(
            update(Account).where(Account.id == str(account_id)).values(**values)
        )

    await run_in_session(_op)
