"""In-page HTTP fetch over DrissionPage run_js (Zone-1 provider kit).

Distilled from the 2no.pl SMS backend (``_CALL_JS``) and the abliteration
console client (``_FETCH_JS``): direct HTTP to Cloudflare-gated sites is
blocked, so API calls run inside the logged-in browser page. DrissionPage
awaits the async function's promise and returns the ``{status, body}``
dict.

``MockBrowserMixin`` mirrors the fetch-script semantics for package
tests: it performs a real HTTP call with the script arguments and answers
``sessionStorage.getItem`` scripts from a fake dict, so provider test
suites exercise the full wire path against a local mock server.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

_FETCH_JS = """async function() {
    const opt = {method: arguments[0], credentials: "include",
                 headers: Object.assign({"Content-Type": "application/json"}, arguments[2] || {})};
    if (arguments[3]) {
        opt.body = arguments[3];
    }
    const r = await fetch(arguments[1], opt);
    return {status: r.status, body: await r.text()};
}"""

_STORAGE_KEY_RE = re.compile(r"sessionStorage\.getItem\('([^']+)'\)")


def browser_fetch(
    page: Any,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    timeout_ms: int = 30000,
) -> dict[str, Any]:
    """HTTP fetch executed inside the browser page.

    Returns ``{"status": int, "body": str}``. Network and script errors
    propagate to the caller — decide per flow whether they are fatal.
    ``json_body`` is serialized in Python: DrissionPage run_js rejects
    ``None`` arguments, so the JS receives a JSON string ("" = no body).
    """
    body_str = json.dumps(json_body) if json_body is not None else ""
    res = page.run_js(
        _FETCH_JS, method, url, headers or {}, body_str, timeout=timeout_ms / 1000
    )
    return {"status": int(res["status"]), "body": str(res["body"])}


class MockBrowserMixin:
    """DrissionPage-shaped run_js mock for browser_fetch scripts.

    Dispatches on script markers: fetch scripts (``fetch(``) are executed
    as a real HTTP call with the script arguments (method, url, headers,
    body — the ``Content-Type: application/json`` default mirrors the
    in-page script), and ``sessionStorage.getItem('KEY')`` scripts read
    from the ``session_storage`` dict. Unknown scripts return ``None``.
    Subclasses add their page-specific script markers (form fills,
    navigation) and delegate the rest via ``super().run_js(...)``.
    """

    def __init__(
        self,
        *,
        session_storage: dict[str, str] | None = None,
        http_timeout: float = 10.0,
    ) -> None:
        self.session_storage: dict[str, str] = {} if session_storage is None else session_storage
        self.http_timeout = http_timeout
        self.js_calls: list[tuple[str, tuple[Any, ...]]] = []

    def run_js(self, script: str, *args: Any, **kwargs: Any) -> Any:
        self.js_calls.append((script, args))
        if "fetch(" in script:
            return self._http_fetch(args)
        if "sessionStorage.getItem" in script:
            match = _STORAGE_KEY_RE.search(script)
            return self.session_storage.get(match.group(1)) if match else None
        return None

    def _http_fetch(self, args: tuple[Any, ...]) -> dict[str, Any]:
        method = str(args[0]) if len(args) > 0 else "POST"
        url = str(args[1]) if len(args) > 1 else ""
        extra = dict(args[2]) if len(args) > 2 and args[2] else {}
        body = str(args[3]) if len(args) > 3 and args[3] else ""
        headers = {"Content-Type": "application/json", **extra}
        data = body.encode("utf-8") if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.http_timeout) as resp:
                return {"status": resp.status, "body": resp.read().decode("utf-8")}
        except urllib.error.HTTPError as exc:
            return {"status": exc.code, "body": exc.read().decode("utf-8")}


__all__ = ["MockBrowserMixin", "browser_fetch"]
