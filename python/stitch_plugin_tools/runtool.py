"""Local plugin-developer playground (plan todo 23 - dev loop).

Three entry points:

* ``run_package(package_dir)`` - interactive plugin REPL.  Spawns the
  plugin child with ``RpcPluginClient`` (re-using the host-side client
  from ``autoreg.plugin.rpc``), streams child stderr live to the tool's
  stderr, drives a line-based REPL on stdin (``<command> [json-params]``
  -> ``plugin.call`` -> pretty-printed result), and stubs reverse-RPC
  ``engine.oauth.*`` and ``host.secrets.*`` requests so plugins that use
  ``server.call_host`` fail gracefully instead of hanging.

* ``run_command(package_dir, command, params)`` - one-shot: run a single
  plugin command non-interactively and exit (machine-readable under
  ``--json``); shares the spawn/attach path with ``run_package``.

Both accept ``--watch``: poll the resolved package source tree by mtime
and rebuild the child (kill-tree + respawn + re-attach) on change.

* ``test_package(package_dir)`` - runs the venv pytest on
  ``<package_dir>/tests`` if present, streaming output.  No tests dir
  -> friendly message pointing at the template's starter test.

Zone-1-ish: ``autoreg`` + stdlib only - no ``stitch_backend`` imports.
The attach sequence (set _proc, start reader, ``plugin.init`` handshake,
``_migrate_db``) is shared with ``ServicePluginHost._attach_rpc`` via
``RpcPluginClient.attach`` — the single code path in ``autoreg.plugin.rpc``.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from autoreg.plugin.childenv import build_child_env
from autoreg.plugin.manifest import (
    MANIFEST_FILENAME,
    ManifestValidationError,
    resolve_entry_command,
    validate_manifest,
)
from autoreg.plugin.rpc import (
    RpcCallError,
    RpcPluginClient,
    RpcProtocolError,
    RpcTimeoutError,
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

# JSON-RPC implementation-defined server-error range (host-side failures).
_ERR_CALL_TIMEOUT = -32001
_ERR_PROTOCOL = -32002

# --watch: _vendor/ is regenerated on every attach, so it must never trigger a reload.
_WATCH_POLL_INTERVAL = 0.3
_WATCH_DEBOUNCE = 0.3
_WATCH_MAX_FAILURES = 20
_WATCH_IGNORE_DIRS = frozenset({"_vendor", "__pycache__"})
_WATCH_IGNORE_SUFFIXES = (".pyc", ".db")
_WATCH_SOURCE_SUFFIXES = (".py",)
_WATCH_SOURCE_NAMES = frozenset({"plugin.json"})

_TRACEBACK_MAX = 2000


class _RunRpcPluginClient(RpcPluginClient):
    """``RpcPluginClient`` with ``engine.oauth.*`` / ``host.secrets.*`` reverse-RPC stubs.

    Overrides ``_handle_plugin_request`` to intercept any
    ``engine.oauth.*`` / ``host.secrets.*`` method: prints the request to
    the tool's stderr (so the author sees what the plugin asked for) and
    writes a stub JSON-RPC error response so the plugin's ``call_host``
    raises ``RpcCallError`` with a clear message instead of hanging.
    """

    def __init__(self, *, stderr_writer: Any,
                 default_timeout: float = _DEFAULT_CALL_TIMEOUT) -> None:
        super().__init__(default_timeout=default_timeout)
        self._stderr_writer = stderr_writer

    def _handle_plugin_request(
        self, rid: int, method: str, params: dict[str, Any]
    ) -> None:
        if method.startswith("engine.oauth."):
            self._stub_reverse_rpc(
                rid, method, json.dumps(params, ensure_ascii=False),
                "oauth stub: not available in run mode",
            )
            return
        if method.startswith("host.secrets."):
            # name only — a secret value must never reach the tool's stderr
            name = params.get("name") if isinstance(params, dict) else None
            self._stub_reverse_rpc(
                rid, method, f"name={name!r}",
                "secrets stub: not available in run mode",
            )
            return
        super()._handle_plugin_request(rid, method, params)

    def _stub_reverse_rpc(
        self, rid: int, method: str, trace: str, message: str
    ) -> None:
        self._stderr_writer.write(
            f"[stub] reverse-RPC request: {method} {trace}\n"
        )
        self._write_line(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {
                    "code": -32603,
                    "message": message,
                },
            }
        )


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


class _RunLock:
    """Exclusive advisory lock on a plugin's run data_dir.

    The OS drops the lock when the process exits, so a crash cannot leave
    a stale lock behind.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._fd: int | None = None

    def acquire(self) -> bool:
        fd = os.open(self._path, os.O_CREAT | os.O_RDWR)
        try:
            if os.name == "nt":
                import msvcrt

                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"\0")
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return False
        self._fd = fd
        return True

    def release(self) -> None:
        fd = self._fd
        if fd is None:
            return
        self._fd = None
        try:
            if os.name == "nt":
                import msvcrt

                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            os.close(fd)


