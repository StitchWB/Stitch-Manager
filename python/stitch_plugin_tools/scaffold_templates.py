"""Embedded file templates for the kind=service plugin scaffold."""


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

Standalone: tries to import ``RpcPluginServer`` from
``autoreg.plugin.rpc`` (available when ``autoreg`` is on ``sys.path``).
If the import fails (standalone plugin without the host's python tree),
a vendored equivalent is loaded from ``._vendor.rpc_server`` — same
protocol, no external dependency.  The vendored module is regenerated
by ``stitch_plugin_tools dev-install`` / ``vendor``.
"""

# _generated_by: stitch_plugin_tools scaffold v{scaffold_version}

from __future__ import annotations

from typing import Any

from . import service, storage

try:
    from autoreg.plugin.rpc import RpcPluginServer
except ImportError:
    from ._vendor.rpc_server import RpcPluginServer

try:
    from autoreg.plugin.helpers import resolve_owner_id
except ImportError:
    from ._vendor.plugin_helpers import resolve_owner_id


# ── State received in plugin.init handshake ───────────────────────────────


class _Ctx:
    """Mutable container for plugin.init handshake state."""

    db_path: str = ""
    data_dir: str = ""
    supported: list[str] = []


ctx = _Ctx()


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
    resolve_owner_id(params)  # caller identity available for per-user logic
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

_STORAGE_TEMPLATE = '''"""SQLite storage for this service plugin.

The plugin owns its own SQLite database at ``db_path`` (received in the
``plugin.init`` handshake).  Tables are created on ``_migrate_db``.
Replace this with your own schema as needed.
"""

# _generated_by: stitch_plugin_tools scaffold v{scaffold_version}

from __future__ import annotations

import uuid
from typing import Any

try:
    from autoreg.plugin.helpers import connect_plugin_db
except ImportError:
    from ._vendor.plugin_helpers import connect_plugin_db


def migrate(db_path: str) -> None:
    """Create tables if they do not exist (raw_sql migration).

    Replace with your own schema.  This example creates a simple
    ``items`` table.
    """
    conn = connect_plugin_db(db_path)
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
    conn = connect_plugin_db(db_path)
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
    conn = connect_plugin_db(db_path)
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

_TEST_MAIN_TEMPLATE = '''"""Protocol smoke test for the {plugin_id} service plugin.

Generated by ``stitch_plugin_tools new``. Exercises the full plugin
lifecycle via the ``stitch_plugin_testing`` harness: spawn → init →
ping → echo command → close.

Run from the package root::

    pytest tests/test_plugin_protocol.py -q --timeout=60
"""

from __future__ import annotations

from pathlib import Path

import pytest

try:
    from stitch_plugin_testing import make_plugin_client
except ImportError:
    pytest.skip(
        "stitch_plugin_testing not importable — run "
        "`pip install -e python/` from the repo root",
        allow_module_level=True,
    )

# Package dir = parent of this tests/ dir (holds plugin.json + {pkg_name}/).
_PACKAGE_DIR = Path(__file__).resolve().parent.parent


def test_plugin_protocol_roundtrip() -> None:
    """init → ping → echo → close against the scaffolded plugin."""
    with make_plugin_client(_PACKAGE_DIR) as client:
        # init handshake completed by make_plugin_client.
        init = client.init_result
        assert isinstance(init, dict)
        assert init["plugin_id"] == "{plugin_id}"

        # ping succeeds.
        assert client.ping() is True

        # echo command returns the typed text.
        result = client.call("echo", {{"text": "hello"}})
        assert result == {{"text": "hello"}}
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

## Testing

`new` generates `tests/test_plugin_protocol.py` — a protocol smoke test
that spawns the plugin via the `stitch_plugin_testing` harness and
exercises init → ping → echo → close.

```bash
# Run the generated test (from the package root):
python -m pytest tests/ -q --timeout=60

# Or via the stitch_plugin_tools test command:
python -m stitch_plugin_tools test .
```

> **Prerequisite:** `stitch_plugin_testing` must be importable. Run
> `pip install -e python/` from the repo root first (same as the
> `stitch_plugin_tools` prerequisite above). If the harness is not
> importable at test runtime, the generated test skips with a clear
> message rather than failing.

## Layout

```
{plugin_id}/
├── plugin.json              # v2 manifest (kind=service)
├── README.md
├── tests/
│   └── test_plugin_protocol.py  # generated protocol smoke test
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
