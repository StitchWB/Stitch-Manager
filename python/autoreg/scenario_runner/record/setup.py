"""Recorder config assembly: --config-json merge, runtime proxy maps, tab UI prefs."""

from __future__ import annotations

from typing import Any

from .._common import build_runtime_proxy_map, parse_config_json
from .proxy import _build_proxy_url_from_catalog_item, _parse_proxy_library_catalog_item
from .state import RecorderSession


def apply_config(session: RecorderSession) -> None:
    config = parse_config_json(session.args)

    runtime_proxy_map = build_runtime_proxy_map(config)

    runtime_proxy_catalog = [
        item
        for item in list(config.get("runtime_proxy_catalog") or [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        and str(item.get("host") or "").strip()
        and str(item.get("label") or "").strip()
    ]

    runtime_proxy_catalog_map: dict[str, dict[str, Any]] = {}
    for item in runtime_proxy_catalog:
        parsed_item = _parse_proxy_library_catalog_item(item)
        if parsed_item is not None:
            runtime_proxy_catalog_map[parsed_item["id"]] = parsed_item

    for proxy_id, item in runtime_proxy_catalog_map.items():
        if proxy_id not in runtime_proxy_map:
            runtime_proxy_map[proxy_id] = _build_proxy_url_from_catalog_item(item)

    active_proxy_library_id = str(config.get("proxy_library_id") or "").strip() or None

    # Auto-apply the configured profile proxy on startup.
    if not session.active_proxy_url:
        if active_proxy_library_id and active_proxy_library_id in runtime_proxy_map:
            session.active_proxy_url = runtime_proxy_map.get(active_proxy_library_id)
        elif len(runtime_proxy_map) == 1:
            only_id, only_url = next(iter(runtime_proxy_map.items()))
            active_proxy_library_id = active_proxy_library_id or str(only_id)
            session.active_proxy_url = str(only_url)

    session.config = config
    session.runtime_proxy_map = runtime_proxy_map
    session.runtime_proxy_catalog = runtime_proxy_catalog
    session.runtime_proxy_catalog_map = runtime_proxy_catalog_map
    session.active_proxy_library_id = active_proxy_library_id


def ensure_recorder_tab_ui_prefs(session: RecorderSession) -> None:
    """Force native clickable tabs for recorder windows.

    Some profile-level prefs can hide tab UI, which makes newly opened tabs
    switchable only via keyboard shortcuts (e.g. Ctrl+Tab). Recorder should
    preserve native tab interaction (click to switch/close).
    """

    config = session.config
    raw_launch_kwargs = config.get("launch_kwargs")
    launch_kwargs: dict[str, Any] = (
        dict(raw_launch_kwargs) if isinstance(raw_launch_kwargs, dict) else {}
    )

    raw_prefs = launch_kwargs.get("firefox_user_prefs")
    firefox_prefs: dict[str, Any] = dict(raw_prefs) if isinstance(raw_prefs, dict) else {}

    # Keep the tab strip visible; never close the window when the last tab closes.
    firefox_prefs.setdefault("browser.tabs.autoHide", False)
    firefox_prefs.setdefault("browser.tabs.forceHide", False)
    firefox_prefs.setdefault("browser.tabs.closeWindowWithLastTab", False)

    # Prefer classic tab behavior over sidebar-only vertical tabs.
    firefox_prefs.setdefault("sidebar.verticalTabs", False)

    launch_kwargs["firefox_user_prefs"] = firefox_prefs
    config["launch_kwargs"] = launch_kwargs