@dataclass
class _RunSession:
    client: _RunRpcPluginClient
    manifest: Any
    writer: _StderrWriter
    ring: deque[str]
    stderr_thread: threading.Thread
    data_dir: Path
    plugin_id: str
    proc: subprocess.Popen[bytes]
    package_dir: Path
    lock: _RunLock


def _prepare_data_dir(
    plugin_id: str, fresh: bool, lock: _RunLock | None
) -> tuple[Path, _RunLock | None]:
    data_dir = Path(tempfile.gettempdir()) / f"stitch-run-{plugin_id}"
    if lock is None:
        lock = _RunLock(data_dir.parent / f"{data_dir.name}.lock")
        if not lock.acquire():
            return data_dir, None
    if fresh and data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir, lock


def parse_params_arg(raw: str | None) -> dict[str, Any]:
    """Parse ``--params``: an inline JSON object or ``@path`` to a JSON file.

    Raises ``ValueError`` on a missing file or non-object JSON.
    """
    if not raw:
        return {}
    if raw.startswith("@"):
        path = Path(raw[1:])
        if not path.is_file():
            raise ValueError(f"params file not found: {path}")
        raw = path.read_text(encoding="utf-8")
    try:
        params = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON params: {exc}") from exc
    if not isinstance(params, dict):
        raise ValueError("JSON params must be an object")
    return params


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
        raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
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


