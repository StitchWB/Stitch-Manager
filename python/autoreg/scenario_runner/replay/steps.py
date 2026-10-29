"""Replay step helpers: kind/selector selection, sanitize, Playwright step executor."""

from __future__ import annotations

from typing import Any

from .._common import _event
from .proxy import _mask_proxy_url, _parse_runtime_proxy_any


def _looks_like_captcha(step: dict[str, Any]) -> bool:
    bits: list[str] = []
    for key in ("selector", "url", "kind"):
        v = step.get(key)
        if isinstance(v, str):
            bits.append(v)

    candidates = step.get("selectorCandidates")
    if isinstance(candidates, list):
        for item in candidates:
            if not isinstance(item, dict):
                continue
            value = item.get("value")
            if isinstance(value, str):
                bits.append(value)

    meta = step.get("meta")
    if isinstance(meta, dict):
        for key in ("text", "ariaLabel", "placeholder", "role", "tag", "type"):
            v = meta.get(key)
            if isinstance(v, str):
                bits.append(v)
    hay = " ".join(bits).lower()
    return any(
        token in hay
        for token in (
            "captcha",
            "hcaptcha",
            "recaptcha",
            "turnstile",
            "cf-chl",
            "cloudflare",
        )
    )


def _step_kind(step: dict[str, Any]) -> str:
    kind = step.get("kind")
    return str(kind).strip().lower() if isinstance(kind, str) else "unknown"


def _timeout_ms(step: dict[str, Any], default_ms: int) -> int:
    raw = step.get("timeoutMs")
    if isinstance(raw, int) and raw > 0:
        return raw
    if isinstance(raw, float) and raw > 0:
        return int(raw)
    return default_ms


def _best_selector(step: dict[str, Any]) -> str | None:
    """Choose best selector from v2 selectorCandidates or legacy selector field."""
    cand = step.get("selectorCandidates")
    if isinstance(cand, list) and cand:
        best_css: str | None = None
        best_w = -1.0
        for item in cand:
            if not isinstance(item, dict):
                continue
            if str(item.get("kind") or "") != "css":
                continue
            value = item.get("value")
            if not isinstance(value, str) or not value.strip():
                continue
            w = item.get("weight")
            try:
                wf = float(w) if w is not None else 1.0
            except Exception:
                wf = 1.0
            if wf > best_w:
                best_w = wf
                best_css = value.strip()
        if best_css:
            return best_css

    legacy = step.get("selector")
    if isinstance(legacy, str) and legacy.strip():
        return legacy.strip()
    return None


def _sanitize_step(
    step: dict[str, Any], runtime_proxy_map: dict[str, str] | None = None
) -> tuple[dict[str, Any] | None, str | None]:
    """Sanitize one replay step for backward compatibility.

    Returns (sanitized_step_or_none, skip_reason_or_none).
    """
    kind = _step_kind(step)

    # Drop malformed navigation steps (legacy recorder bug: nav with null url).
    if kind in ("nav", "goto", "navigate"):
        url = step.get("url")
        if not isinstance(url, str) or not url.strip():
            return None, "nav step has no url"
        fixed = dict(step)
        fixed["kind"] = "goto"
        fixed["url"] = url.strip()
        return fixed, None

    if kind == "change":
        fixed = dict(step)
        fixed["kind"] = "fill"
        return fixed, None
    if kind == "submit":
        fixed = dict(step)
        fixed["kind"] = "press"
        if not isinstance(fixed.get("value"), str) or not str(fixed.get("value") or "").strip():
            fixed["value"] = "Enter"
        return fixed, None

    if kind == "proxy.switch":
        fixed = dict(step)
        meta = fixed.get("meta") if isinstance(fixed.get("meta"), dict) else {}
        proxy_id = str(meta.get("proxyLibraryId") or "").strip() if isinstance(meta, dict) else ""

        resolved = None
        if proxy_id and runtime_proxy_map and proxy_id in runtime_proxy_map:
            resolved = runtime_proxy_map.get(proxy_id)
        if not resolved:
            # Direct per-step fallback: kept for compatibility.
            resolved = str(fixed.get("value") or "").strip() or None

        runtime_proxy = _parse_runtime_proxy_any(resolved)
        if not runtime_proxy:
            return None, "proxy.switch has no resolvable proxy"

        fixed["kind"] = "proxy.switch"
        fixed["value"] = None
        fixed_meta = dict(meta) if isinstance(meta, dict) else {}
        fixed_meta["runtimeProxy"] = runtime_proxy
        fixed_meta["runtimeProxyMasked"] = _mask_proxy_url(runtime_proxy)
        fixed["meta"] = fixed_meta
        return fixed, None

    return step, None


