"""Install recorder bindings/scripts into browser contexts and pages."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .capture import on_control, on_record
from .js_init import RECORDER_INIT_SCRIPT
from .overlay import build_active_proxy_payload
from .overlay_script import RECORDER_OVERLAY_SCRIPT
from .state import RecorderSession

if TYPE_CHECKING:
    from playwright.async_api import Page


async def install_context_scripts(
    session: RecorderSession, ctx: Any, *, include_recorder: bool
) -> None:
    if session.context_scripts_installed:
        return
    try:
        if include_recorder:
            await ctx.add_init_script(RECORDER_INIT_SCRIPT)
        if session.overlay_enabled:
            await ctx.add_init_script(RECORDER_OVERLAY_SCRIPT)
        session.context_scripts_installed = True
    except Exception:
        # best-effort
        return


async def install_context_bindings(session: RecorderSession, ctx: Any) -> None:
    """Expose bridge functions at context-level so they survive navigations/new tabs."""
    if session.context_bindings_installed:
        return
    try:
        # Context bindings are shared across all pages, avoiding "Bridge not ready" on navigation.
        await ctx.expose_binding(
            "__stitchRecordEvent",
            lambda _source, payload=None: on_record(session, payload or {}),
        )
    except Exception:
        # likely already registered
        pass
    try:
        await ctx.expose_binding(
            "__stitchRecordControl",
            lambda _source, cmd=None: on_control(session, str(cmd or "")),
        )
    except Exception:
        pass
    session.context_bindings_installed = True


async def install_recorder_on_page(
    session: RecorderSession, page: Page, *, include_recorder: bool = True
) -> None:
    # Page-level expose is a fallback for pages that briefly block init scripts.
    try:
        await page.expose_function("__stitchRecordEvent", lambda payload: on_record(session, payload))
    except Exception:
        pass
    try:
        await page.expose_function("__stitchRecordControl", lambda cmd: on_control(session, cmd))
    except Exception:
        pass

    # Ensure init scripts apply for future navigations on this page.
    try:
        if include_recorder:
            await page.add_init_script(RECORDER_INIT_SCRIPT)
        if session.overlay_enabled:
            await page.add_init_script(RECORDER_OVERLAY_SCRIPT)
    except Exception:
        pass

    # Install into the currently loaded document so recording works immediately.
    if include_recorder:
        try:
            await page.evaluate(RECORDER_INIT_SCRIPT)
        except Exception:
            pass
    if session.overlay_enabled:
        try:
            await page.evaluate(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass
        try:
            await page.evaluate(
                "(catalog) => { window.__stitchRecorderRuntimeProxyCatalog = catalog; }",
                session.runtime_proxy_catalog,
            )
            await page.evaluate(
                "(proxyMap) => { window.__stitchRecorderRuntimeProxyMap = proxyMap; }",
                session.runtime_proxy_map,
            )
            await page.evaluate(
                "(payload) => { window.__stitchRecorderActiveProxyId = payload.proxyLibraryId || ''; window.__stitchRecorderActiveProxyLabel = payload.label || ''; }",
                build_active_proxy_payload(
                    session, session.active_proxy_library_id, session.active_proxy_url
                ),
            )
            await page.evaluate(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass


async def ensure_recorder_installed(
    session: RecorderSession, ctx: Any, *, include_recorder: bool = True
) -> None:
    # include_recorder=False under extension capture: the injected recorder would double-capture.
    await install_context_bindings(session, ctx)
    await install_context_scripts(session, ctx, include_recorder=include_recorder)
    try:
        pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
    except Exception:
        pages = []
    for p in pages:
        try:
            await install_recorder_on_page(session, p, include_recorder=include_recorder)
        except Exception:
            continue