def _minimal_child_env(data_dir: Path) -> dict[str, str]:
    """Build the minimal env for the plugin child.

    Delegates to the shared ``autoreg.plugin.childenv`` contract (the same
    allowlist/PATH the sidecar supervisor uses); TEMP/TMP stay scoped under
    the run session's data_dir and the real HOME is kept for dev convenience.
    """
    scoped_tmp = data_dir / "tmp"
    scoped_tmp.mkdir(parents=True, exist_ok=True)
    return build_child_env(
        {"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        temp_dir=scoped_tmp,
        scope_home=False,
    )


def _spawn_plugin(
    package_dir: Path, module_dir: Path | None, module: str | None, data_dir: Path,
    *, command: list[str] | None = None, new_session: bool = False,
) -> subprocess.Popen[bytes]:
    """Spawn the plugin child with stderr=PIPE (for live streaming).

    Mirrors the host's spawn contract: ``entry.command`` argv when present,
    else ``python -m <module>``, with ``cwd=package_dir``.  ``stdin=PIPE``
    + ``stdout=PIPE`` are wired by ``RpcPluginClient.attach`` (which takes
    our Popen with the live stderr pipe — ``RpcPluginClient.start`` would
    DEVNULL stderr, which we must avoid for the playground).

    The child receives a MINIMAL env (:func:`_minimal_child_env`) — never
    the developer's full environment.  ``new_session`` puts the child in
    its own process group (POSIX) so ``--watch`` can kill the whole tree.
    """
    cmd = list(command) if command is not None else [sys.executable, "-m", module]
    try:
        return subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(package_dir),
            env=_minimal_child_env(data_dir),
            start_new_session=new_session,
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

    Delegates the common attach sequence (set _proc, start reader,
    ``plugin.init`` handshake, ``_migrate_db``) to
    :meth:`RpcPluginClient.attach` — the single code path shared with
    :meth:`ServicePluginHost._attach_rpc`.

    Intentional deltas from host._attach_rpc (documented so the next
    diverger sees them):
      - stderr reader: playground starts it BEFORE attach (in
        ``run_package``) so init-time stderr is visible; the host starts
        it AFTER attach.
      - engine.oauth / host.secrets handlers: playground stubs them via
        ``_RunRpcPluginClient._handle_plugin_request`` (no real OAuth or
        keyring in dev mode); the host registers real handlers via
        ``register_engine_handlers`` / ``register_secret_handlers``.
      - capabilities parsing: playground does not parse (host-only).
      - memory caps: playground has none (host-only).
      - _migrate_db failure: non-fatal (playground continues so the
        author can exercise non-storage commands); the host lets it
        propagate (caught by start()'s error path → supervisor.stop).
    """
    init_params = {
        "engine_api": 2,
        "plugin_id": plugin_id,
        "data_dir": str(data_dir),
        "db_path": str(db_path),
        "supported": ["reverse_rpc", "caller_identity"],
    }
    client = _RunRpcPluginClient(
        stderr_writer=writer,
        default_timeout=_DEFAULT_CALL_TIMEOUT,
    )
    try:
        client.attach(
            proc,
            init_params=init_params,
            timeout=_INIT_TIMEOUT,
            migrate=migrations,
        )
    except (RpcTimeoutError, RpcProtocolError, RpcCallError):
        # Handshake failure (init_result not set) is fatal — re-raise so
        # run_package kills the child and returns _RC_RUNTIME_FAILURE.
        if client.init_result is None:
            raise
        # _migrate_db failure — non-fatal: the client is attached,
        # storage commands may error later.  Surface a warning.
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
    print("stubs: engine.oauth.* -> stub error")
    print("stubs: host.secrets.* -> stub error")


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
        fields = _envelope_fields(exc.data)
        line = f"[error {exc.code}] {exc}"
        if fields.get("kind"):
            line += f" (kind={fields['kind']})"
        print(line)
        if fields.get("traceback"):
            print(fields["traceback"])
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


def _open_session(
    package_dir: Path, *, fresh: bool, new_session: bool = False,
    lock: _RunLock | None = None,
) -> tuple[int, _RunSession | None]:
    """Validate, vendor, spawn and attach a plugin child.

    Returns ``(rc, session)``; ``session`` is ``None`` when setup failed.
    """
    package_dir = package_dir.resolve()
    if not package_dir.is_dir():
        print(
            f"error: package dir not found: {package_dir}", file=sys.stderr
        )
        return _RC_BAD_PACKAGE, None

    try:
        manifest = _read_manifest(package_dir)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return _RC_BAD_PACKAGE, None

    command = resolve_entry_command(manifest.entry, package_dir)
    module_dir: Path | None = None
    module: str | None = None
    if command is None:
        try:
            module_dir = _resolve_module_dir(package_dir, manifest)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return _RC_BAD_PACKAGE, None
        module = manifest.entry.get("module") or module_dir.name

        from stitch_plugin_tools.vendoring import (
            CanonicalRpcSourceError,
            vendor_all,
        )

        try:
            vendor_all(module_dir)
        except CanonicalRpcSourceError as exc:
            # best-effort here; publish/dev-install re-raise this
            print(f"warning: vendor refresh failed: {exc}", file=sys.stderr)

    plugin_id = manifest.id
    data_dir, lock = _prepare_data_dir(plugin_id, fresh, lock)
    if lock is None:
        print(
            f"error: another run of {plugin_id} is active "
            f"(data_dir {data_dir} is locked)",
            file=sys.stderr,
        )
        return _RC_RUNTIME_FAILURE, None
    db_path = data_dir / "plugin.db"

    writer = _StderrWriter(plugin_id)
    try:
        proc = _spawn_plugin(
            package_dir, module_dir, module, data_dir,
            command=command, new_session=new_session,
        )
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return _RC_RUNTIME_FAILURE, None

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
    except (RpcTimeoutError, RpcProtocolError, RpcCallError) as exc:
        print(f"error: plugin.init failed: {exc}", file=sys.stderr)
        _kill_tree(proc)
        return _RC_RUNTIME_FAILURE, None

    session = _RunSession(
        client=client,
        manifest=manifest,
        writer=writer,
        ring=ring,
        stderr_thread=stderr_thread,
        data_dir=data_dir,
        plugin_id=plugin_id,
        proc=proc,
        package_dir=package_dir,
        lock=lock,
    )
    return _RC_OK, session


def _emit_json(event: dict[str, Any]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def _envelope_fields(data: object) -> dict[str, str]:
    if not isinstance(data, dict):
        return {}
    fields: dict[str, str] = {}
    kind = data.get("kind")
    if isinstance(kind, str) and kind:
        fields["kind"] = kind
    trace = data.get("traceback")
    if isinstance(trace, str) and trace:
        fields["traceback"] = trace[-_TRACEBACK_MAX:]
    return fields


def _command_names(manifest: Any) -> list[str]:
    commands = (manifest.contributions.get("commands") or []) if manifest else []
    return [
        cmd["name"]
        for cmd in commands
        if isinstance(cmd, dict) and cmd.get("name")
    ]


def _emit_ready(session: _RunSession) -> None:
    _emit_json(
        {
            "event": "ready",
            "plugin_id": session.plugin_id,
            "commands": _command_names(session.manifest),
            "data_dir": str(session.data_dir),
        }
    )


def _report_call_error(
    command: str,
    code: int,
    message: str,
    *,
    json_output: bool,
    data: object = None,
) -> int:
    fields = _envelope_fields(data)
    if json_output:
        error: dict[str, Any] = {"code": code, "message": message}
        error.update(fields)
        _emit_json(
            {
                "event": "call",
                "command": command,
                "ok": False,
                "error": error,
            }
        )
    else:
        suffix = f" (kind={fields['kind']})" if fields.get("kind") else ""
        print(f"[error {code}] {message}{suffix}", file=sys.stderr)
        if fields.get("traceback"):
            print(fields["traceback"], file=sys.stderr)
    return _RC_RUNTIME_FAILURE


def _run_one_command(
    session: _RunSession,
    command: str,
    params: dict[str, Any],
    *,
    json_output: bool,
) -> int:
    try:
        result = session.client.call(
            command, params, timeout=_DEFAULT_CALL_TIMEOUT
        )
    except RpcCallError as exc:
        return _report_call_error(
            command,
            exc.code,
            str(exc),
            json_output=json_output,
            data=exc.data,
        )
    except RpcTimeoutError:
        message = f"call '{command}' timed out after {_DEFAULT_CALL_TIMEOUT}s"
        return _report_call_error(
            command, _ERR_CALL_TIMEOUT, message, json_output=json_output
        )
    except RpcProtocolError as exc:
        return _report_call_error(
            command, _ERR_PROTOCOL, str(exc), json_output=json_output
        )
    if json_output:
        _emit_json(
            {
                "event": "call",
                "command": command,
                "ok": True,
                "result": result,
            }
        )
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    return _RC_OK


def _is_watch_source(name: str) -> bool:
    return name in _WATCH_SOURCE_NAMES or name.endswith(_WATCH_SOURCE_SUFFIXES)


def _snapshot_sources(package_dir: Path, data_dir: Path) -> dict[str, int]:
    """Map each watched source file (relpath -> mtime_ns) under package_dir."""
    data_dir = data_dir.resolve()
    snapshot: dict[str, int] = {}
    for root, dirs, files in os.walk(package_dir):
        dirs[:] = [d for d in dirs if d not in _WATCH_IGNORE_DIRS]
        root_path = Path(root)
        for name in files:
            if name.endswith(_WATCH_IGNORE_SUFFIXES) or not _is_watch_source(name):
                continue
            path = root_path / name
            try:
                resolved = path.resolve()
                if resolved == data_dir or data_dir in resolved.parents:
                    continue
                mtime = path.stat().st_mtime_ns
            except OSError:
                continue
            snapshot[str(path.relative_to(package_dir))] = mtime
    return snapshot


def _diff_snapshots(old: dict[str, int], new: dict[str, int]) -> list[str]:
    changed = {rel for rel, mtime in new.items() if old.get(rel) != mtime}
    changed.update(rel for rel in old if rel not in new)
    return sorted(changed)


def _kill_tree(proc: subprocess.Popen[bytes]) -> None:
    """Kill the child and its whole process tree (stdlib only)."""
    pid = proc.pid
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(pid)],
                capture_output=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except OSError:
            pass
    try:
        proc.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        pass


def _teardown_session(session: _RunSession) -> None:
    """Graceful shutdown, then kill-tree fallback; join the stderr reader."""
    _graceful_shutdown(session.client)
    if session.proc.poll() is None:
        _kill_tree(session.proc)
    try:
        session.stderr_thread.join(timeout=2.0)
    except Exception:  # noqa: BLE001 - best-effort teardown
        pass
    session.lock.release()


def _start_stdin_pump() -> queue.Queue[str | None]:
    """Feed stdin lines into a queue; push None on EOF (the stop signal)."""
    lines: queue.Queue[str | None] = queue.Queue()

    def _pump() -> None:
        try:
            for raw in sys.stdin:
                lines.put(raw.rstrip("\r\n"))
        except Exception:  # noqa: BLE001 - stdin closed / detached
            pass
        finally:
            lines.put(None)

    threading.Thread(target=_pump, name="runtool-stdin", daemon=True).start()
    return lines


def _reload_session(
    session: _RunSession, changed: list[str], *, json_output: bool
) -> _RunSession | None:
    """Kill the child tree, respawn + re-attach; emit a reload event."""
    old_pid = session.proc.pid
    _kill_tree(session.proc)
    session.client.kill()
    try:
        session.stderr_thread.join(timeout=2.0)
    except Exception:  # noqa: BLE001 - best-effort teardown
        pass

    rc, new_session = _open_session(
        session.package_dir,
        fresh=False,
        new_session=True,
        lock=session.lock,
    )
    if new_session is None:
        if json_output:
            _emit_json(
                {
                    "event": "reload",
                    "old_pid": old_pid,
                    "new_pid": None,
                    "changed": changed,
                    "ok": False,
                    "error": f"re-attach failed (rc={rc})",
                }
            )
        else:
            print(f"[watch] reload failed (rc={rc}); stopping", file=sys.stderr)
        return None

    if json_output:
        _emit_json(
            {
                "event": "reload",
                "old_pid": old_pid,
                "new_pid": new_session.proc.pid,
                "changed": changed,
                "ok": True,
            }
        )
    else:
        print(
            f"[watch] reloaded {old_pid} -> {new_session.proc.pid}: "
            f"{', '.join(changed)}",
            flush=True,
        )
    return new_session


def _watch_loop(
    package_dir: Path,
    *,
    fresh: bool,
    json_output: bool,
    interactive: bool,
    command: str | None = None,
    params: dict[str, Any] | None = None,
) -> int:
    """Run one command (or a REPL) and rebuild the child on each source change."""
    rc, session = _open_session(package_dir, fresh=fresh, new_session=True)
    if session is None:
        return rc

    snapshot = _snapshot_sources(session.package_dir, session.data_dir)
    if json_output:
        _emit_ready(session)
    elif interactive:
        _print_banner(session.client, session.manifest, session.writer)
    lines = _start_stdin_pump()

    try:
        if not interactive:
            _run_one_command(session, command, params, json_output=json_output)
        while True:
            try:
                line = lines.get(timeout=_WATCH_POLL_INTERVAL)
            except queue.Empty:
                pass
            else:
                if line is None:
                    return _RC_OK
                if interactive:
                    try:
                        should_exit = _handle_repl_line(
                            line, session.client, session.manifest, session.ring
                        )
                    except KeyboardInterrupt:
                        should_exit = True
                    if should_exit:
                        return _RC_OK
            new_snapshot = _snapshot_sources(session.package_dir, session.data_dir)
            changed = _diff_snapshots(snapshot, new_snapshot)
            if not changed:
                continue
            snapshot = new_snapshot
            reloaded = _reload_session(session, changed, json_output=json_output)
            if reloaded is None:
                continue
            session = reloaded
            if interactive:
                if not json_output:
                    _print_banner(session.client, session.manifest, session.writer)
            else:
                _run_one_command(session, command, params, json_output=json_output)
    except KeyboardInterrupt:
        return _RC_OK
    finally:
        _teardown_session(session)


def run_command(
    package_dir: Path,
    command: str,
    params: dict[str, Any],
    *,
    fresh: bool = False,
    json_output: bool = False,
    watch: bool = False,
) -> int:
    """Run one plugin command non-interactively, then shut the child down.

    Returns 0 (success), 1 (runtime failure), or 2 (bad package).  With
    ``json_output`` the ready/result/error events are emitted as JSONL on
    stdout instead of pretty-printed output.  With ``watch`` the command
    re-runs after each source change until stdin closes or Ctrl-C.
    """
    if watch:
        return _watch_loop(
            package_dir, fresh=fresh, json_output=json_output,
            interactive=False, command=command, params=params,
        )
    rc, session = _open_session(package_dir, fresh=fresh)
    if session is None:
        return rc

    if json_output:
        _emit_ready(session)
    try:
        return _run_one_command(
            session, command, params, json_output=json_output
        )
    finally:
        _graceful_shutdown(session.client)
        try:
            session.stderr_thread.join(timeout=2.0)
        except Exception:  # noqa: BLE001
            pass


def run_package(
    package_dir: Path, *, fresh: bool = False, watch: bool = False,
    json_output: bool = False,
) -> int:
    """Run the interactive plugin REPL for ``package_dir``.

    Returns exit code 0 (clean), 2 (bad package), or 1 (runtime failure).
    With ``watch`` the child is rebuilt on each source change.
    """
    if watch:
        return _watch_loop(
            package_dir, fresh=fresh, json_output=json_output, interactive=True,
        )
    rc, session = _open_session(package_dir, fresh=fresh)
    if session is None:
        return rc

    _print_banner(session.client, session.manifest, session.writer)

    rc = _RC_OK
    try:
        for raw_line in sys.stdin:
            line = raw_line.rstrip("\r\n")
            try:
                should_exit = _handle_repl_line(
                    line, session.client, session.manifest, session.ring
                )
            except KeyboardInterrupt:
                should_exit = True
            if should_exit:
                break
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        pass
    finally:
        _graceful_shutdown(session.client)
        try:
            session.stderr_thread.join(timeout=2.0)
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
