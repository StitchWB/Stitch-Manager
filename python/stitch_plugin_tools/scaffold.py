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

# Plugin id charset (matches manifest._PLUGIN_ID_RE).
_PLUGIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


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
  - ``plugin.init``    -> calls ``init_handler(params)`` (if set).
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

from __future__ import annotations

import json
import sys
from typing import Any

from . import storage

try:
    from autoreg.plugin.rpc import RpcPluginServer
except ImportError:
    # Inline fallback for standalone operation (no autoreg on sys.path).
    class RpcPluginServer:  # minimal, protocol-equivalent
        def __init__(self) -> None:
            self._handlers: dict[str, Any] = {{}}
            self._init_handler: Any = None

        def register(self, name: str, handler: Any) -> None:
            self._handlers[name] = handler

        def set_init_handler(self, handler: Any) -> None:
            self._init_handler = handler

        def serve(self) -> None:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(req, dict):
                    continue
                rid = req.get("id")
                method = req.get("method", "")
                params = req.get("params", {{}})
                if not isinstance(params, dict):
                    params = {{}}
                result = self._dispatch(method, params)
                self._send(rid, result)
                if method == "plugin.shutdown":
                    break

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
        def _send(rid: Any, result: Any) -> None:
            if isinstance(result, dict) and "error" in result:
                obj = {{"jsonrpc": "2.0", "id": rid, "error": result["error"]}}
            else:
                obj = {{"jsonrpc": "2.0", "id": rid, "result": result}}
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\\n")
            sys.stdout.flush()


# ── State received in plugin.init handshake ───────────────────────────────

_db_path: str = ""
_data_dir: str = ""


def _handle_init(params: dict[str, Any]) -> dict[str, Any]:
    """Store handshake params and return them as the init result."""
    global _db_path, _data_dir
    _db_path = str(params.get("db_path", ""))
    _data_dir = str(params.get("data_dir", ""))
    return {{
        "plugin_id": params.get("plugin_id", ""),
        "db_path": _db_path,
        "data_dir": _data_dir,
    }}


def _handle_migrate_db(params: dict[str, Any]) -> dict[str, Any]:
    """Create SQLite tables (raw_sql migration)."""
    if _db_path:
        storage.migrate(_db_path)
    return {{
        "from_version": params.get("from_version", 0),
        "to_version": params.get("to_version", 1),
    }}


def _handle_ping(params: dict[str, Any]) -> dict[str, Any]:
    """Health-check command — returns pong."""
    return {{"pong": True}}


def _handle_echo(params: dict[str, Any]) -> dict[str, Any]:
    """Echo the ``text`` param back to the caller."""
    return {{"text": str(params.get("text", ""))}}


# ── Server entry point ────────────────────────────────────────────────────

def main() -> None:
    """Register handlers and serve the JSON-RPC loop."""
    server = RpcPluginServer()
    server.set_init_handler(_handle_init)
    server.register("_migrate_db", _handle_migrate_db)
    server.register("ping", _handle_ping)
    server.register("echo", _handle_echo)
    server.serve()


if __name__ == "__main__":
    main()
'''

_STORAGE_TEMPLATE = '''"""SQLite storage for this service plugin.

The plugin owns its own SQLite database at ``db_path`` (received in the
``plugin.init`` handshake).  Tables are created on ``_migrate_db``.
Replace this with your own schema as needed.
"""

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
        return [{"id": r["id"], "text": r["text"]} for r in rows]
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
    return {"id": item_id, "text": text}
'''

_README_TEMPLATE = """# {name}

A Stitch service plugin (`{plugin_id}`).

## Quick start (dev loop)

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
| `ping` | yes | Health check — returns `{{pong: true}}` |
| `echo` | yes | Echoes back the `text` param |

## Layout

```
{plugin_id}/
├── plugin.json              # v2 manifest (kind=service)
├── README.md
└── {pkg_name}/
    ├── __init__.py
    ├── __main__.py           # RPC entry (RpcPluginServer)
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
    ``<pkg>/storage.py``, and ``README.md``.  The directory is created
    if it does not exist; existing files are overwritten.

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
    manifest: dict[str, Any] = {
        "schema": SCHEMA_ID_V2,
        "id": plugin_id,
        "name": display_name,
        "version": version,
        "service": plugin_id,
        "kind": "service",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {"module": pkg_name},
        "capabilities": [],
        "outputs": [],
        "signature": "",
        "contributions": {
            "commands": [
                {"name": "ping", "readonly": True},
                {"name": "echo", "readonly": True},
            ],
            "ui": {
                "kind": "declarative",
                "tabs": [
                    {
                        "id": plugin_id,
                        "label": display_name,
                        "icon": "Plug",
                        "page": "main",
                    }
                ],
                "page": {
                    "sections": [
                        {
                            "kind": "actions",
                            "id": "ping-actions",
                            "items": [
                                {
                                    "kind": "button",
                                    "label": {"ru": "Пинг", "en": "Ping"},
                                    "command": "ping",
                                }
                            ],
                        },
                        {
                            "kind": "field",
                            "id": "echo-field",
                            "input": "text",
                            "label": {"ru": "Текст", "en": "Text"},
                            "placeholder": {
                                "ru": "Введите текст...",
                                "en": "Enter text...",
                            },
                        },
                        {
                            "kind": "actions",
                            "id": "echo-actions",
                            "items": [
                                {
                                    "kind": "button",
                                    "label": {"ru": "Эхо", "en": "Echo"},
                                    "command": "echo",
                                }
                            ],
                        },
                    ]
                },
            },
            "i18n": {
                "ru": {f"{plugin_id}.title": display_name},
                "en": {f"{plugin_id}.title": display_name},
            },
            "storage": {
                "sqlite": True,
                "migrations": "raw_sql",
            },
        },
        "config": {},
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
        _MAIN_TEMPLATE.format(pkg_name=pkg_name, plugin_id=plugin_id),
        encoding="utf-8",
    )

    # ── <pkg>/storage.py ──────────────────────────────────────────────
    (pkg_dir / "storage.py").write_text(
        _STORAGE_TEMPLATE,
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
