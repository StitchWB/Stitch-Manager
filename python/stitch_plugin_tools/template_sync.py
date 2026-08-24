"""Regenerate the repo-root ``template/`` directory (GitHub template seed).

``stitch_plugin_tools sync-template`` renders the future GitHub template
repo from the scaffold internals — the scaffold is the single source of
truth, the template directory is derived.  It scaffolds a reference
plugin (``stitch-plugin-template``) and overlays template-repo extras:

- ``.github/workflows/ci.yml`` — pytest the plugin's tests + inline
  manifest validation.
- ``.gitignore`` — standard Python.
- ``LICENSE`` — MIT (copied from the repo root when available).
- ``README.md`` — template-grade quickstart (rename → implement → test →
  sign → dev-install).
- ``tests/test_plugin_protocol.py`` — starter test using the raw-stdin
  driver pattern (spawn plugin, init/ping/health_check/shutdown — no
  host dependency).

The output is commit-ready: no ``__pycache__``, no ``*.db``.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from autoreg.plugin.manifest import MANIFEST_FILENAME
from stitch_plugin_tools.scaffold import scaffold_service_plugin

TEMPLATE_PLUGIN_ID = "stitch-plugin-template"
TEMPLATE_PLUGIN_NAME = "Stitch Plugin Template"
_TEMPLATE_PKG = TEMPLATE_PLUGIN_ID.replace("-", "_")

_REPO_URL = "https://github.com/WhiteBite/Stitch-Manager"

# ── Overlay extras ───────────────────────────────────────────────────────

_CI_YML = """\
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install test deps
        run: pip install pytest pytest-timeout
      - name: Validate manifest
        run: |
          python - <<'EOF'
          import json, sys
          with open("plugin.json", encoding="utf-8") as f:
              m = json.load(f)
          required = ["schema", "id", "name", "version", "kind", "entry"]
          missing = [k for k in required if k not in m]
          if missing:
              sys.exit(f"plugin.json missing fields: {missing}")
          if m["kind"] != "service":
              sys.exit(f"expected kind=service, got {m['kind']!r}")
          if not m["entry"].get("module"):
              sys.exit("entry.module is required")
          print(f"manifest OK: {m['id']}@{m['version']}")
          EOF
      - name: Run plugin tests
        run: python -m pytest tests/ -q --timeout=60
"""

_GITIGNORE = """\
# Python
__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/

# Virtual environments
.venv/
venv/

# Plugin runtime artifacts
*.db
*.sqlite3
*.db-wal
*.db-shm

# Editors / OS
.idea/
.vscode/
.DS_Store
"""

_FALLBACK_LICENSE = """\
MIT License

Copyright (c) 2024-2026 Stitch Manager Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

_README = f"""\
# {TEMPLATE_PLUGIN_NAME}

A GitHub template for building **Stitch Manager service plugins**
(`kind=service`). Generated from the canonical scaffold — create your
repo with **Use this template**, then follow the quickstart below.

## Quickstart

### 1. Rename

Pick a plugin id (`[A-Za-z0-9_-]`, no dots) and rename the pieces:

- repo / directory name → `my-plugin/`
- `plugin.json` → `id`, `name`, `service` fields → `my-plugin`
- `{_TEMPLATE_PKG}/` package dir → `my_plugin/` (id with `-` → `_`)
- `plugin.json` → `entry.module` → `my_plugin`
- `tests/test_plugin_protocol.py` → `MODULE` / `PLUGIN_ID` constants

### 2. Implement your handlers

- `{_TEMPLATE_PKG}/service.py` — domain logic.
- `{_TEMPLATE_PKG}/__main__.py` — register a handler per command
  (`server.register("my_command", _handle_my_command)`).
- `plugin.json` — declare each command under `contributions.commands`,
  UI nodes under `contributions.ui`, and i18n labels under
  `contributions.i18n` (nested under the plugin id).
- `{_TEMPLATE_PKG}/storage.py` — SQLite schema, migrated via
  `_migrate_db` (set `contributions.storage.sqlite` to `false` if you
  need no database).

### 3. Test

```bash
pip install pytest pytest-timeout
python -m pytest tests/ -q --timeout=60
```

`tests/test_plugin_protocol.py` spawns the plugin and drives the raw
JSON-RPC line protocol (init -> ping -> command -> shutdown) with no host
dependency -- copy the pattern for your own commands.

### 4. Run (local REPL, no host boot)

```bash
python -m stitch_plugin_tools run .
```

Spawns the plugin child, streams stderr live, and drives a line-based
REPL on stdin (`<command> [json-params]` -> pretty-printed result).
Built-ins: `ping`, `init-info`, `logs`, `help`, `exit`.  Reverse-RPC
`engine.oauth.*` requests are stubbed (the plugin gets a clear error
instead of hanging).  Try `health_check` and `echo {{"text":"hi"}}` first.

### 5. Sign

```bash
# one-time keypair (keep the private key offline):
python -m stitch_plugin_tools keygen --out keys/
python -m stitch_plugin_tools sign . --key keys/private.key
```

### 6. Dev-install and run

```bash
python -m stitch_plugin_tools dev-install .
STITCH_DEV_MODE=1 python -m stitch_backend
```

The plugin appears as a tab in the AI Hub; commands are callable as
`plugin.my-plugin.<command>`.

## Protocol notes

- `plugin.init` params carry `supported` — the optional host features
  available in the session (e.g. `reverse_rpc`, `caller_identity`).
- The init result carries `capabilities` — the plugin's opt-in features
  (e.g. `["reverse_rpc"]` when using `server.call_host`). Keep it `[]`
  until you need one.

## Docs

- [Service plugin authoring guide]({_REPO_URL}/blob/main/docs/service-plugins.md)
- [Plugin conventions]({_REPO_URL}/blob/main/docs/plugin-authoring.md)

## License

MIT — see [LICENSE](LICENSE).
"""

