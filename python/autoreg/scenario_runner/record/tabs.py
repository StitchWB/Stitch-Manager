"""Tab listing and overlay tab-control application for the recorder."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from .capture import attach_console_listeners
from .install import ensure_recorder_installed
from .overlay import update_overlay_all
from .state import RecorderSession


def _page_id(p: Any) -> str:
    try:
        return str(id(p))
    except Exception:
        return ""


def _tab_title(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").strip()
        if host:
            return host
    except Exception:
        pass
    return "tab"


def _tab_favicon(url: str) -> str:
    try:
        parsed = urlsplit(url)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    except Exception:
        pass
    return ""


def build_tabs_payload(session: RecorderSession, ctx: Any) -> dict[str, Any]:
    try:
        pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
    except Exception:
        pages = []

    tabs: list[dict[str, str]] = []
    active_exists = False
    seen_blank = False
    kept_blank_id: str | None = None
    active_blank_skipped = False

    for p in pages:
        pid = _page_id(p)
        if not pid:
            continue
        try:
            url = str(p.url or "")
        except Exception:
            url = ""

        is_blank = url.strip().lower() == "about:blank"
        if is_blank and seen_blank:
            if session.active_page_id and pid == session.active_page_id:
                active_blank_skipped = True
            continue

        if is_blank:
            seen_blank = True
            kept_blank_id = pid

        tabs.append(
            {
                "id": pid,
                "title": _tab_title(url),
                "url": url,
                "favicon": _tab_favicon(url),
            }
        )
        if session.active_page_id and pid == session.active_page_id:
            active_exists = True

    if not active_exists and active_blank_skipped and kept_blank_id:
        session.active_page_id = kept_blank_id
        active_exists = True

    if not active_exists:
        session.active_page_id = tabs[0]["id"] if tabs else None

    return {
        "tabs": tabs,
        "activeTabId": session.active_page_id,
    }


async def update_tabs_overlay(session: RecorderSession, ctx: Any) -> None:
    await update_overlay_all(session, ctx, tabs_payload=build_tabs_payload(session, ctx))


async def apply_pending_tab_controls(session: RecorderSession, ctx: Any) -> None:
    if not session.pending_tab_controls:
        return

    queue = list(session.pending_tab_controls)
    session.pending_tab_controls = []

    for payload in queue:
        action = str(payload.get("action") or "").strip().lower()
        tab_id = str(payload.get("tabId") or "").strip()

        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []

        if action == "tab.new":
            try:
                new_page = await ctx.new_page()
                try:
                    await new_page.goto("about:blank", wait_until="domcontentloaded")
                except Exception:
                    pass
                session.page = new_page
                session.active_page_id = _page_id(new_page) or session.active_page_id
            except Exception:
                continue

        elif action == "tab.activate" and tab_id:
            target = None
            for p in pages:
                if _page_id(p) == tab_id:
                    target = p
                    break
            if target is not None:
                try:
                    await target.bring_to_front()
                except Exception:
                    pass
                session.page = target
                session.active_page_id = tab_id

        elif action == "tab.close" and tab_id:
            target = None
            for p in pages:
                if _page_id(p) == tab_id:
                    target = p
                    break
            if target is not None:
                try:
                    await target.close()
                except Exception:
                    pass
                try:
                    remaining = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
                except Exception:
                    remaining = []
                if remaining:
                    if session.active_page_id == tab_id:
                        session.page = remaining[0]
                        session.active_page_id = _page_id(session.page)
                else:
                    # Keep recording session alive with at least one tab.
                    try:
                        replacement = await ctx.new_page()
                        try:
                            await replacement.goto("about:blank", wait_until="domcontentloaded")
                        except Exception:
                            pass
                        session.page = replacement
                        session.active_page_id = _page_id(replacement)
                    except Exception:
                        pass

    await ensure_recorder_installed(session, ctx, include_recorder=not session.capture_via_extension)
    await attach_console_listeners(session, ctx)
    await update_tabs_overlay(session, ctx)
