"""Recorder session state (mutable fields shared across the record engine modules)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import argparse


@dataclass(frozen=True)
class RecordedStep:
    kind: str
    ts: str
    url: str | None
    selector: str | None
    value: str | None
    meta: dict[str, Any]
    frameSrc: str | None = None  # noqa: N815 — scenario JSON key contract


class CaptureUnavailableError(RuntimeError):
    """Extension capture is mandatory for this engine but no client connected."""


class RecorderSession:
    def __init__(
        self,
        *,
        args: argparse.Namespace,
        run_id: str,
        out_dir: Path,
        session_dir: Path,
        scenario_path: Path,
        command_file: Path,
        overlay_enabled: bool,
        engine_norm: str,
    ) -> None:
        self.args = args
        self.run_id = run_id
        self.out_dir = out_dir
        self.session_dir = session_dir
        self.scenario_path = scenario_path
        self.command_file = command_file
        self.overlay_enabled = overlay_enabled
        self.engine_norm = engine_norm
        self.steps: list[RecordedStep] = []
        self.stop_requested = False
        self.paused = False
        self.keep_browser_open_after_save = False
        self.console_hooks_page_ids: set[int] = set()
        self.runtime_proxy_map: dict[str, str] = {}
        self.pending_proxy_restart: dict[str, Any] | None = None
        self.pending_browser_close = False
        self.pending_tab_controls: list[dict[str, Any]] = []
        self.active_proxy_url: str | None = args.proxy or None
        self.active_page_id: str | None = None
        self.config: dict[str, Any] = {}
        self.runtime_proxy_catalog: list[dict[str, Any]] = []
        self.runtime_proxy_catalog_map: dict[str, dict[str, Any]] = {}
        self.active_proxy_library_id: str | None = None
        self.command_pos = 0
        self.last_len = 0
        self.last_save_ts = 0.0
        self.context_scripts_installed = False
        self.context_bindings_installed = False
        self.capture_via_extension = False
        self.bridge_decided = False
        self.pending_bridge_controls: list[str] = []
        self.bridge: Any | None = None
        self.bridge_started = False
        self.use_bridge = False
        self.injected_fallback_allowed = False
        self.suppress_extension_hud = True
        self.launcher: Any | None = None
        self.page: Any | None = None
        self.ctx: Any | None = None

    def request_stop(self) -> None:
        self.stop_requested = True