def _sanitize_steps(
    steps: list[dict[str, Any]],
    runtime_proxy_map: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sanitized: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []

    for idx, step in enumerate(steps, start=1):
        fixed, reason = _sanitize_step(step, runtime_proxy_map=runtime_proxy_map)
        if fixed is None:
            dropped.append({"index": idx, "reason": reason or "invalid step"})
            continue
        sanitized.append(fixed)

    return sanitized, dropped


async def _run_step(page: Any, step: dict[str, Any], timeout_ms: int = 15_000) -> None:
    kind = _step_kind(step)
    selector = _best_selector(step)
    value = step.get("value") if isinstance(step.get("value"), str) else None
    url = step.get("url") if isinstance(step.get("url"), str) else None

    if kind in ("nav", "goto", "navigate"):
        if not url:
            raise ValueError("nav step has no url")
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        return

    if kind in ("click",):
        if not selector:
            raise ValueError("click step has no selector")
        try:
            await page.locator(selector).first.click(timeout=timeout_ms)
        except Exception:
            # Auto-heal fallback: try text selector from meta.text when available.
            meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
            text = meta.get("text") if isinstance(meta, dict) else None
            if isinstance(text, str) and text.strip():
                candidate = text.strip()[:80]
                _event(
                    "scenario.replay.selector.heal",
                    {
                        "kind": "click",
                        "from": selector,
                        "to": f"text={candidate}",
                    },
                )
                await page.get_by_text(candidate, exact=False).first.click(timeout=timeout_ms)
            else:
                raise
        return

    if kind in ("change", "fill", "input"):
        if not selector:
            raise ValueError("change step has no selector")
        # Password-like values are redacted during record; skip writing them.
        if value == "***":
            return
        try:
            await page.locator(selector).first.fill(value or "", timeout=timeout_ms)
        except Exception:
            meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
            placeholder = meta.get("placeholder") if isinstance(meta, dict) else None
            if isinstance(placeholder, str) and placeholder.strip():
                candidate = placeholder.strip()[:80]
                _event(
                    "scenario.replay.selector.heal",
                    {
                        "kind": "fill",
                        "from": selector,
                        "to": f"placeholder={candidate}",
                    },
                )
                await page.get_by_placeholder(candidate).first.fill(value or "", timeout=timeout_ms)
            else:
                raise
        return

    if kind in ("submit", "press", "keydown"):
        key = value if (value and value.strip()) else "Enter"
        # Playwright expects capitalized key names like "Enter"; the recorder may save lowercase.
        if len(key) == 1:
            # single character keys are fine
            pass
        else:
            key = key[:1].upper() + key[1:]

        if selector:
            try:
                await page.locator(selector).first.press(key, timeout=timeout_ms)
            except Exception:
                # Fall back to the focused element like a real keypress would.
                await page.keyboard.press(key)
        else:
            await page.keyboard.press(key)
        return

    if kind in ("scroll",):
        # Element-scoped scroll when the step carries a selector, window-scoped otherwise.
        meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
        raw_top = meta.get("scrollTop")
        raw_left = meta.get("scrollLeft")
        top = raw_top if isinstance(raw_top, (int, float)) else 0
        left = raw_left if isinstance(raw_left, (int, float)) else 0
        if selector:
            await page.locator(selector).first.evaluate(
                "(el, pos) => { el.scrollTop = pos.top; el.scrollLeft = pos.left; }",
                {"top": top, "left": left},
            )
        else:
            await page.evaluate(
                "(pos) => window.scrollTo({ left: pos.left, top: pos.top, behavior: 'instant' })",
                {"top": top, "left": left},
            )
        return

    if kind in ("manual.pause", "manual", "manual.captcha", "captcha"):
        # handled by outer loop
        return

    if kind == "proxy.switch":
        # Runtime proxy cannot hot-swap on a live Playwright context; surface an event instead.
        meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
        _event(
            "scenario.replay.proxy.switch",
            {
                "applied": False,
                "reason": "runtime_context_proxy_not_switchable",
                "proxyLibraryId": meta.get("proxyLibraryId") if isinstance(meta, dict) else None,
                "proxy": meta.get("runtimeProxyMasked") if isinstance(meta, dict) else None,
            },
        )
        return

    # unknown step kinds are no-op (do not fail whole run)
    return
