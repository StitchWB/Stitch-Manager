# Service Plugins — Authoring Guide

A **service plugin** is an out-of-process extension that runs as a
subprocess communicating with the Stitch host over stdio JSON-RPC 2.0.
This document is the contract between a plugin author and the host.

> **Scope boundary:** service plugins run in their own process, own
> their own SQLite database, and never write to core tables. The host
> never imports plugin code into the server process. Plugin UI is
> declarative (a fixed schema vocabulary) — no arbitrary JavaScript
> from plugins enters the frontend.

---

## 1. Manifest v2 (`plugin.json`)

A service plugin package is a directory containing a `plugin.json`
manifest with `schema: "stitch.plugin/v2"` and `kind: "service"`.

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `schema` | `string` | Must be `"stitch.plugin/v2"`. |
| `id` | `string` | Plugin id. Charset `[A-Za-z0-9_-]` (no dots, no path separators). Used in namespaced commands `plugin.{id}.{cmd}`. |
| `name` | `string` | Human-readable name. |
| `version` | `string` | Semver 2.0.0 (`MAJOR.MINOR.PATCH`). |
| `service` | `string` | Canonical service identifier (usually same as `id`). |
| `kind` | `string` | Must be `"service"`. |
| `engine` | `object` | `{min: "<semver>", api: <int>}` — minimum host version + API level. |
| `depends` | `string[]` | Plugin ids this plugin depends on (usually `[]`). |
| `entry` | `object` | `{module: "<python_module>"}` — the module spawned as `python -m <module>`. |
| `capabilities` | `string[]` | SPI registrations (e.g. `["mail.inbox"]`). Usually `[]` for non-SPI plugins. |
| `outputs` | `string[]` | Output declarations (usually `[]`). |
| `signature` | `string` | `ed25519:<base64>` signature (empty when unsigned). |

### `contributions` (v2)

The `contributions` object declares the plugin's surface area:

```json
{
  "contributions": {
    "commands": [
      {"name": "ping", "readonly": true},
      {"name": "create_notebook", "readonly": false}
    ],
    "ui": {
      "kind": "declarative",
      "tabs": [
        {"id": "notebooklm", "label": "NotebookLM", "icon": "BookOpen", "page": "main"}
      ],
      "page": { /* declarative schema — see §4 */ }
    },
    "i18n": {
      "ru": {"notebooklm.title": "NotebookLM"},
      "en": {"notebooklm.title": "NotebookLM"}
    },
    "storage": {
      "sqlite": true,
      "migrations": "raw_sql"
    }
  }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `commands` | `object[]` | Namespaced commands. `name` is the command name (called as `plugin.{id}.{name}`). `readonly` gates write access. |
| `ui` | `object` | UI contribution. `kind` is `"declarative"` (schema-driven) or `"core_page"` (host page binds to plugin commands). |
| `ui.tabs` | `object[]` | Dynamic tabs in the AI Hub. `id`, `label`, `icon` (Lucide icon name), `page` (schema ref). |
| `ui.page` | `object` | Declarative page schema (see §4). Only used when `kind=declarative`. |
| `i18n` | `object` | Translation bundles keyed by locale (`ru`, `en`). Keys are resolved via `t("plugin.{id}.{key}")` fallback. |
| `storage` | `object` | Storage declaration. `sqlite: true` enables per-plugin SQLite at `data/plugins/{id}/plugin.db`. `migrations` is `"raw_sql"`, `"alembic"`, or `null`. |

### `config` (v2)

The `config` object declares which core settings the plugin needs
(whitelist). The host reads these from core settings and passes them
in the `plugin.init` handshake as `engine_config`.

```json
{
  "config": {
    "needs": ["imap.host", "imap.port"]
  }
}
```

### Extras

Unknown fields are tolerated (tolerant reader) and preserved in
`manifest.extras`. `author` and `description` are forwarded to the
marketplace when publishing.

---

## 2. RPC Protocol

The host spawns the plugin as `python -m <entry.module>` with
`cwd=<package_dir>` and attaches to stdin/stdout via
`subprocess.Popen` (PIPE handles, process-group isolation).

Communication is **line-delimited JSON-RPC 2.0**: one JSON object per
line on stdin (requests from host) and stdout (responses from plugin).
Malformed lines from the plugin are skipped+logged — they never crash
the host.

### Methods

| Method | Direction | Params | Result | Description |
|--------|-----------|--------|--------|-------------|
| `plugin.init` | host→plugin | `{plugin_id, db_path, data_dir, engine_config}` | any | Handshake. Called once at startup. The plugin stores `db_path` for SQLite access. |
| `plugin.call` | host→plugin | `{name: <str>, params: <dict>}` | any | Dispatch a command. `name` matches a `contributions.commands[].name`. Unknown name → JSON-RPC error `-32601`. |
| `plugin.ping` | host→plugin | `{}` | `"pong"` | Health check. Host uses this for liveness. |
| `plugin.shutdown` | host→plugin | `{}` | `null` | Graceful shutdown. Plugin should clean up and exit. |
| `plugin.call` (`_migrate_db`) | host→plugin | `{from_version, to_version}` | `{from_version, to_version}` | Reserved call name. Called after `plugin.init` when `contributions.storage.migrations` is set. The plugin creates/migrates its SQLite tables. |

### Error handling

Handler exceptions are caught by the server and returned as JSON-RPC
error responses (code `-32603`, internal error) — the server never
crashes. Unknown method names return `-32601` (method not found).

### Timeouts

The host applies a per-call timeout (default 30s). On timeout, the
child process is killed (kill-tree) and `RpcTimeoutError` is raised.
The host restarts the plugin once on crash; a second crash marks it
dead.

---

## 3. Using `RpcPluginServer`

The `autoreg.plugin.rpc.RpcPluginServer` class implements the server
side of the protocol. Plugin authors register handlers and call
`serve()`:

```python
from autoreg.plugin.rpc import RpcPluginServer

