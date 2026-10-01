"""Replay overlay script assembly: shared runtime + replay bootstrap."""

from .._common import _load_shared_overlay_runtime_script
from .js_overlay import _REPLAY_OVERLAY_BOOTSTRAP

REPLAY_OVERLAY_SCRIPT = _load_shared_overlay_runtime_script() + "\n" + _REPLAY_OVERLAY_BOOTSTRAP
