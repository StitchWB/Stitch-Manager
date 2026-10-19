"""Extension capture bridge selection/startup for the recorder."""

from __future__ import annotations

from extension_bridge_host import ExtensionBridgeHost

from .._common import _result
from .capture import on_record
from .state import RecorderSession


async def setup_capture_bridge(session: RecorderSession) -> int | None:
    args = session.args
    # The extension bridge is the preferred capture source; the injected script is the Cloak-only fallback.
    capture_mode = str(getattr(args, "capture", "auto") or "auto").strip().lower()
    if capture_mode == "injected" and session.engine_norm != "cloakbrowser":
        _result(
            False,
            error={
                "code": "capture_mode_unavailable",
                "message": (
                    "Injected-script capture is only available on CloakBrowser; "
                    "ShardBrowser capture is extension-only."
                ),
            },
        )
        return 1

    use_bridge = capture_mode in ("auto", "extension")
    # Fallback to the injected recorder is allowed only for auto + Cloak.
    injected_fallback_allowed = capture_mode == "auto" and session.engine_norm == "cloakbrowser"

    session.capture_via_extension = False
    session.bridge_decided = False
    session.use_bridge = use_bridge
    session.injected_fallback_allowed = injected_fallback_allowed

    # Cloak: the native overlay is the HUD, so the extension HUD is always suppressed.
    session.suppress_extension_hud = (
        True if session.engine_norm == "cloakbrowser" else bool(args.no_overlay)
    )

    if use_bridge:
        session.bridge = ExtensionBridgeHost(
            run_id=session.run_id,
            alias=args.alias,
            scenario_name=args.scenario_name,
            start_url=args.url,
            on_event=lambda payload: on_record(session, payload)
            if session.capture_via_extension
            else None,
            on_stopped=session.request_stop,
            native_hosted=True,
            suppress_overlay=session.suppress_extension_hud,
        )
        session.bridge_started = await session.bridge.start()
        if not session.bridge_started and not injected_fallback_allowed:
            # Without the bridge there is no capture at all here, so refuse before launching.
            await session.bridge.close()
            _result(
                False,
                error={
                    "code": "extension_capture_unavailable",
                    "message": (
                        "Record bridge could not start (websockets missing or port busy). "
                        "Extension capture is required, so recording cannot start."
                    ),
                },
            )
            return 1
    return None