server = RpcPluginServer()
server.set_init_handler(handle_init)
server.register("ping", handle_ping)
server.register("echo", handle_echo)
server.serve()  # blocks until plugin.shutdown
```

`RpcPluginServer` handles `plugin.init`, `plugin.ping`,
`plugin.shutdown`, and `plugin.call` dispatch automatically. Handler
exceptions are caught and returned as JSON-RPC errors.

When `autoreg` is not on `sys.path` (standalone plugin without the
host's Python tree), the generated template includes an inline
equivalent — same protocol, no external dependency.

---

## 4. Declarative UI Schema

When `contributions.ui.kind = "declarative"`, the host renders the
plugin's page from a fixed schema vocabulary. No arbitrary JavaScript
or HTML from the plugin enters the frontend.

### Boundary rule

The declarative vocabulary covers **fixed-layout pages**: tables,
forms, buttons, fields. Pages that need polling/realtime, rich-text,
drag-and-drop, or virtual scrolling must use `kind = "core_page"`
(a host page that binds to plugin commands).

### Schema vocabulary

```json
{
  "sections": [
    {
      "kind": "table",
      "id": "notebooks",
      "label": {"ru": "Ноутбуки", "en": "Notebooks"},
      "columns": [
        {"key": "id", "label": "ID"},
        {"key": "title", "label": {"ru": "Заголовок", "en": "Title"}}
      ],
      "command": "list_notebooks"
    },
    {
      "kind": "field",
      "id": "ask-field",
      "input": "text",
      "label": {"ru": "Вопрос", "en": "Ask"},
      "placeholder": {"ru": "Задайте вопрос...", "en": "Ask a question..."}
    },
    {
      "kind": "actions",
      "id": "ask-actions",
      "items": [
        {
          "kind": "button",
          "label": {"ru": "Спросить", "en": "Ask"},
          "command": "ask",
          "params": {"field": "ask-field"}
        }
      ]
    }
  ]
}
```

| Section kind | Purpose |
|-------------|---------|
| `table` | Read-only data table. `columns` define the schema. `command` is a readonly command that returns `[{...}, ...]`. |
| `field` | Input field. `input` is `"text"`, `"select"`, or `"toggle"`. |
| `actions` | Action buttons. Each `item` has `kind: "button"`, `label`, `command`, and optional `params`. |
| `heading` | Section heading (label only). |

Labels can be plain strings or localized objects `{"ru": "...", "en": "..."}`.

Button clicks invoke `plugin.{id}.{command}` via the host's
`safeInvoke` — the result is surfaced as a toast or table refresh.

---

## 5. i18n Bundles

Translation bundles live in `contributions.i18n`:

```json
{
  "i18n": {
    "ru": {"myplugin.title": "Мой плагин"},
    "en": {"myplugin.title": "My Plugin"}
  }
}
```

The frontend `t()` function resolves keys in the form
`plugin.{id}.{key}` by falling back to the plugin's bundle for the
current locale. Missing keys return the key string as-is (no crash).

---

## 6. Storage & Migrations

When `contributions.storage.sqlite = true`, the host creates a
per-plugin data directory at `data/plugins/{id}/` and passes
`db_path = data/plugins/{id}/plugin.db` in the `plugin.init`
handshake.

The plugin owns its SQLite database exclusively. The host never reads
or writes it directly — all access is via RPC commands.

### Migration flow

1. Host spawns the plugin and calls `plugin.init` (passes `db_path`).
2. If `contributions.storage.migrations` is not `null`, the host
   calls `plugin.call` with `name = "_migrate_db"` and
   `{from_version, to_version}`.
3. The plugin creates or migrates its tables (raw SQL or Alembic).
4. The host then accepts regular `plugin.call` commands.

The plugin never writes to core SQLite tables. Core never reads
plugin SQLite directly.

---

## 7. Entitlements

Service plugins are gated by the same entitlement system as v1
plugins. Desktop and admin roles get `"*"` (all plugins)
automatically. Other roles require explicit grants via the
`grant_commands` seed or the admin UI.

When a caller is not entitled to a plugin, the bridge returns HTTP
403. Unknown plugins (no host in registry) return 404. RPC timeouts
return 504.

---

## 8. Dev Loop (`plugins-local`)

The dev loop uses `plugins-local/` — a directory of unsigned packages
that the host discovers when `STITCH_DEV_MODE=1`.

### Quick start

```bash
# 1. Scaffold a new service plugin:
python -m stitch_plugin_tools new my-plugin/ --id my-plugin