_STARTER_TEST = f'''\
"""Starter protocol test — drives the plugin over raw stdin/stdout.

Spawns ``python -m {_TEMPLATE_PKG}`` (no host dependency) and walks the
JSON-RPC 2.0 line protocol: init → ping → health_check → shutdown.
Copy this pattern for your own plugin's commands.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Rename both constants when you rename the plugin (see README §1).
MODULE = "{_TEMPLATE_PKG}"
PLUGIN_ID = "{TEMPLATE_PLUGIN_ID}"

PACKAGE_DIR = Path(__file__).resolve().parents[1]


def _request(rid: int, method: str, params: dict | None = None) -> str:
    return json.dumps(
        {{"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {{}}}}
    )


def _drive(lines: list[str]) -> dict[int, dict]:
    """Feed JSON-RPC request lines, return responses keyed by id."""
    proc = subprocess.run(
        [sys.executable, "-m", MODULE],
        input="\\n".join(lines) + "\\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(PACKAGE_DIR),
        timeout=30,
    )
    assert proc.returncode == 0, f"plugin exited {{proc.returncode}}: {{proc.stderr}}"
    responses: dict[int, dict] = {{}}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line:
            obj = json.loads(line)
            responses[obj["id"]] = obj
    return responses


def test_lifecycle_init_ping_command_shutdown() -> None:
    """Full lifecycle over raw stdin: handshake, liveness, a command,
    and graceful shutdown."""
    responses = _drive(
        [
            _request(
                1,
                "plugin.init",
                {{
                    "engine_api": 2,
                    "plugin_id": PLUGIN_ID,
                    "db_path": "",
                    "data_dir": "",
                    "supported": [],
                }},
            ),
            _request(2, "plugin.ping"),
            _request(3, "plugin.call", {{"name": "health_check", "params": {{}}}}),
            _request(4, "plugin.shutdown"),
        ]
    )

    # Handshake: init result carries plugin_id/db_path/data_dir +
    # capabilities (empty until the plugin opts into a feature).
    init = responses[1]["result"]
    assert init["plugin_id"] == PLUGIN_ID
    assert init["db_path"] == ""
    assert init["data_dir"] == ""
    assert init["capabilities"] == []

    # Liveness + command dispatch.
    assert responses[2]["result"] == "pong"
    assert responses[3]["result"] == {{"pong": True}}

    # Graceful shutdown.
    assert responses[4]["result"] is None
'''


# ── Sync ─────────────────────────────────────────────────────────────────


def _looks_like_template(path: Path) -> bool:
    """True when ``path`` is empty or a previously generated template."""
    manifest = path / MANIFEST_FILENAME
    if not manifest.is_file():
        return not any(path.iterdir())
    try:
        raw: Any = json.loads(manifest.read_text(encoding="utf-8"))
    except ValueError:
        return False
    return isinstance(raw, dict) and raw.get("id") == TEMPLATE_PLUGIN_ID


def sync_template(out_dir: Path, *, license_source: Path | None = None) -> Path:
    """Regenerate ``out_dir`` as the GitHub template repo seed.

    Args:
        out_dir: Target directory (wiped and rebuilt when it is empty or
            a previously generated template; refused otherwise).
        license_source: Optional repo-root ``LICENSE`` to copy verbatim
            (falls back to a bundled MIT text matching the repo).

    Returns:
        The regenerated template directory.
    """
    out_dir = out_dir.resolve()
    if out_dir.exists():
        if not _looks_like_template(out_dir):
            raise ValueError(
                f"refusing to regenerate {out_dir}: not empty and not a "
                f"previously generated {TEMPLATE_PLUGIN_ID} template"
            )
        shutil.rmtree(out_dir)

    # 1. Scaffold the reference plugin (single source of truth).
    scaffold_service_plugin(
        out_dir, plugin_id=TEMPLATE_PLUGIN_ID, name=TEMPLATE_PLUGIN_NAME
    )

    # 2. Overlay template-repo extras.
    workflows = out_dir / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(_CI_YML, encoding="utf-8")
    (out_dir / ".gitignore").write_text(_GITIGNORE, encoding="utf-8")

    if license_source is not None and license_source.is_file():
        (out_dir / "LICENSE").write_bytes(license_source.read_bytes())
    else:
        (out_dir / "LICENSE").write_text(_FALLBACK_LICENSE, encoding="utf-8")

    (out_dir / "README.md").write_text(_README, encoding="utf-8")

    tests_dir = out_dir / "tests"
    # scaffold_service_plugin already created tests/ (with the harness-based
    # test); keep the dir, overwrite the test with the host-free starter so the
    # template repo works standalone without stitch_plugin_testing installed.
    tests_dir.mkdir(exist_ok=True)
    (tests_dir / "test_plugin_protocol.py").write_text(
        _STARTER_TEST, encoding="utf-8"
    )

    return out_dir
