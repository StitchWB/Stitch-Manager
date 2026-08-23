"""Scaffold a new service-plugin package (plan todo 19).

Generates a self-contained ``kind=service`` plugin directory:

    plugin.json          — v2 manifest template (contributions + storage)
    <pkg>/__init__.py    — package marker
    <pkg>/__main__.py    — RPC entry using ``autoreg.plugin.rpc.RpcPluginServer``
                           (with an inline fallback for standalone operation)
    <pkg>/storage.py     — SQLite helper (WAL, migrate, CRUD)
    README.md            — dev loop quickstart

The generated package is unsigned.  Sign with::

    python -m stitch_plugin_tools sign <out_dir> --key <private.key>

then ``dev-install`` or ``publish``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from autoreg.plugin.manifest import MANIFEST_FILENAME, SCHEMA_ID_V2

# Scaffold version — bumped when the canonical conventions change.
# v1 = pre-marker historical (no _generated_by marker, no generated_by field).
# v2 = current conventions (_Ctx class, _uid helper, service.py stub,
#      health_check demo command, nested i18n, i18n-key tab labels,
#      byte-identical inline RpcPluginServer fallback, capabilities: []
#      in init result, _generated_by marker + manifest generated_by field).
SCAFFOLD_VERSION = 2

# Marker written as the first line after the module docstring in every
# generated ``__main__.py`` / ``service.py`` / ``storage.py``.  ``upgrade``
# parses it to detect which scaffold generation a package came from.
MARKER_PREFIX = "# _generated_by: stitch_plugin_tools scaffold v"


def marker_line(version: int = SCAFFOLD_VERSION) -> str:
    """The ``_generated_by`` marker comment for a scaffold version."""
    return f"{MARKER_PREFIX}{version}"

# Plugin id charset (matches manifest._PLUGIN_ID_RE).
_PLUGIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")

# Canonical manifest fields for the current scaffold conventions.
# ``upgrade`` rewrites exactly these generated fields in authored
# manifests — everything else (contributions, signature, …) is preserved.
CANONICAL_ENGINE: dict[str, Any] = {"min": "0.3.0", "api": 2}


def generated_by_field() -> dict[str, Any]:
    """Manifest ``generated_by`` extra for the current scaffold version."""
    return {"tool": "stitch_plugin_tools", "scaffold": SCAFFOLD_VERSION}


def _pkg_name(plugin_id: str) -> str:
    """Convert a plugin id to a valid Python package name.

    ``my-plugin`` -> ``my_plugin``.  The package name is a valid Python
    identifier used as ``entry.module`` in the manifest and the directory
    name for the Python package.
    """
    return plugin_id.replace("-", "_")


def _validate_plugin_id(plugin_id: str) -> str:
    """Raise ``ValueError`` if the id is not a safe plugin id."""
    if not _PLUGIN_ID_RE.match(plugin_id):
        raise ValueError(
            f"invalid plugin id {plugin_id!r}: must match [A-Za-z0-9_-] "
            "(no dots, no path separators)"
        )
    return plugin_id


# ── Templates ────────────────────────────────────────────────────────────

_MAIN_TEMPLATE = '''"""RPC entry point for the {plugin_id} service plugin.

Spawned by ``ServicePluginHost`` as ``python -m {pkg_name}``.
Implements the JSON-RPC 2.0 line protocol via ``RpcPluginServer``.

Protocol methods handled automatically by ``RpcPluginServer``:
  - ``plugin.init``    -> stores handshake params via ``_Ctx``.
  - ``plugin.ping``    -> returns ``"pong"``.
  - ``plugin.shutdown``-> returns ``None`` and exits.

``plugin.call`` dispatches to registered handlers.  ``_migrate_db``
is a reserved call name used by the host after init to create SQLite
tables (when ``contributions.storage.migrations`` is set).