# 2. Generate a signing keypair (one-time):
python -m stitch_plugin_tools keygen --out keys/

# 3. Sign the package (optional in dev mode, required for production):
python -m stitch_plugin_tools sign my-plugin/ --key keys/private.key

# 4. Dev-install to plugins-local:
python -m stitch_plugin_tools dev-install my-plugin/

# 5. Start the host with dev mode:
STITCH_DEV_MODE=1 python -m stitch_backend
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STITCH_PLUGINS_DIR` | `<app_data>/stitch-manager` | Base dir for `plugins-local/` and `plugins/` (cache). Override for tests. |
| `STITCH_DEV_MODE` | `0` | When `1`, unsigned packages from `plugins-local/` are allowed. |
| `STITCH_PLUGIN_PUBKEY` | bundled | Base64 ed25519 public key for signature verification. |

### Discovery

On startup, the host scans `plugins-local/` (dev) and `plugins/`
(cache) for `kind=service` manifests. For each:

1. `register_manifest(plugin_id, manifest)` — stores metadata.
2. Creates a `ServicePluginHost` with the manifest's `entry.module`.
3. `register_host(host)` + `await host.start()`.
4. Skips unhealthy hosts with a warning log (never crashes startup).

`plugins-local/` takes precedence over `plugins/` (cache) when both
have the same plugin id.

### `list_service_plugins`

The readonly command `list_service_plugins` returns all discovered
service plugins with their status, version, commands, UI metadata,
and i18n bundles — everything the frontend needs to render dynamic
tabs and pages.

---

## 9. Publishing

### Server publish (official)

```bash
python -m stitch_plugin_tools publish my-plugin/ \
    --server-url http://localhost:8900 \
    --admin-key <admin-key> \
    --key keys/private.key
```

This signs (if a key is provided), zips the package, computes the
transport sha256, and POSTs to `/admin/publish`. The server stores
the package in its cache and serves it to clients via the sync
endpoint.

### Community submission (`submit_for_review`)

Community plugins are submitted via a GitHub PR to the catalog repo.
The `submit_for_review` command forks the catalog, pushes the
package files, and opens a PR.

> **Note:** `submit_for_review` currently handles v1 data-plugin
> file lists (`plugin.json`, `scenario.json`, `selectors.json`,
> `profile.json`). Service plugins ship a whole package directory
> (Python code + manifest). Extension of `submit_for_review` to
> handle service-plugin packages is tracked as a separate task
> (plan todo 22).

### Signature verification

- `plugins-local/` — unsigned allowed in dev mode (`STITCH_DEV_MODE=1`).
- `plugins/` (cache) — always requires a valid `ed25519:` signature
  against the bundled (or `STITCH_PLUGIN_PUBKEY`) public key.

Unsigned packages from the cache are rejected. The signing key is
offline; the public key ships with the app.

---

## 10. Worked Example: `stitch-notebooklm`

The `plugins-src/stitch-notebooklm/` package in this repo is a
complete service plugin that demonstrates the full contract.

### Layout

```
plugins-src/stitch-notebooklm/
├── plugin.json                              # v2 manifest (kind=service)
└── stitch_notebooklm/
    ├── __init__.py
    ├── __main__.py                           # RPC entry (JSON-RPC loop)
    ├── service.py                            # NotebookLM API client wrapper
    └── storage.py                            # SQLite (notebooks table)
