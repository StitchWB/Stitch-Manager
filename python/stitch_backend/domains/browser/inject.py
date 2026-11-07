"""Inject a saved session (cookies + localStorage) into a running browser via CDP.

The account's persistent profile is launched with a known ``--remote-debugging-port``;
this module then sets cookies (``Network.setCookies``) and seeds ``localStorage``
(``Page.addScriptToEvaluateOnNewDocument``) before navigating to the provider URL.
LocalStorage is what web2api providers such as ZCode use for auth, and it cannot be
written into the profile offline the way cookies can.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _cdp_cookie(cookie: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "name": str(cookie.get("name", "")),
        "value": str(cookie.get("value", "")),
        "domain": str(cookie.get("domain", "")),
        "path": str(cookie.get("path", "/") or "/"),
    }
    if "secure" in cookie:
        out["secure"] = bool(cookie["secure"])
    if "httpOnly" in cookie:
        out["httpOnly"] = bool(cookie["httpOnly"])
    same_site = cookie.get("sameSite")
    if same_site in ("Strict", "Lax", "None"):
        out["sameSite"] = same_site
    expires = cookie.get("expires")
    if isinstance(expires, (int, float)) and expires > 0:
        out["expires"] = expires
    return out


async def inject_session(
    port: int,
    cookies: list[dict[str, Any]] | None,
    local_storage: dict[str, Any] | None,
    origin: str,
) -> None:
    """Set cookies + seed localStorage in the running browser, then navigate."""
    import httpx
    import websockets

    async with httpx.AsyncClient(timeout=8) as client:
        version = await client.get(f"http://127.0.0.1:{port}/json/version")
        version.raise_for_status()
        ws_url = version.json()["webSocketDebuggerUrl"]

    counter = 0

    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        async def call(
            method: str,
            params: dict[str, Any] | None = None,
            session_id: str | None = None,
        ) -> dict[str, Any]:
            nonlocal counter
            counter += 1
            mid = counter
            message: dict[str, Any] = {"id": mid, "method": method, "params": params or {}}
            if session_id:
                message["sessionId"] = session_id
            await ws.send(json.dumps(message))
            while True:
                data = json.loads(await ws.recv())
                if data.get("id") == mid:
                    if "error" in data:
                        raise RuntimeError(f"CDP {method} failed: {data['error']}")
                    return data.get("result", {})

        targets = (await call("Target.getTargets")).get("targetInfos", [])
        page = next((t for t in targets if t.get("type") == "page"), None)
        if page is None:
            created = await call("Target.createTarget", {"url": "about:blank"})
            page = {"targetId": created["targetId"]}
        attached = await call(
            "Target.attachToTarget", {"targetId": page["targetId"], "flatten": True}
        )
        sid = attached["sessionId"]

        await call("Network.enable", {}, sid)
        if cookies:
            await call(
                "Network.setCookies",
                {"cookies": [_cdp_cookie(c) for c in cookies if isinstance(c, dict)]},
                sid,
            )
        if local_storage:
            await call("Page.enable", {}, sid)
            seed = json.dumps(local_storage)
            source = (
                "(() => { const kv = " + seed + "; try { for (const k of "
                "Object.keys(kv)) localStorage.setItem(k, kv[k]); } catch (e) {} })()"
            )
            await call("Page.addScriptToEvaluateOnNewDocument", {"source": source}, sid)
        await call("Page.navigate", {"url": origin}, sid)


async def read_local_storage(port: int) -> dict[str, str]:
    """Read the current page's localStorage from the running browser via CDP."""
    import httpx
    import websockets

    async with httpx.AsyncClient(timeout=8) as client:
        version = await client.get(f"http://127.0.0.1:{port}/json/version")
        version.raise_for_status()
        ws_url = version.json()["webSocketDebuggerUrl"]

    counter = 0

    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        async def call(
            method: str,
            params: dict[str, Any] | None = None,
            session_id: str | None = None,
        ) -> dict[str, Any]:
            nonlocal counter
            counter += 1
            mid = counter
            message: dict[str, Any] = {"id": mid, "method": method, "params": params or {}}
            if session_id:
                message["sessionId"] = session_id
            await ws.send(json.dumps(message))
            while True:
                data = json.loads(await ws.recv())
                if data.get("id") == mid:
                    if "error" in data:
                        raise RuntimeError(f"CDP {method} failed: {data['error']}")
                    return data.get("result", {})

        targets = (await call("Target.getTargets")).get("targetInfos", [])
        page = next((t for t in targets if t.get("type") == "page"), None)
        if page is None:
            return {}
        sid = (
            await call(
                "Target.attachToTarget",
                {"targetId": page["targetId"], "flatten": True},
            )
        )["sessionId"]
        result = await call(
            "Runtime.evaluate",
            {"expression": "JSON.stringify(window.localStorage)", "returnByValue": True},
            sid,
        )
        raw = result.get("result", {}).get("value")
        if not raw:
            return {}
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