Self-contained: tries to import ``RpcPluginServer`` from
``autoreg.plugin.rpc`` (available when ``autoreg`` is on ``sys.path``).
If the import fails (standalone plugin without the host's python tree),
an inline equivalent is used — same protocol, no external dependency.
"""

# _generated_by: stitch_plugin_tools scaffold v{scaffold_version}

from __future__ import annotations

import json
import sys
from typing import Any

from . import service, storage

try:
    from autoreg.plugin.rpc import RpcPluginServer
except ImportError:
    import threading
    import time

    class RpcPluginServer:
        """Inline stdio JSON-RPC 2.0 server (protocol-equivalent fallback).

        Handles plugin.init/ping/shutdown/call dispatch, handler
        exceptions → -32603, unknown method → -32601, and reverse-RPC
        call_host with queued-line processing.  Uses
        sys.stdin.readline() (not ``for line in sys.stdin``) so call_host
        can interleave reads without the iterator's buffering.
        """

        def __init__(self) -> None:
            self._handlers: dict[str, Any] = {{}}
            self._init_handler: Any = None
            self._request_handlers: dict[str, Any] = {{}}
            self._next_request_id = 1
            self._request_id_lock = threading.Lock()
            self._queued_lines: list[str] = []

        def register(self, name: str, handler: Any) -> None:
            self._handlers[name] = handler

        def set_init_handler(self, handler: Any) -> None:
            self._init_handler = handler

        def set_request_handler(self, name: str, handler: Any) -> None:
            self._request_handlers[name] = handler

        def _next_request_id_locked(self) -> int:
            with self._request_id_lock:
                rid = self._next_request_id
                self._next_request_id += 1
                return rid

        def call_host(self, method: str, params: dict[str, Any] | None = None, timeout: float = 30.0) -> Any:
            rid = self._next_request_id_locked()
            req = {{"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {{}}}}
            sys.stdout.write(json.dumps(req, ensure_ascii=False) + "\\n")
            sys.stdout.flush()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                raw = sys.stdin.readline()
                if not raw:
                    raise RuntimeError("stdin closed while waiting for host response")
                line = raw.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(obj, dict):
                    continue
                obj_id = obj.get("id")
                has_result = "result" in obj
                has_error = "error" in obj and obj["error"] is not None
                obj_method = obj.get("method")
                if obj_id == rid and has_result and obj_method is None:
                    return obj["result"]
                if obj_id == rid and has_error and obj_method is None:
                    err = obj["error"]
                    if isinstance(err, dict):
                        raise RuntimeError(f"host error [{{err.get('code', -32603)}}]: {{err.get('message', '')}}")
                    raise RuntimeError(str(err))
                self._queued_lines.append(line)
            raise TimeoutError(f"call_host {{method}} (id={{rid}}) timed out after {{timeout}}s")

        def serve(self) -> None:
            while True:
                while self._queued_lines:
                    queued = self._queued_lines.pop(0)
                    if self._process_line(queued):
                        return
                raw = sys.stdin.readline()
                if not raw:
                    break
                line = raw.strip()
                if not line:
                    continue
                if self._process_line(line):
                    return

        def _process_line(self, line: str) -> bool:
            try:
                req = json.loads(line)
            except (ValueError, TypeError):
                return False
            if not isinstance(req, dict):
                return False
            rid = req.get("id")
            method = req.get("method", "")
            params = req.get("params", {{}})
            if not isinstance(params, dict):
                params = {{}}
            result = self._dispatch(method, params)
            self._send_response(rid, result)
            return method == "plugin.shutdown"

        def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
            try:
                if method == "plugin.init":
                    if self._init_handler is not None:
                        return self._init_handler(params)
                    return params
                if method == "plugin.ping":
                    return "pong"
                if method == "plugin.shutdown":
                    return None
                if method == "plugin.call":
                    name = params.get("name", "")
                    args = params.get("params", {{}})
                    if not isinstance(args, dict):
                        args = {{}}
                    handler = self._handlers.get(name)
                    if handler is None:
                        return {{"error": {{"code": -32601, "message": f"method not found: {{name}}"}}}}
                    return handler(args)
                return {{"error": {{"code": -32601, "message": f"unknown method: {{method}}"}}}}
            except Exception as exc:  # noqa: BLE001
                return {{"error": {{"code": -32603, "message": str(exc)}}}}

        @staticmethod
        def _send_response(rid: Any, result: Any) -> None:
            if isinstance(result, dict) and "error" in result:
                obj = {{"jsonrpc": "2.0", "id": rid, "error": result["error"]}}
            else:
                obj = {{"jsonrpc": "2.0", "id": rid, "result": result}}
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\\n")
            sys.stdout.flush()


# ── State received in plugin.init handshake ───────────────────────────────


class _Ctx:
    """Mutable container for plugin.init handshake state."""

    db_path: str = ""
    data_dir: str = ""
    supported: list[str] = []


ctx = _Ctx()


def _uid(params: dict[str, Any]) -> int | None:
    """Caller user id forwarded by the dual-format router (None = guest)."""
    uid = params.get("caller_user_id")
    return int(uid) if uid is not None else None


def _handle_init(params: dict[str, Any]) -> dict[str, Any]:
    """Store handshake params and return them as the init result.

    ``supported`` lists the optional host features available in this
    session (e.g. ``reverse_rpc``, ``caller_identity``).  Declare the
    plugin's own opt-in features in the ``capabilities`` result field
    (e.g. ``["reverse_rpc"]`` when using ``server.call_host``).
    """
    ctx.db_path = str(params.get("db_path", ""))
    ctx.data_dir = str(params.get("data_dir", ""))
    supported = params.get("supported")
    ctx.supported = list(supported) if isinstance(supported, list) else []
    return {{
        "plugin_id": params.get("plugin_id", ""),
        "db_path": ctx.db_path,
        "data_dir": ctx.data_dir,
        "capabilities": [],
    }}


def _handle_migrate_db(params: dict[str, Any]) -> dict[str, Any]:
    """Create SQLite tables (raw_sql migration).

    For plugins with ``contributions.storage.sqlite = false`` (e.g.
    cards/opencode/radar), use the no-op variant that returns the
    version ack without touching the database::

        return {{
            "from_version": params.get("from_version", 0),
            "to_version": params.get("to_version", 1),
        }}
    """
    if ctx.db_path:
        storage.migrate(ctx.db_path)
    return {{
        "from_version": params.get("from_version", 0),
        "to_version": params.get("to_version", 1),
    }}


def _handle_health_check(params: dict[str, Any]) -> dict[str, Any]:
    """Health-check command — returns pong."""
    return service.health_check()


def _handle_echo(params: dict[str, Any]) -> dict[str, Any]:
    """Echo the ``text`` param back to the caller."""
    _uid(params)  # caller identity available for per-user logic
    return service.echo(str(params.get("text", "")))


# ── Server entry point ────────────────────────────────────────────────────

def main() -> None:
    """Register handlers and serve the JSON-RPC loop."""
    server = RpcPluginServer()
    server.set_init_handler(_handle_init)
    server.register("_migrate_db", _handle_migrate_db)
    server.register("health_check", _handle_health_check)
    server.register("echo", _handle_echo)
    server.serve()


if __name__ == "__main__":
    main()
'''

# ── Canonical inline fallback block ──────────────────────────────────────
# The byte-exact inline ``RpcPluginServer`` fallback embedded in every
# generated ``__main__.py`` — from the ``try:`` import guard through the
# end of the class (5730 bytes, LF-normalized; locked by
# test_sdk_scaffold_service_plugin).  Derived from ``_MAIN_TEMPLATE``
# (which stays the single source of truth) by un-doubling the format
# braces.  ``stitch_plugin_tools upgrade`` swaps this region wholesale
# between scaffold versions — the text itself is never modified.
_FALLBACK_ANCHOR_START = "try:\n    from autoreg.plugin.rpc import RpcPluginServer"
_FALLBACK_ANCHOR_END = "\n\n\n# ── State received"
_RPC_FALLBACK_BLOCK = (
    _MAIN_TEMPLATE[
        _MAIN_TEMPLATE.index(_FALLBACK_ANCHOR_START) : _MAIN_TEMPLATE.index(
            _FALLBACK_ANCHOR_END
        )
    ]
    .replace("{{", "{")
    .replace("}}", "}")
    .rstrip("\n")
    + "\n"
)

_STORAGE_TEMPLATE = '''"""SQLite storage for this service plugin.

The plugin owns its own SQLite database at ``db_path`` (received in the
``plugin.init`` handshake).  Tables are created on ``_migrate_db``.
Replace this with your own schema as needed.
"""

# _generated_by: stitch_plugin_tools scaffold v{scaffold_version}

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any


def _connect(db_path: str) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode for concurrent reads."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def migrate(db_path: str) -> None:
    """Create tables if they do not exist (raw_sql migration).

    Replace with your own schema.  This example creates a simple
    ``items`` table.
    """
    conn = _connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def list_items(db_path: str) -> list[dict[str, Any]]:
    """Return all items from local storage."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT id, text FROM items ORDER BY created_at DESC"
        ).fetchall()
        return [{{"id": r["id"], "text": r["text"]}} for r in rows]
    finally:
        conn.close()


