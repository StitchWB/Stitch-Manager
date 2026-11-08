"""Headless dev backend launcher + thin invoke client for the plugin dev loop.

``dev-backend`` scopes every writable path into a dev data dir (stable
default ``<temp>/stitch-dev-backend``, ``--data-dir`` to override) so
``dev-install``ed plugins persist across runs, disables auth, drops the
core encryption key, and runs the real backend (``stitch_backend.main``)
in the foreground on 127.0.0.1.  ``--watch`` additionally reloads service
plugins when their sources change.

``invoke`` is the matching thin client: it POSTs a plugin command to a
running dev backend and prints the JSON body.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import MutableMapping

    from fastapi import FastAPI

logger = logging.getLogger(__name__)

DEFAULT_PORT = 25584
DEFAULT_INVOKE_TIMEOUT = 30.0
DEFAULT_DATA_DIR = Path(tempfile.gettempdir()) / "stitch-dev-backend"
_REMOVED_ENV = ("TOKEN_ENCRYPTION_KEY",)


def build_dev_env(base_dir: Path, port: int) -> dict[str, str]:
    """Env overrides that scope a headless backend to ``base_dir``."""
    return {
        "STITCH_PLUGINS_DIR": str(base_dir / "plugins"),
        "LOCALAPPDATA": str(base_dir / "localappdata"),
        "STITCH_DEV_MODE": "1",
        "STITCH_AUTH_ENABLED": "0",
        "PORT": str(port),
        "DATABASE_URL": f"sqlite+aiosqlite:///{(base_dir / 'dev.db').as_posix()}",
    }


def apply_dev_env(
    env: dict[str, str], environ: MutableMapping[str, str] | None = None
) -> None:
    """Apply ``env`` and drop the core encryption key from the target env."""
    target = os.environ if environ is None else environ
    for key in _REMOVED_ENV:
        target.pop(key, None)
    target.update(env)


def split_target(target: str) -> tuple[str, str]:
    """Split ``<plugin-id>.<cmd>`` on the first dot."""
    plugin_id, sep, command = target.partition(".")
    if not sep or not plugin_id or not command:
        raise ValueError(f"target must be <plugin-id>.<cmd>, got {target!r}")
    return plugin_id, command


def invoke_command(
    target: str,
    params: dict[str, Any],
    *,
    url: str,
    json_output: bool = False,
    timeout: float = DEFAULT_INVOKE_TIMEOUT,
) -> int:
    """POST a plugin command and print the JSON body; non-zero on HTTP error."""
    import httpx

    try:
        plugin_id, command = split_target(target)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    endpoint = f"{url.rstrip('/')}/api/plugin.{plugin_id}.{command}"
    try:
        response = httpx.post(endpoint, json=params, timeout=timeout)
    except httpx.HTTPError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if response.status_code >= 400:
        print(response.text, file=sys.stderr)
        return 1

    if json_output:
        print(response.text)
        return 0
    try:
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except ValueError:
        print(response.text)
    return 0


def _install_watch(app: FastAPI) -> None:
    from contextlib import asynccontextmanager

    from stitch_backend.domains.plugin_runtime.dev_watch import (
        PluginWatcher,
        make_loop_reload,
    )

    original = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        async with original(app) as state:
            loop = asyncio.get_running_loop()
            watcher = PluginWatcher(reload=make_loop_reload(loop))
            watcher.start()
            logger.info("dev-watch: watching plugin sources")
            try:
                yield state
            finally:
                watcher.stop()

    app.router.lifespan_context = _lifespan


def _install_line(plugins_dir: Path) -> str:
    if os.name == "nt":
        return (
            f'$env:STITCH_PLUGINS_DIR = "{plugins_dir}"; '
            "python -m stitch_plugin_tools dev-install <package_dir>"
        )
    return (
        f'STITCH_PLUGINS_DIR="{plugins_dir}" '
        "python -m stitch_plugin_tools dev-install <package_dir>"
    )


def run_dev_backend(port: int, watch: bool, data_dir: Path | None = None) -> int:
    """Run the real backend headless in the foreground; return the exit code."""
    base_dir = DEFAULT_DATA_DIR if data_dir is None else data_dir
    base_dir.mkdir(parents=True, exist_ok=True)
    apply_dev_env(build_dev_env(base_dir, port))

    import uvicorn

    from stitch_backend.main import create_app

    app = create_app()
    if watch:
        _install_watch(app)

    print(f"dev backend: http://127.0.0.1:{port}")
    print(f"  data dir: {base_dir}")
    print(f"  watch:    {'on' if watch else 'off'}")
    print(f"  install:  {_install_line(base_dir / 'plugins')}")
    sys.stdout.flush()

    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", access_log=False)
    except KeyboardInterrupt:
        return 0
    return 0


__all__ = [
    "DEFAULT_DATA_DIR",
    "DEFAULT_PORT",
    "apply_dev_env",
    "build_dev_env",
    "invoke_command",
    "run_dev_backend",
    "split_target",
]
