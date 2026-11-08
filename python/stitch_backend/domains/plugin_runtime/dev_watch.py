"""Dev-loop watcher: reload service plugins when their sources change.

Polls the resolved link targets under ``STITCH_PLUGINS_DIR`` and calls
``reload_service_plugin`` for a plugin whose tree changed, after a quiet
period (debounce).  Vendored code, bytecode caches, sqlite files and
VCS / tool cache dirs are ignored.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import TYPE_CHECKING

from autoreg.plugin.layout import plugins_local_dir, resolve_link

if TYPE_CHECKING:
    from collections.abc import Callable
    from concurrent.futures import Future
    from pathlib import Path

    from stitch_backend.domains.plugin_runtime.reload import ReloadResult

logger = logging.getLogger(__name__)

DEFAULT_DEBOUNCE_SECONDS = 3.0
DEFAULT_POLL_SECONDS = 1.0
_IGNORED_DIRS = frozenset(
    {
        "_vendor",
        "__pycache__",
        ".git",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        "node_modules",
        ".venv",
    }
)
_IGNORED_SUFFIXES = frozenset({".db"})


def _is_ignored(root: Path, path: Path) -> bool:
    if path.suffix in _IGNORED_SUFFIXES:
        return True
    return any(part in _IGNORED_DIRS for part in path.relative_to(root).parts)


def scan_targets(base_dir: Path | None = None) -> dict[str, Path]:
    """Map plugin id -> resolved source dir for every local plugin."""
    root = plugins_local_dir() if base_dir is None else base_dir / "plugins-local"
    targets: dict[str, Path] = {}
    if not root.is_dir():
        return targets
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            targets[entry.name] = resolve_link(entry)
    return targets


def latest_mtime(root: Path) -> float:
    """Newest mtime under ``root``, ignoring vendored/cache/db/VCS paths."""
    latest = 0.0
    for path in root.rglob("*"):
        if _is_ignored(root, path):
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime > latest:
            latest = mtime
    return latest


class PluginWatcher:
    """Poll plugin sources; fire ``reload`` after a change settles."""

    def __init__(
        self,
        *,
        reload: Callable[[str], None],
        base_dir: Path | None = None,
        debounce: float = DEFAULT_DEBOUNCE_SECONDS,
        poll_interval: float = DEFAULT_POLL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._reload = reload
        self._base_dir = base_dir
        self._debounce = debounce
        self._poll_interval = poll_interval
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._mtimes: dict[str, float] = {}
        self._pending: dict[str, float] = {}

    def snapshot(self) -> dict[str, float]:
        return {
            plugin_id: latest_mtime(path)
            for plugin_id, path in scan_targets(self._base_dir).items()
        }

    def prime(self) -> None:
        """Record the current mtimes without firing."""
        self._mtimes = self.snapshot()

    def poll(self) -> None:
        now = self._clock()
        current = self.snapshot()
        for plugin_id, mtime in current.items():
            if self._mtimes.get(plugin_id) != mtime:
                self._pending[plugin_id] = now
        self._mtimes = current
        for plugin_id in list(self._pending):
            if plugin_id not in current:
                del self._pending[plugin_id]
            elif now - self._pending[plugin_id] >= self._debounce:
                del self._pending[plugin_id]
                self._fire(plugin_id)

    def _fire(self, plugin_id: str) -> None:
        try:
            self._reload(plugin_id)
        except Exception:
            logger.exception("dev-watch: reload failed for %s", plugin_id)

    def start(self) -> None:
        self.prime()
        self._thread = threading.Thread(
            target=self._run, name="stitch-dev-watch", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self._poll_interval):
            self.poll()


async def _reload_or_start(plugin_id: str) -> ReloadResult:
    """Reload a plugin; on ``unknown_plugin`` start it like discovery does.

    A plugin ``dev-install``ed after backend boot has no registered host,
    so its first watcher reload cannot swap one — start it instead (dev
    mode only).
    """
    from stitch_backend.domains.plugin_runtime.reload import (
        ReloadResult,
        reload_service_plugin,
    )

    result = await reload_service_plugin(plugin_id)
    if result.ok or result.error_kind != "unknown_plugin":
        return result

    from stitch_backend.domains.plugin_runtime.discovery import _resolve_dev_mode

    if not _resolve_dev_mode():
        return result
    if await _dev_start(plugin_id):
        return ReloadResult(ok=True, status={"status": "running"})
    return result


async def _dev_start(plugin_id: str) -> bool:
    from autoreg.plugin.loader import PluginLoader
    from stitch_backend.domains.plugin_runtime.discovery import (
        _start_one,
        _try_read_manifest,
    )

    package_dir = resolve_link(plugins_local_dir() / plugin_id)
    manifest = _try_read_manifest(package_dir)
    if manifest is None or manifest.id != plugin_id:
        return False
    return await _start_one(
        manifest, package_dir, source="local", loader=PluginLoader(dev_mode=True)
    )


def make_loop_reload(loop: asyncio.AbstractEventLoop) -> Callable[[str], None]:
    """Return a thread-safe reload callback that schedules on ``loop``."""

    def _reload(plugin_id: str) -> None:
        future = asyncio.run_coroutine_threadsafe(
            _reload_or_start(plugin_id), loop
        )
        future.add_done_callback(_log_reload)

    return _reload


def _log_reload(future: Future) -> None:
    try:
        result = future.result()
    except Exception:
        logger.exception("dev-watch: reload raised")
        return
    if not result.ok:
        logger.warning("dev-watch: reload failed: %s", result.error)


__all__ = [
    "DEFAULT_DEBOUNCE_SECONDS",
    "PluginWatcher",
    "latest_mtime",
    "make_loop_reload",
    "scan_targets",
]
