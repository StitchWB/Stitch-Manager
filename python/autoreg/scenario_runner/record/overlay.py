"""Recorder overlay hooks: push status/tabs/proxy state into the in-browser HUD."""

from __future__ import annotations

from typing import Any

from .state import RecorderSession


def build_active_proxy_payload(
    session: RecorderSession, proxy_library_id: str | None, proxy_url: str | None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "proxyLibraryId": proxy_library_id or "",
        "label": "",
        "proxyUrl": proxy_url or "",
    }

    if proxy_library_id:
        item = session.runtime_proxy_catalog_map.get(proxy_library_id)
        if item is not None:
            label = str(item.get("label") or "").strip()
            host = str(item.get("host") or "").strip()
            port = str(item.get("port") or "").strip()
            proxy_type = str(item.get("proxyType") or "http").strip()
            payload["label"] = label or f"{proxy_type}://{host}:{port}"
        else:
            payload["label"] = proxy_library_id
    elif proxy_url:
        payload["label"] = proxy_url

    return payload


async def update_overlay(
    session: RecorderSession,
    page: Any,
    *,
    status: str | None = None,
    reason: str | None = None,
    paused_flag: bool | None = None,
    count: int | None = None,
    saved_path: str | None = None,
    tabs_payload: dict[str, Any] | None = None,
    proxy_payload: dict[str, Any] | None = None,
) -> None:
    if not session.overlay_enabled:
        return
    try:
        if status is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetStatus && window.__stitchRecorderOverlaySetStatus(arg.status)",
                {"status": status},
            )
        if reason is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetReason && window.__stitchRecorderOverlaySetReason(arg.reason)",
                {"reason": reason},
            )
        if paused_flag is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetPaused && window.__stitchRecorderOverlaySetPaused(Boolean(arg.paused))",
                {"paused": paused_flag},
            )
        if count is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetCount && window.__stitchRecorderOverlaySetCount(arg.count)",
                {"count": int(max(0, count))},
            )
        if saved_path is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetSaved && window.__stitchRecorderOverlaySetSaved(arg.path)",
                {"path": saved_path},
            )
        if tabs_payload is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetTabs && window.__stitchRecorderOverlaySetTabs(arg)",
                tabs_payload,
            )
        if proxy_payload is not None:
            await page.evaluate(
                "(arg) => window.__stitchRecorderOverlaySetProxy && window.__stitchRecorderOverlaySetProxy(arg)",
                proxy_payload,
            )
    except Exception:
        pass


async def update_overlay_all(
    session: RecorderSession,
    ctx: Any,
    *,
    status: str | None = None,
    reason: str | None = None,
    paused_flag: bool | None = None,
    count: int | None = None,
    saved_path: str | None = None,
    tabs_payload: dict[str, Any] | None = None,
    proxy_payload: dict[str, Any] | None = None,
) -> None:
    if not session.overlay_enabled:
        return
    try:
        pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
    except Exception:
        pages = []
    for p in pages:
        await update_overlay(
            session,
            p,
            status=status,
            reason=reason,
            paused_flag=paused_flag,
            count=count,
            saved_path=saved_path,
            tabs_payload=tabs_payload,
            proxy_payload=proxy_payload,
        )