def create_item(db_path: str, text: str) -> dict[str, Any]:
    """Insert an item record and return it."""
    item_id = uuid.uuid4().hex[:12]
    conn = _connect(db_path)
    try:
        conn.execute(
            "INSERT INTO items (id, text) VALUES (?, ?)",
            (item_id, text),
        )
        conn.commit()
    finally:
        conn.close()
    return {{"id": item_id, "text": text}}
'''

_SERVICE_TEMPLATE = '''"""Service layer for this service plugin.

Business logic lives here — ``__main__.py`` handlers are thin wrappers
that parse params, call service functions, and return results. This
mirrors the reference plugins (stitch-cards, stitch-totp, …) where
``service.py`` holds the domain logic and ``__main__.py`` only dispatches.

Replace the placeholder functions below with your own domain logic.
"""

# _generated_by: stitch_plugin_tools scaffold v{scaffold_version}

from __future__ import annotations

from typing import Any


def health_check() -> dict[str, Any]:
    """Return a health-check response."""
    return {{"pong": True}}


def echo(text: str) -> dict[str, Any]:
    """Echo the provided text back to the caller."""
    return {{"text": text}}
'''

_README_TEMPLATE = """# {name}

A Stitch service plugin (`{plugin_id}`).

## Quick start (dev loop)

> **Prerequisite:** `stitch_plugin_tools` must be importable. Run
> `pip install -e python/` from the repo root first, or run all
> `python -m stitch_plugin_tools` commands from the `python/` dir.

```bash
# 1. Generate a signing keypair (one-time):
python -m stitch_plugin_tools keygen --out keys/

# 2. Sign the package:
python -m stitch_plugin_tools sign . --key keys/private.key

# 3. Dev-install to plugins-local:
python -m stitch_plugin_tools dev-install .

# 4. Start Stitch with STITCH_DEV_MODE=1 (allows unsigned dev packages):
STITCH_DEV_MODE=1 python -m stitch_backend
```

## Commands

| Command | Readonly | Description |
|--------|----------|-------------|
| `health_check` | yes | Health check — returns `{{pong: true}}` |
| `echo` | yes | Echoes back the `text` param |

## Layout

```
{plugin_id}/
├── plugin.json              # v2 manifest (kind=service)
├── README.md
└── {pkg_name}/
    ├── __init__.py
    ├── __main__.py           # RPC entry (RpcPluginServer)
    ├── service.py             # domain logic (handlers delegate here)
    └── storage.py            # SQLite helper
```

## Publishing

```bash
# Sign + zip + POST to the server:
python -m stitch_plugin_tools publish . \\
    --server-url http://localhost:8900 \\
    --admin-key <key> \\
    --key keys/private.key
```

For community submission, see `docs/service-plugins.md`.
"""


def scaffold_service_plugin(
    out_dir: Path,
    *,
    plugin_id: str,
    name: str = "",
    author: str = "",
    version: str = "0.1.0",
) -> Path:
    """Scaffold a service-plugin package into ``out_dir``.

    Creates ``plugin.json``, ``<pkg>/__init__.py``, ``<pkg>/__main__.py``,
    ``<pkg>/service.py``, ``<pkg>/storage.py``, and ``README.md``.  The
    directory is created if it does not exist; existing files are overwritten.

    Args:
        out_dir: Target directory for the package (created if absent).
        plugin_id: Plugin id (``[A-Za-z0-9_-]``).
        name: Human-readable name (defaults to ``plugin_id``).
        author: Optional author name (written to manifest extras).
        version: Semver version string (default ``"0.1.0"``).

    Returns:
        The path to the assembled package directory (``out_dir``).
    """
    _validate_plugin_id(plugin_id)
    pkg_name = _pkg_name(plugin_id)
    display_name = name or plugin_id

    out_dir.mkdir(parents=True, exist_ok=True)
    pkg_dir = out_dir / pkg_name
    pkg_dir.mkdir(exist_ok=True)

    # ── plugin.json (v2 manifest) ─────────────────────────────────────
    # i18n bundle is NESTED: {plugin_id: {key: value}}. The FE resolver
    # (src/lib/i18nPluginBundles.ts walkBundle) walks dot-paths through
    # nested objects — flat keys like "{plugin_id}.title" never resolve.
    # Labels are i18n KEY strings (e.g. "{plugin_id}.tab") resolved via
    # resolveLabel/t("plugin.{id}.{label}") in DeclarativePage + AiTopTabs.
    i18n_bundle = {
        plugin_id: {
            "title": display_name,
            "tab": display_name,
            "health_check": "Health Check",
            "echo": {
                "text": "Text to echo",
                "btn": "Echo",
            },
        }
    }
    manifest: dict[str, Any] = {
        "schema": SCHEMA_ID_V2,
        "id": plugin_id,
        "name": display_name,
        "version": version,
        "service": plugin_id,
        "kind": "service",
        "engine": dict(CANONICAL_ENGINE),
        "depends": [],
        "entry": {"module": pkg_name},
        "capabilities": [],
        "outputs": [],
        "signature": "",
        "generated_by": generated_by_field(),
        "contributions": {
            "commands": [
                {"name": "health_check", "readonly": True},
                {"name": "echo", "readonly": True},
            ],
            "ui": {
                "kind": "declarative",
                "tabs": [
                    {
                        "id": plugin_id,
                        "label": f"{plugin_id}.tab",
                        "icon": "Plug",
                        "page": "main",
                    }
                ],
                "page": {
                    "title": f"{plugin_id}.title",
                    "nodes": [
                        {
                            "kind": "button",
                            "id": "health-check-btn",
                            "label": f"{plugin_id}.health_check",
                            "command": "health_check",
                            "variant": "primary",
                        },
                        {
                            "kind": "field",
                            "field": "text",
                            "id": "echo-field",
                            "label": f"{plugin_id}.echo.text",
                        },
                        {
                            "kind": "button",
                            "id": "echo-btn",
                            "label": f"{plugin_id}.echo.btn",
                            "command": "echo",
                            "params": {"text": {"field": "echo-field"}},
                            "variant": "secondary",
                        },
                    ],
                },
            },
            "i18n": {
                "ru": i18n_bundle,
                "en": i18n_bundle,
            },
            "storage": {
                "sqlite": True,
                "migrations": "raw_sql",
            },
        },
    }
    if author:
        manifest["author"] = author
        manifest["description"] = f"Service plugin {plugin_id} by {author}."

    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # ── <pkg>/__init__.py ──────────────────────────────────────────────
    (pkg_dir / "__init__.py").write_text(
        f'"""{display_name} service plugin."""\n',
        encoding="utf-8",
    )

    # ── <pkg>/__main__.py ──────────────────────────────────────────────
    (pkg_dir / "__main__.py").write_text(
        _MAIN_TEMPLATE.format(
            pkg_name=pkg_name,
            plugin_id=plugin_id,
            scaffold_version=SCAFFOLD_VERSION,
        ),
        encoding="utf-8",
    )

    # ── <pkg>/service.py ──────────────────────────────────────────────
    (pkg_dir / "service.py").write_text(
        _SERVICE_TEMPLATE.format(scaffold_version=SCAFFOLD_VERSION),
        encoding="utf-8",
    )

    # ── <pkg>/storage.py ──────────────────────────────────────────────
    (pkg_dir / "storage.py").write_text(
        _STORAGE_TEMPLATE.format(scaffold_version=SCAFFOLD_VERSION),
        encoding="utf-8",
    )

    # ── README.md ──────────────────────────────────────────────────────
    (out_dir / "README.md").write_text(
        _README_TEMPLATE.format(
            plugin_id=plugin_id,
            pkg_name=pkg_name,
            name=display_name,
        ),
        encoding="utf-8",
    )

    return out_dir
