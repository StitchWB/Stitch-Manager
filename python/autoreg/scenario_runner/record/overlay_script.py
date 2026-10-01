"""Recorder overlay script assembly: shared runtime + recorder overlay JS parts."""

from .._common import _load_shared_overlay_runtime_script
from .js_overlay_controls import _OVERLAY_JS_CONTROLS
from .js_overlay_render import _OVERLAY_JS_RENDER
from .js_overlay_state import _OVERLAY_JS_STATE

RECORDER_OVERLAY_SCRIPT = (
    _load_shared_overlay_runtime_script()
    + "\n"
    + _OVERLAY_JS_STATE
    + _OVERLAY_JS_CONTROLS
    + _OVERLAY_JS_RENDER
)