```

### Manifest highlights

```json
{
  "schema": "stitch.plugin/v2",
  "id": "stitch-notebooklm",
  "kind": "service",
  "entry": {"module": "stitch_notebooklm"},
  "contributions": {
    "commands": [
      {"name": "list_notebooks", "readonly": true},
      {"name": "create_notebook", "readonly": false},
      {"name": "ask", "readonly": false},
      {"name": "generate_audio", "readonly": false}
    ],
    "ui": {
      "kind": "declarative",
      "tabs": [{"id": "notebooklm", "label": "NotebookLM", "icon": "BookOpen", "page": "main"}],
      "page": { /* sections: table + actions + field */ }
    },
    "i18n": {"ru": {...}, "en": {...}},
    "storage": {"sqlite": true, "migrations": "raw_sql"}
  }
}
```

### Dev loop

```bash
# From the repo root:
python -m stitch_plugin_tools dev-install plugins-src/stitch-notebooklm/
STITCH_DEV_MODE=1 python -m stitch_backend
```

The plugin appears as a tab in the AI Hub. Commands are callable as
`plugin.stitch-notebooklm.list_notebooks`,
`plugin.stitch-notebooklm.create_notebook`, etc.

### E2E test

See `python/tests/test_e2e_notebooklm_plugin.py` for the full
install → start → list → create → list roundtrip → built-in fallback
test.

---

## 11. SDK Reference

### `stitch_plugin_tools` CLI

| Command | Description |
|---------|-------------|
| `new <out_dir> --id <id> [--name …] [--author …] [--version …]` | Scaffold a kind=service plugin package. |
| `keygen --out <dir>` | Generate an ed25519 keypair. |
| `sign <package_dir> --key <private.key>` | Sign a plugin package. |
| `verify <package_dir> --pubkey <public.key>` | Verify a package signature. |
| `publish <package_dir> [--server-url …] [--key …]` | Sign + zip + POST to server. |
| `dev-install <package_dir>` | Copy package to `plugins-local/`. |
| `pack-engine <out_dir> [--version …]` | Assemble an engine-pack (captcha solvers). |

### `pack` / `sign` for service plugins

`sign` and `publish` are generic — they walk the entire package
directory and hash every file (no hardcoded file lists). Service
plugin packages (manifest + Python module directory) are handled
identically to engine-packs and provider plugins.

The `zip_package` function in `stitch_plugin_tools.publish` walks the
whole package dir with `os.walk`, so any file layout works — the
manifest lands at the zip root (no wrapping directory), which is what
the client's `extractall` + `install_package` expects.

---

## 12. Sync drivers

In v2, the **frontend** owns the mail sync loop. The `stores/mail.ts`
polling driver (`pollIntervalMs`) calls `email_inbox_*` commands on
each tick. When the `stitch-mail` service plugin is installed and
healthy, the dual-format proxy (§2, `mail_dual.py`) routes those
commands to the plugin subprocess; when the plugin is absent or dead,
the same commands fall through to the built-in handler unchanged.

There is **no internal plugin sync loop** in v2 — the plugin process
serves sync ticks only when the frontend polls. This avoids
double-sync (FE polling + internal loop both writing sync state) and
keeps the plugin stateless between ticks.

The host watchdog (todo 3) restarts the plugin once on crash; the
next FE poll tick is served by the restarted plugin. If the plugin
exhausts its restart-once quota, subsequent ticks fall back to the
built-in handler — the frontend never crashes and never sees a
double-write (the dual-format route is either/or by design).

A plugin-internal sync loop (plugin polls its own IMAP on a timer,
independent of the frontend) is **v3 backlog**. When implemented, the
frontend polling would be disabled for that plugin to avoid
double-sync.
