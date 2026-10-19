"""account.save capability for StepKind v2 (plan §4.3, §4.4)."""

from __future__ import annotations

import logging
import time
from typing import Any

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult

logger = logging.getLogger(__name__)


def _capture_session(browser: Any, meta: dict[str, Any]) -> dict[str, Any]:
    """Capture cookies + session metadata from a live browser.

    Mirrors ``KiroV2Browser.get_session_data`` (providers/kiro_v2/browser.py):
    cookies via CDP ``Network.getAllCookies`` filtered to ``cookie_domains``
    (substring match — same semantics as ``AWS_COOKIE_DOMAINS`` there), plus
    ``session_data`` JSON with last_url / timestamp / user_agent.  Cookie
    failure degrades to an empty list rather than failing the terminal step.
    """
    import json as _json  # noqa: PLC0415 — keep module import surface light

    cookie_domains = meta.get("cookie_domains") or []
    cookies: list[dict[str, Any]] = []
    try:
        run_cdp = getattr(browser, "run_cdp", None)
        if run_cdp is not None:
            resp = run_cdp("Network.getAllCookies")
            raw = resp.get("cookies") if isinstance(resp, dict) else []
        else:
            raw = browser.cookies() or []
        for c in raw or []:
            if not isinstance(c, dict):
                c = {
                    "name": getattr(c, "name", ""),
                    "value": getattr(c, "value", ""),
                    "domain": getattr(c, "domain", ""),
                }
            if cookie_domains and not any(
                d in (c.get("domain") or "") for d in cookie_domains
            ):
                continue
            cookies.append(c)
    except Exception as exc:  # noqa: BLE001
        logger.warning("account.save: cookie capture failed: %s", exc)

    try:
        run_js = getattr(browser, "run_js", None)
        user_agent = run_js("return navigator.userAgent") if run_js else ""
    except Exception:  # noqa: BLE001
        user_agent = ""
    session_meta = {
        "last_url": getattr(browser, "url", "") or "",
        "timestamp": time.time(),
        "user_agent": user_agent,
    }
    return {
        "cookies": _json.dumps(cookies),
        "session_data": _json.dumps(session_meta),
    }


def account_save_capability(
    step: ScenarioStep, store: dict[str, Any], browser: Any = None
) -> StepResult:
    """Collect outputs and mark terminal (plan §4.3, §4.4).

    When ``account.session`` is declared among outputs, a browser is
    available, and nothing stored a session earlier, capture it here —
    this is what makes the account reusable after a plugin-path
    registration.
    """
    meta = step.meta or {}
    output_keys = meta.get("outputs", [])
    if not isinstance(output_keys, list):
        output_keys = []
    if (
        browser is not None
        and "account.session" in output_keys
        and store.get("account.session") is None
    ):
        store["account.session"] = _capture_session(browser, meta)
    outputs = {key: store.get(key) for key in output_keys}
    return StepResult(step.id, step.kind, True, terminal=True, meta={"outputs": outputs})
