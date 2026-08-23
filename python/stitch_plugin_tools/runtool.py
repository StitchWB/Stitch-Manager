"""Local plugin-developer playground (plan todo 23 - dev loop).

Two entry points:

* ``run_package(package_dir)`` - interactive plugin REPL.  Spawns the
  plugin child with ``RpcPluginClient`` (re-using the host-side client
  from ``autoreg.plugin.rpc``), streams child stderr live to the tool's
  stderr, drives a line-based REPL on stdin (``<command> [json-params]``
  -> ``plugin.call`` -> pretty-printed result), and stubs reverse-RPC
  ``engine.oauth.*`` requests so plugins that use ``server.call_host``
  fail gracefully instead of hanging.

* ``test_package(package_dir)`` - runs the venv pytest on
  ``<package_dir>/tests`` if present, streaming output.  No tests dir
  -> friendly message pointing at the template's starter test.

Zone-1-ish: ``autoreg`` + stdlib only - no ``stitch_backend`` imports.
The attach pattern (spawn with ``stderr=PIPE`` + reader thread + manual
``RpcPluginClient._proc`` assignment) mirrors
``ServicePluginHost._attach_rpc`` locally without importing the host.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from autoreg.plugin.manifest import MANIFEST_FILENAME, ManifestValidationError
from autoreg.plugin.manifest import validate_manifest
from autoreg.plugin.rpc import (
    RpcCallError,
    RpcPluginClient,
    RpcProtocolError,
    RpcTimeoutError,
)

# Reverse-RPC methods the playground stubs (mirrors the host-side
# ``register_engine_handlers`` surface in ``spi_builtin_oauth``).  Any
# ``engine.oauth.*`` method not listed here still gets a stub response
# via the ``_RunRpcPluginClient._handle_plugin_request`` override -
# the explicit list is just for the ``help`` banner.
_ENGINE_OAUTH_STUB_METHODS = (
    "engine.oauth.start_pkce_flow",
    "engine.oauth.start_device_flow",
    "engine.oauth.exchange_code",
)

# Exit codes (mirrors the rest of the CLI).
_RC_OK = 0
_RC_BAD_PACKAGE = 2
_RC_RUNTIME_FAILURE = 1

# Ring buffer size for the ``logs`` built-in.
_LOG_RING_SIZE = 50

# Default per-call timeout for the REPL (seconds).  Generous so a slow
# command does not kill the child mid-session; the author can Ctrl-C.
_DEFAULT_CALL_TIMEOUT = 30.0

# Init handshake timeout (seconds).
_INIT_TIMEOUT = 10.0


class _RunRpcPluginClient(RpcPluginClient):
    """``RpcPluginClient`` with ``engine.oauth.*`` reverse-RPC stubs.

    Overrides ``_handle_plugin_request`` to intercept any
    ``engine.oauth.*`` method: prints the request to the tool's stderr
    (so the author sees what the plugin asked for) and writes a stub
    JSON-RPC error response so the plugin's ``call_host`` raises
    ``RpcCallError`` with a clear message instead of hanging.
    """

    def __init__(self, *, plugin_id: str, stderr_writer: Any,
                 default_timeout: float = _DEFAULT_CALL_TIMEOUT) -> None:
        super().__init__(default_timeout=default_timeout)
        self._plugin_id = plugin_id
        self._stderr_writer = stderr_writer

    def _handle_plugin_request(
        self, rid: int, method: str, params: dict[str, Any]
    ) -> None:
        if method.startswith("engine.oauth."):
            self._stderr_writer.write(
                f"[stub] reverse-RPC request: {method} "
                f"{json.dumps(params, ensure_ascii=False)}\n"
            )
            self._write_line(
                {
                    "jsonrpc": "2.0",
                    "id": rid,
                    "error": {
                        "code": -32603,
                        "message": "oauth stub: not available in run mode",
                    },
                }
            )
            return
        super()._handle_plugin_request(rid, method, params)


class _StderrWriter:
    """Thread-safe stderr writer that prefixes each line with the plugin id."""

    def __init__(self, plugin_id: str) -> None:
        self._prefix = f"[{plugin_id}]"
        self._lock = threading.Lock()

    def write(self, line: str) -> None:
        with self._lock:
            try:
                sys.stderr.write(f"{self._prefix} {line}")
                sys.stderr.flush()
            except (BrokenPipeError, OSError, ValueError):
                pass


def _read_manifest(package_dir: Path) -> Any:
    """Parse + validate the manifest; return the PluginManifest.

    Raises ``ValueError`` on any failure (caller maps to rc=2).
    """
    manifest_path = package_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        raise ValueError(
            f"no {MANIFEST_FILENAME} found in {package_dir}"
        )
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(
            f"failed to parse {manifest_path}: {exc}"
        ) from exc
    try:
        return validate_manifest(raw)
    except ManifestValidationError as exc:
        raise ValueError(f"invalid manifest: {exc}") from exc


def _resolve_module_dir(package_dir: Path, manifest: Any) -> Path:
    """Resolve the Python package dir holding ``__main__.py``.

    Prefers ``entry.module``; falls back to the single subdir with
    ``__main__.py`` (mirrors ``upgrade._package_module_dir``).
    """
    module = manifest.entry.get("module")
    if isinstance(module, str) and module:
        candidate = package_dir / module
        if candidate.is_dir():
            return candidate
    candidates = [
        d for d in package_dir.iterdir()
        if d.is_dir() and (d / "__main__.py").is_file()
    ]
    if len(candidates) == 1:
        return candidates[0]
    raise ValueError(
        f"could not resolve entry.module dir under {package_dir} "
        f"(manifest entry.module={module!r})"
    )


def _spawn_plugin(
    package_dir: Path, module_dir: Path, module: str
) -> subprocess.Popen[bytes]:
    """Spawn the plugin child with stderr=PIPE (for live streaming).

    Mirrors the host's spawn contract: ``python -m <module>`` with
    ``cwd=package_dir``.  ``stdin=PIPE`` + ``stdout=PIPE`` are wired by
    ``RpcPluginClient`` via the attach pattern (we set ``_proc`` after
    spawning here so the client reuses our Popen with the live stderr
    pipe - ``RpcPluginClient.start`` would DEVNULL stderr, which we
    must avoid for the playground).
    """
    cmd = [sys.executable, "-m", module]
    try:
        return subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(package_dir),
        )
    except OSError as exc:
        raise RuntimeError(f"failed to spawn plugin child: {exc}") from exc


def _start_stderr_reader(
    proc: subprocess.Popen[bytes], ring: deque[str], writer: _StderrWriter
) -> threading.Thread:
    """Start a daemon thread that streams child stderr to tool stderr + ring."""
    def _reader() -> None:
        stream = proc.stderr
        if stream is None:
            return
        try:
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    continue
                ring.append(line)
                writer.write(line + "\n")
        except Exception:  # noqa: BLE001 - pipe closed / process dead
            pass

    t = threading.Thread(target=_reader, name="runtool-stderr", daemon=True)
    t.start()
    return t


def _attach_client(
    proc: subprocess.Popen[bytes],
    *,
    plugin_id: str,
    data_dir: Path,
    db_path: Path,
    migrations: bool,
    writer: _StderrWriter,
) -> _RunRpcPluginClient:
    """Attach a ``_RunRpcPluginClient`` to an already-spawned Popen.

    Mirrors ``ServicePluginHost._attach_rpc``: set ``_proc`` directly,
    start the reader thread, perform the ``plugin.init`` handshake, and
    call ``_migrate_db`` when the manifest declares storage migrations.
    """
    init_params = {
        "engine_api": 2,
        "plugin_id": plugin_id,
        "data_dir": str(data_dir),
        "db_path": str(db_path),
        "supported": ["reverse_rpc", "caller_identity"],
    }
    client = _RunRpcPluginClient(
        plugin_id=plugin_id, stderr_writer=writer,
        default_timeout=_DEFAULT_CALL_TIMEOUT,
    )
    client._proc = proc
    client._closed = False
    client._reader = threading.Thread(
        target=client._reader_loop, name="rpc-reader", daemon=True
    )
    client._reader.start()
    try:
        client._init_result = client._call_internal(
            "plugin.init", init_params, timeout=_INIT_TIMEOUT
        )
    except (RpcTimeoutError, RpcProtocolError):
        client.kill()
        raise
    if migrations:
        try:
            client.call(
                "_migrate_db",
                {"from_version": 0, "to_version": 1},
                timeout=_INIT_TIMEOUT,
            )
        except (RpcTimeoutError, RpcProtocolError, RpcCallError):
            # Migration failure is non-fatal for the playground - the
            # author can still exercise non-storage commands.  Surface
            # the warning on stderr so it is visible.
            writer.write(
                "warning: _migrate_db failed; storage commands may error\n"
            )
    return client


def _print_banner(
    client: _RunRpcPluginClient, manifest: Any, writer: _StderrWriter
) -> None:
    """Print the init result + ready banner with the command list."""
    init_result = client.init_result
    print(
        json.dumps(init_result, indent=2, ensure_ascii=False)
        if init_result is not None else "(no init result)"
    )
    print("ready")
    commands = (manifest.contributions.get("commands") or []) if manifest else []
    if commands:
        print("commands:")
        for cmd in commands:
            if not isinstance(cmd, dict):
                continue
            name = cmd.get("name", "?")
            readonly = cmd.get("readonly", False)
            flag = " (readonly)" if readonly else ""
            print(f"  {name}{flag}")
    print(
        "built-ins: ping, init-info, logs, help, exit"
    )
    print(
        f"stubs: {', '.join(m.split('.')[-1] for m in _ENGINE_OAUTH_STUB_METHODS)}"
        " (engine.oauth.* -> stub error)"
    )


def _print_help(manifest: Any) -> None:
    """Print the REPL help."""
    print("REPL grammar: <command> [json-params]")
    print("built-ins:")
    print("  ping           - plugin.ping -> pong")
    print("  init-info      - print init handshake result + capabilities")
    print("  logs           - print last 50 child stderr lines")
    print("  help           - this message")
    print("  exit | quit    - graceful plugin.shutdown (also EOF / Ctrl-C)")
    commands = (manifest.contributions.get("commands") or []) if manifest else []
    if commands:
        print("plugin commands (from manifest):")
        for cmd in commands:
            if not isinstance(cmd, dict):
                continue
            name = cmd.get("name", "?")
            readonly = cmd.get("readonly", False)
            flag = " (readonly)" if readonly else ""
            print(f"  {name}{flag}")


def _handle_repl_line(
    line: str,
    client: _RunRpcPluginClient,
    manifest: Any,
    ring: deque[str],
) -> bool:
    """Handle one REPL line.  Returns True if the REPL should exit."""
    line = line.strip()
    if not line or line.startswith("#"):
        return False
    parts = line.split(None, 1)
    command = parts[0]
    params_json = parts[1] if len(parts) > 1 else ""

    # Built-ins.
    if command in ("exit", "quit"):
        return True
    if command == "help":
        _print_help(manifest)
        return False
    if command == "ping":
        try:
            client.ping(timeout=_DEFAULT_CALL_TIMEOUT)
            print("pong")
        except (RpcTimeoutError, RpcProtocolError) as exc:
            print(f"[error] ping failed: {exc}", file=sys.stderr)
        return False
    if command == "init-info":
        result = client.init_result
        print(
            json.dumps(result, indent=2, ensure_ascii=False)
            if result is not None else "(no init result)"
        )
        return False
    if command == "logs":
        lines = list(ring)
        if not lines:
            print("(no stderr captured)")
        else:
            for entry in lines:
                print(entry)
        return False

    # Plugin command: parse params JSON.
    if params_json:
        try:
            params = json.loads(params_json)
        except json.JSONDecodeError as exc:
            print(
                f"[error] invalid JSON params: {exc}", file=sys.stderr
            )
            return False
        if not isinstance(params, dict):
            print(
                "[error] JSON params must be an object", file=sys.stderr
            )
            return False
    else:
        params = {}

    try:
        result = client.call(command, params, timeout=_DEFAULT_CALL_TIMEOUT)
    except RpcCallError as exc:
        # RpcCallError stores code/data but not message; str(exc) is
        # ``[<code>] <message>``.  The plugin's _dispatch wraps the
        # original call_host error as ``str(exc)`` in its own error
        # response, so the code prefix may appear twice — that's fine,
        # the author sees the full chain.
        print(f"[error {exc.code}] {exc}")
        return False
    except RpcTimeoutError:
        print(
            f"[error] call '{command}' timed out after "
            f"{_DEFAULT_CALL_TIMEOUT}s", file=sys.stderr
        )
        return False
    except RpcProtocolError as exc:
        print(f"[error] protocol: {exc}", file=sys.stderr)
        return True  # stream broken - exit the REPL.

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return False


def _graceful_shutdown(client: _RunRpcPluginClient) -> None:
    """Best-effort graceful plugin.shutdown; kill fallback on failure."""
    try:
        client.shutdown(drain_timeout=3.0)
    except Exception:  # noqa: BLE001 - best-effort during teardown
        client.kill()


def run_package(package_dir: Path) -> int:
    """Run the interactive plugin REPL for ``package_dir``.

    Returns exit code 0 (clean), 2 (bad package), or 1 (runtime failure).
    """
    package_dir = package_dir.resolve()
    if not package_dir.is_dir():
        print(
            f"error: package dir not found: {package_dir}", file=sys.stderr
        )
        return _RC_BAD_PACKAGE

    # 1. Validate manifest + resolve module dir.
    try:
        manifest = _read_manifest(package_dir)
        module_dir = _resolve_module_dir(package_dir, manifest)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return _RC_BAD_PACKAGE

    module = manifest.entry.get("module") or module_dir.name

    # 2. Refresh _vendor/ (idempotent) so standalone packages are current.
    try:
        from stitch_plugin_tools.vendoring import vendor_rpc_server
        vendor_rpc_server(module_dir)
    except Exception as exc:  # noqa: BLE001 - non-fatal
        print(
            f"warning: vendor refresh failed: {exc}", file=sys.stderr
        )

    # 3. Prepare data_dir + db_path under system temp.
    plugin_id = manifest.id
    data_dir = Path(tempfile.gettempdir()) / f"stitch-run-{plugin_id}"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "plugin.db"

    # 4. Spawn + attach.
    writer = _StderrWriter(plugin_id)
    try:
        proc = _spawn_plugin(package_dir, module_dir, module)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return _RC_RUNTIME_FAILURE

    ring: deque[str] = deque(maxlen=_LOG_RING_SIZE)
    stderr_thread = _start_stderr_reader(proc, ring, writer)

    storage = (manifest.contributions.get("storage") or {}) if manifest else {}
    migrations = bool(storage.get("migrations"))

    try:
        client = _attach_client(
            proc,
            plugin_id=plugin_id,
            data_dir=data_dir,
            db_path=db_path,
            migrations=migrations,
            writer=writer,
        )
    except (RpcTimeoutError, RpcProtocolError) as exc:
        print(f"error: plugin.init failed: {exc}", file=sys.stderr)
        try:
            proc.kill()
            proc.wait(timeout=2.0)
        except Exception:  # noqa: BLE001
            pass
        return _RC_RUNTIME_FAILURE

    # 5. Banner.
    _print_banner(client, manifest, writer)

    # 6. REPL.
    rc = _RC_OK
    try:
        for raw_line in sys.stdin:
            # Strip trailing newline; pass through to the handler.
            line = raw_line.rstrip("\r\n")
            try:
                should_exit = _handle_repl_line(line, client, manifest, ring)
            except KeyboardInterrupt:
                should_exit = True
            if should_exit:
                break
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        pass
    finally:
        _graceful_shutdown(client)
        # Join the stderr reader so no child output is lost.
        try:
            stderr_thread.join(timeout=2.0)
        except Exception:  # noqa: BLE001
            pass

    return rc


def test_package(package_dir: Path) -> int:
    """Run the venv pytest on ``<package_dir>/tests``.

    Returns pytest's exit code.  No tests dir -> friendly message + 0.
    pytest absent -> error with install hint + 2.  Bad package dir -> 2.
    """
    package_dir = package_dir.resolve()
    if not package_dir.is_dir():
        print(
            f"error: package dir not found: {package_dir}", file=sys.stderr
        )
        return _RC_BAD_PACKAGE

    tests_dir = package_dir / "tests"
    if not tests_dir.is_dir():
        print(
            f"no tests/ directory in {package_dir} - nothing to test."
        )
        print(
            "the template ships tests/test_plugin_protocol.py; copy it"
            " from a fresh `sync-template` run."
        )
        return _RC_OK

    # Verify pytest is importable in the venv.
    probe = subprocess.run(
        [sys.executable, "-c", "import pytest"],
        capture_output=True,
        timeout=10,
    )
    if probe.returncode != 0:
        print(
            "error: pytest is not installed in the current venv.\n"
            "  install with: pip install pytest pytest-timeout",
            file=sys.stderr,
        )
        return _RC_BAD_PACKAGE

    cmd = [
        sys.executable, "-m", "pytest", str(tests_dir),
        "-q", "--timeout=60",
    ]
    try:
        proc = subprocess.run(cmd, cwd=str(package_dir))
    except KeyboardInterrupt:
        return _RC_RUNTIME_FAILURE
    return proc.returncode
