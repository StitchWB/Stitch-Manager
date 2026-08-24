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
| `engine` | `object` | `{min: "<version>", api?: <int>}` — minimum host version + API level. `api` is optional (default `1`, v1 semantics). `min` format depends on `api`: `api >= 2` → semver 2.0.0 (`"0.3.0"`); `api == 1` (or absent) → CalVer `YYYY.MM` (`"2026.08"`). See [Engine gate](#engine-gate) below. |
| `depends` | `string[]` | Plugin ids this plugin depends on (usually `[]`). |
| `entry` | `object` | `{module: "<python_module>"}` — the module spawned as `python -m <module>`. |
| `capabilities` | `string[]` | v1 heritage list (usually `[]` for service plugins). SPI registrations live in `contributions.spi`. |
| `outputs` | `string[]` | Output declarations (usually `[]`). |
| `signature` | `string` | `ed25519:<base64>` signature (empty when unsigned). |

### `contributions` (v2)

The `contributions` object declares the plugin's surface area:

```json
{
  "contributions": {
    "commands": [
      {"name": "health_check", "readonly": true},
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
      "ru": {"notebooklm": {"title": "NotebookLM"}},
      "en": {"notebooklm": {"title": "NotebookLM"}}
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
| `i18n` | `object` | Translation bundles keyed by locale (`ru`, `en`). Keys are **nested objects** whose string leaves are translations — the FE resolver (`walkBundle`) walks dot-paths through nested objects. Flat keys (e.g. `"myplugin.title"`) never resolve. Labels are i18n key strings resolved via `t("plugin.{id}.{key}")`. |
| `storage` | `object` | Storage declaration. `sqlite: true` enables per-plugin SQLite at `data/plugins/{id}/plugin.db`. `migrations` is `"raw_sql"`, `"alembic"`, or `null`. |

### Settings & environment

There is no generic settings-injection mechanism. Plugins receive
`db_path`, `data_dir`, and `plugin_id` in the `plugin.init` handshake.
Storage-declaring plugins additionally receive `TOKEN_ENCRYPTION_KEY`
via the process environment (so secrets at rest use the same Fernet key
as the core). Any other configuration a plugin needs must be fetched
via its own RPC commands (e.g. reading from its own SQLite database or
requesting values through `call_host` reverse-RPC).

### Extras

Unknown fields are tolerated (tolerant reader) and preserved in
`manifest.extras`. `author` and `description` are forwarded to the
marketplace when publishing.

### Engine gate

The host declares its service-plugin engine version as
`SERVICE_ENGINE_VERSION` (currently `"0.3.0"`). At discovery and sandbox
install, a v2 plugin's `engine.min` is compared against this version
using `semver_sort_key` — a sort key that respects semver 2.0.0
prerelease ordering.

**`engine.api` backward compat:** v1 manifests predate the `engine.api`
field. When `api` is absent, it defaults to `1` (v1 semantics: CalVer
`engine.min`, no semver engine gate at discovery). Present but wrong
type (non-int) → still raises. The resolved `api` level is stored back
into the manifest's `engine` dict so downstream consumers see it
explicitly.

**`engine.min` format per api level:**

| `api` | `min` format | Example | Gate applies? |
|-------|-------------|---------|----------------|
| absent (default `1`) | CalVer `YYYY.MM` | `"2026.08"` | No (v1 data plugins) |
| `1` | CalVer `YYYY.MM` | `"2026.08"` | No (v1 data plugins) |
| `>= 2` | semver 2.0.0 | `"0.3.0"`, `"0.4.0-alpha"` | Yes (v2 service plugins) |

**Prerelease ordering (semver 2.0.0 §11):** the sort key is
`(major, minor, patch, is_release, prerelease_key)` where `is_release`
is `1` for a release and `0` for a prerelease. This means:

| `engine.min` | vs `SERVICE_ENGINE_VERSION` (`"0.3.0"`) | Gate result |
|-------------|------------------------------------------|-------------|
| `"0.3.0"` | equal release | **accepted** (not strictly newer) |
| `"0.2.9"` | lower release | **accepted** |
| `"0.3.0-rc.1"` | same-triple prerelease ≤ release | **accepted** |
| `"0.3.0-alpha"` | same-triple prerelease ≤ release | **accepted** |
| `"0.4.0-alpha"` | higher-triple prerelease > release | **rejected** |
| `"0.4.0"` | higher release | **rejected** |
| malformed | not valid semver | **soft-skip** (never crash) |

The key invariant: a prerelease of the SAME triple (`0.3.0-rc.1`) sorts
BELOW the release of that triple (`0.3.0`), so it is accepted. A
prerelease of a HIGHER triple (`0.4.0-alpha`) still sorts ABOVE the
current release (`0.3.0`) because the major.minor.patch fields dominate,
so it is rejected.

Malformed `engine.min` never crashes discovery or sandbox install — the
gate catches `ValueError` and soft-skips the plugin with a warning log.

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
| `plugin.init` | host→plugin | `{engine_api, plugin_id, db_path, data_dir, supported}` | `{plugin_id, db_path, data_dir, capabilities}` | Handshake. Called once at startup. `engine_api` is the host's engine API level (currently `2`). The plugin stores `db_path` for SQLite access. `supported` / `capabilities` — see [Handshake fields](#handshake-fields). |
| `plugin.call` | host→plugin | `{name: <str>, params: <dict>}` | any | Dispatch a command. `name` matches a `contributions.commands[].name`. Unknown name → JSON-RPC error `-32601`. |
| `plugin.ping` | host→plugin | `{}` | `"pong"` | Health check. Host uses this for liveness. |
| `plugin.shutdown` | host→plugin | `{}` | `null` | Graceful shutdown. Plugin should clean up and exit. |
| `plugin.call` (`_migrate_db`) | host→plugin | `{from_version, to_version}` | `{from_version, to_version}` | Reserved call name. Called after `plugin.init` when `contributions.storage.migrations` is set. The plugin creates/migrates its SQLite tables. |

### Handshake fields

- **`supported`** (host→plugin, in `plugin.init` params) — the optional
  host features available in this session. The plugin may adapt its
  behavior to their presence but must not hard-require them. Current
  values: `"reverse_rpc"` (the host serves plugin→host `server.call_host`
  requests) and `"caller_identity"` (`plugin.call` params carry
  `caller_user_id`).
- **`capabilities`** (plugin→host, in the `plugin.init` result) — the
  plugin's opt-in features, declared by the plugin itself. Empty list by
  default; e.g. a plugin that uses `server.call_host` declares
  `["reverse_rpc"]`. Do not invent values beyond the contract — unknown
  capabilities are ignored by the host.

The scaffold template's `_handle_init` returns
`{"plugin_id", "db_path", "data_dir", "capabilities": []}` and stores
`supported` in `_Ctx` for later use.

### Metrics

The host serves per-plugin call statistics as
`plugin.{id}.metrics` (HTTP: `POST /api/plugin.{id}.metrics`):

```json
{
  "calls": 12,
  "errors": 1,
  "avg_latency_ms": 3.4,
  "last_error": "boom",
  "by_command": {
    "health_check": {"calls": 10, "errors": 0},
    "echo": {"calls": 2, "errors": 1}
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `calls` | `int` | Total dispatched calls since the plugin started. |
| `errors` | `int` | Calls that returned an error. |
| `avg_latency_ms` | `float` | Average dispatch latency in milliseconds. |
| `last_error` | `str \| null` | Message of the most recent error (`null` when none). |
| `by_command` | `dict` | Per-command breakdown: `{name: {"calls": int, "errors": int}}`. |

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
server.register("health_check", handle_health_check)
server.register("echo", handle_echo)
server.serve()  # blocks until plugin.shutdown
```

`RpcPluginServer` handles `plugin.init`, `plugin.ping`,
`plugin.shutdown`, and `plugin.call` dispatch automatically. Handler
exceptions are caught and returned as JSON-RPC errors.

### Vendored server (standalone operation)

When `autoreg` is not on `sys.path` (standalone plugin without the
host's Python tree), the generated `__main__.py` uses a 3-line
try-import that falls back to a **vendored** copy of
`RpcPluginServer`:

```python
try:
    from autoreg.plugin.rpc import RpcPluginServer
except ImportError:
    from ._vendor.rpc_server import RpcPluginServer
```

The vendored module (`<pkg>/_vendor/rpc_server.py`) is extracted from
the canonical `autoreg/plugin/rpc.py` at scaffold/dev-install/publish
time by `stitch_plugin_tools`. It contains the server-side subset only
(`RpcPluginServer`, exception classes, `_error` helper) — no client-side
code. The vendored file is stdlib-only (json, sys, threading, time,
typing) and importable standalone.

The `dev-install` and `vendor` commands refresh `<pkg>/_vendor/` from
the canonical source (idempotent byte-refresh), so the dev install
always carries the current vendored server. The publish workflow
vendors into the staged copy before signing.

---

## 4. Declarative UI Schema

When `contributions.ui.kind = "declarative"`, the host renders the
plugin's page from a fixed **nodes vocabulary**. No arbitrary JavaScript
or HTML from the plugin enters the frontend.

### Boundary rule

The declarative vocabulary covers **fixed-layout pages**: headings,
sections, fields, tables, buttons, card grids, and rendered markdown.
Pages that need polling/realtime, arbitrary HTML/rich-text (the
`markdown` node renders a safe subset only — no raw HTML passthrough),
drag-and-drop, or virtual scrolling must use `kind = "core_page"` (a
host page that binds to plugin commands). Anything beyond the node
dictionary stays `core_page`.

The vocabulary above is the **frozen v2 contract**: node kinds and their
fields only change by a schema revision (new kinds are additive and the
renderer tolerates unknown kinds). Additive field revisions land without
new kinds — so far: `rowActions` on the table node (row-scoped actions,
see below), and the `card_grid` + `markdown` node kinds (additive
revision — existing manifests render unchanged). Known deferred
extensions (tabbed pages, modals) are v3 candidates — until then, pages
that need them stay `core_page`.

### Schema

```json
{
  "title": "plugin.my-plugin.title",
  "nodes": [
    {"kind": "heading", "text": "plugin.my-plugin.heading", "level": 2},
    {
      "kind": "section",
      "title": "plugin.my-plugin.section",
      "nodes": [
        {
          "kind": "table",
          "id": "items",
          "columns": [
            {"key": "id", "label": "ID"},
            {"key": "title", "label": "plugin.my-plugin.col.title"}
          ],
          "source": {"command": "list_items"}
        }
      ]
    },
    {
      "kind": "field",
      "field": "text",
      "id": "ask-field",
      "label": "plugin.my-plugin.ask",
      "placeholder": "plugin.my-plugin.ask.placeholder"
    },
    {
      "kind": "button",
      "id": "ask-btn",
      "label": "plugin.my-plugin.ask.btn",
      "command": "ask",
      "params": {"text": ""},
      "paramsFrom": {"text": "ask-field"},
      "variant": "primary"
    }
  ]
}
```

### Node kinds

| Kind | Purpose | Key fields |
|------|---------|------------|
| `heading` | Section heading. | `text`, `level?` (1-6). |
| `section` | Group of nodes with an optional title. | `title?`, `nodes: UiNode[]`. |
| `field` | Input field. | `field`: `"text"` \| `"select"` \| `"toggle"`, `id`, `label`, `value?`, `options?` (for select), `readonly?`, `placeholder?` (text/select hint; plain string or i18n key, resolved like `label`). |
| `table` | Data table with optional per-row actions. | `id`, `columns: [{key, label}]`, `source: {command, params?}`, `rowsKey?`, `rowActions?` (per-row action buttons; see below). `source.command` must be a readonly command returning rows. |
| `button` | Action button. | `id`, `label`, `command`, `params?`, `paramsFrom?` (param key → field `id` binding), `variant?`: `"primary"` \| `"secondary"` \| `"ghost"` \| `"danger"`. |
| `card_grid` | Responsive grid of cards (additive revision). | `id`, `source: {command, params?}`, `card: {title, subtitle?, body?, image?, action?}`. `source.command` must be a readonly command returning an array of row objects (or an object wrapping it under `"rows"`); each row renders one card. |
| `markdown` | Readonly rendered markdown (additive revision). | `id`, `source: {command, params?}`, `textKey?` (default `"text"`). `source.command` must be a readonly command returning an object whose `textKey` field holds the markdown string (a bare string response is accepted directly). |

### Labels

Labels are plain **i18n key strings** resolved by the frontend `t()`
(e.g. `"plugin.my-plugin.title"` or bundle keys). They are NOT inline
`{"ru": "...", "en": "..."}` objects — the frontend resolves keys via
the plugin's `contributions.i18n` bundle for the current locale.

### Field state and placeholders

The renderer keeps a **page-level field state map**: every `field` node
(including fields nested inside `section` nodes) contributes its initial
value (`value?`, default `""`) at page load, and all inputs render as
controlled components that write back into this map. `placeholder?` is an
optional hint for text/select fields, resolved like `label` (dotted
string → i18n key via the plugin bundle, otherwise rendered as-is).

### Button clicks

Button clicks invoke `plugin.{id}.{command}` via the host's
`safeInvoke` — the result is surfaced as a toast or table refresh.

Buttons bind field values through **`paramsFrom`**, a map of
`param key → field id`:

```json
{
  "kind": "button",
  "id": "ask-btn",
  "command": "ask",
  "params": {"text": ""},
  "paramsFrom": {"text": "ask-field"}
}
```

On click, the final params are `{...params}` with every key listed in
`paramsFrom` overridden by the current value of the referenced field.
Keys not listed in `paramsFrom` keep their static `params` value. A
`paramsFrom` entry that references a field id not present on the page
omits that key from the params (the renderer warns once). Buttons
without `paramsFrom` send their static `params` unchanged.

### Row-scoped table actions

Tables support per-row action buttons through `rowActions` (an additive
revision of the frozen v2 contract — older manifests without it render
unchanged). Each entry renders as a button in an extra trailing actions
column on EVERY row:

```json
{
  "kind": "table",
  "id": "totp-keys",
  "columns": [{"key": "label", "label": "plugin.my-plugin.label"}],
  "source": {"command": "list_keys"},
  "rowActions": [
    {
      "id": "remove-key-row",
      "label": "plugin.my-plugin.removeRow",
      "command": "remove_key",
      "variant": "danger",
      "params": {"reason": "manual"},
      "paramsFromRow": {"id": "id"}
    }
  ]
}
```

`label` resolves like every other label (i18n key or plain string).
**`paramsFromRow`** is the row analogue of the button's `paramsFrom`: a
map of `param key → COLUMN KEY of the row`. On click the final params
are `{...params}` with every `paramsFromRow` entry overridden by the
clicked row's value for that column (rows may carry more keys than the
table displays — e.g. totp rows expose `id` without a visible ID
column). A column key missing from the row omits that param entirely
(the renderer warns once). The command runs through the same
`plugin.{id}.{command}` invoke path as button nodes, and a successful
action refetches the table's `source` command so the mutation is
visible immediately.

`variant: "danger"` prompts a confirm dialog (`window.confirm`,
localized via the core `pluginUi.confirmRowAction` key) before invoking;
declining aborts without calling the command. Destructive actions
(delete/remove) MUST use `variant: "danger"`.

### Card grids

`card_grid` (an additive revision of the frozen v2 contract — older
manifests without it render unchanged) renders a responsive grid
(1 column → 2 on `sm` → 3 on `lg`) with one card per row returned by
`source.command`:

```json
{
  "kind": "card_grid",
  "id": "services",
  "source": {"command": "list_services"},
  "card": {
    "title": "name",
    "subtitle": "region",
    "body": "description",
    "image": "icon_url",
    "action": {
      "label": "plugin.my-plugin.refresh",
      "command": "refresh_service",
      "variant": "secondary",
      "params": {"reason": "manual"},
      "paramsFromRow": {"serviceId": "id"}
    }
  }
}
```

`source.command` is a readonly command returning an array of row
objects (or an object wrapping the array under `"rows"`); `null`
renders the empty state. Each of `card.title` / `subtitle` / `body` /
`image` is resolved per row: the string is FIRST treated as a COLUMN
KEY of the row — if the row has that key, the row's value is rendered;
if the row does NOT have the key, the string renders LITERALLY (so
static text like a shared subtitle works). `image` renders an `<img>`
with the resolved value as `src`; an empty resolved value renders no
image. Rows may carry more keys than the card displays (e.g. an `id`
used only by the action).

The optional `card.action` renders one button on EVERY card with the
exact semantics of table `rowActions`: `label` resolves like every
other label; `paramsFromRow` maps `param key → COLUMN KEY of the row`
and overrides `{...params}` on click (a missing column omits that param
and warns once); the command runs through the same
`plugin.{id}.{command}` invoke path; a successful invocation refetches
the grid's `source` command; `variant: "danger"` prompts the same
confirm dialog before invoking.

### Markdown

`markdown` (an additive revision of the frozen v2 contract) renders
readonly markdown fetched from a plugin command:

```json
{
  "kind": "markdown",
  "id": "readme",
  "source": {"command": "get_readme", "params": {"lang": "en"}},
  "textKey": "text"
}
```

`source.command` is a readonly command returning an object; `textKey`
(default `"text"`) names the field holding the markdown string. A bare
string response is accepted as the markdown text directly; `null`
renders the empty state.

Rendering is a **safe subset** — headings (`#`–`######`), bold, italic,
inline code, fenced code blocks, links, unordered/ordered lists, and
paragraphs. The renderer maps markdown DIRECTLY to React elements: no
`dangerouslySetInnerHTML`, no HTML parsing, so raw HTML in the source
(e.g. `<script>`) renders as inert visible text. Links are restricted
to `http(s)`/`mailto` URLs — any other scheme (notably `javascript:`)
renders its text without a hyperlink. Anything beyond the subset
degrades to plain text; pages that need full rich-text/HTML stay
`core_page`.

---

## 5. i18n Bundles

Translation bundles live in `contributions.i18n`:

```json
{
  "i18n": {
    "ru": {"myplugin": {"title": "Мой плагин"}},
    "en": {"myplugin": {"title": "My Plugin"}}
  }
}
```

The frontend `t()` function resolves keys in the form
`plugin.{id}.{key}` by walking the dot-path through the plugin's
nested bundle for the current locale. For example,
`plugin.myplugin.myplugin.title` walks `bundle["myplugin"]["title"]`.
Missing keys return the key string as-is (no crash). Bundles MUST be
nested objects — flat keys (e.g. `"myplugin.title"`) never resolve
because `walkBundle` walks each path segment as a separate object key.

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

The in-repo reference plugins (`plugins-src/`) commit their
`_vendor/rpc_server.py`, so a bare clone runs them standalone
(`python -m <module>` from the plugin dir) without `pip install -e`.
`dev-install` and the `vendor` command refresh `_vendor/` from the
canonical `autoreg/plugin/rpc.py` on demand, and discovery warns when a
package's vendored server drifts.

### Prerequisites

The `stitch_plugin_tools` package must be importable. Either install it
editable from the repo root (one-time):

```bash
pip install -e python/
```

Or run all `python -m stitch_plugin_tools` commands from the `python/`
directory (where `stitch_plugin_tools/` is a direct subpackage). The
`sign` and `dev-install` commands take a package directory argument, so
you can pass an absolute path regardless of cwd:

```bash
# From repo root (after `pip install -e python/`):
python -m stitch_plugin_tools sign /abs/path/to/my-plugin/ --key /abs/path/to/private.key

# Or from python/ dir (no install needed):
cd python/
python -m stitch_plugin_tools sign /abs/path/to/my-plugin/ --key /abs/path/to/private.key
```

### Quick start

```bash
# 1. Scaffold a new service plugin (from repo root after `pip install -e python/`):
python -m stitch_plugin_tools new my-plugin/ --id my-plugin

# 2. Exercise commands instantly in the local REPL (no host boot):
python -m stitch_plugin_tools run my-plugin/

# 3. Run the plugin's own tests (tests/test_plugin_protocol.py):
python -m stitch_plugin_tools test my-plugin/

# 4. Generate a signing keypair (one-time):
python -m stitch_plugin_tools keygen --out keys/

# 5. Sign the package (optional in dev mode, required for production):
python -m stitch_plugin_tools sign my-plugin/ --key keys/private.key

# 6. Dev-install to plugins-local:
python -m stitch_plugin_tools dev-install my-plugin/

# 7. Start the host with dev mode:
STITCH_DEV_MODE=1 python -m stitch_backend
```

The author loop is: `new` -> edit handlers -> `run` (exercise commands
instantly, watch stderr) -> `test` -> `dev-install` for host-level
checks.  `run` spawns the plugin child with `RpcPluginClient`, streams
child stderr live to the tool's stderr prefixed `[<plugin_id>]`, drives
a line-based REPL on stdin (`<command> [json-params]` -> pretty-printed
result), and stubs reverse-RPC `engine.oauth.*` requests so plugins
that use `server.call_host` fail gracefully instead of hanging.  Built
-ins: `ping`, `init-info` (handshake result + capabilities), `logs`
(last 50 child stderr lines), `help`, `exit`/`quit`/EOF/Ctrl-C.

### Upgrading an authored plugin

When the scaffold conventions change, migrate an existing package with
`upgrade` — it rewrites only the canonical regions (vendored server,
`_generated_by` marker, generated manifest fields) and never touches
your handlers, storage schema, or contributions:

```bash
# 1. Preview — writes <package>/upgrade.diff, changes nothing:
python -m stitch_plugin_tools upgrade my-plugin/

# 2. Review the diff, then apply:
python -m stitch_plugin_tools upgrade my-plugin/ --apply
```

The v2→v3 migration replaces the inline `RpcPluginServer` fallback
class with a 3-line try-import + creates `_vendor/rpc_server.py` from
the canonical source. The `dev-install` command also refreshes
`_vendor/` from canonical on each install (idempotent byte-refresh), so
the dev install always carries the current vendored server.

Packages without a `_generated_by` marker, `generated_by` manifest
field, or v2-era inline fallback block predate scaffold v2 and are
reported as legacy (manual migration — see
`docs/plugin-authoring.md` §7).

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

### Vendor drift detection

On startup, `_start_one` checks each package's `<pkg>/_vendor/rpc_server.py`
against the canonical source text. The vendored file header embeds
`_VENDOR_SOURCE_SHA256` — a SHA-256 computed over the canonical text
**excluding the hash line itself** (avoiding self-reference: the hash
line's value depends on the hash, so including it would create an
unsolvable fixed-point).

When the vendored file drifts (hand-edited, or generated from a
different canonical source), the host logs a **WARNING** naming the
plugin and the fix command (`python -m stitch_plugin_tools vendor
<package>`). The plugin **still starts** — drift is a visibility nudge,
not a block. The `upgrade` tool's vendor region and `dev-install`
refresh exist to fix drift; discovery only warns.

Packages without a `_vendor/` dir also return `False` from
`vendored_matches_canonical()` — the warning fires but startup
proceeds (the plugin may use the `autoreg.plugin.rpc` import path
instead of the vendored fallback).

### `list_service_plugins`

The readonly command `list_service_plugins` returns all discovered
service plugins with their status, version, commands, UI metadata,
and i18n bundles — everything the frontend needs to render dynamic
tabs and pages.  Sandbox plugins are **never** surfaced here (they
are per-user, not global).

---

## 8.1. Developer Sandbox (server)

The **developer sandbox** lets an authenticated plugin author install a
plugin from their own git source into a **per-user sandbox scope** on
the server.  The sandboxed plugin runs on the server inside the user's
private scope, is visible and callable **only by its owner**, and
**shadows** any global plugin with the same id for that owner.

### Storage layout

```
<base>/sandbox/<user_id>/<plugin_id>/          # package dir
<base>/sandbox/<user_id>/<plugin_id>-data/     # data dir (plugin.db)
```

`<base>` is the same root as `plugins-local/` (honors
`STITCH_PLUGINS_DIR`).  The data dir is kept beside the package dir
with a `-data` suffix so uninstalling the package never nukes the data
dir in one `rmtree` (the lifecycle code removes them independently).

### Gates

Sandbox installs are **dev-tier** — they require `STITCH_DEV_MODE=1`
OR the caller's role to be `admin` (OR `trust=True` passed explicitly).
This mirrors `sources._gate_dev` semantics so production servers can
lock the feature down by leaving the flag off and not granting admin.

Community sandbox caps **always** apply to sandbox hosts regardless of
env: 5s call timeout + 256MB memory limit (same as community-origin
hosts — unsigned subprocesses running on the server).

### Install flow (`sandbox_install`)

```json
{
  "url": "https://github.com/author/my-plugin",
  "ref": "main",
  "sha256": null,
  "trust": false,
  "force": false
}
```

1. Require an authenticated caller (`_caller_user_id` present; guests
   → 403).
2. Dev-tier gate (`STITCH_DEV_MODE` OR admin role OR `trust=True`).
3. Fetch via `sources.fetch` (git clone or release download + sha256
   verify — reuses the existing fetch machinery, no duplication).
4. Validate manifest; refuse `engine.min` newer than
   `SERVICE_ENGINE_VERSION`.
5. Apply TOFU pin per `(user_id, plugin_id)` — scoped pins live in a
   separate file (`sandbox_plugin_pins.json`); global pins are
   untouched.  Pin mismatch without `force=True` → refuse.
6. Copy package to `<base>/sandbox/<user_id>/<plugin_id>/`.
7. Register manifest in the sandbox manifest registry.
8. Start or refresh the sandbox host (on-demand — see lifecycle).

Returns `{success, plugin_id, version, pinned_sha}`.

### Lifecycle

Sandbox hosts are **never** started at app boot.  They are started
**on demand** when the owner routes a `plugin.{id}.{cmd}` call to
their sandbox (lazy start via `ensure_sandbox_host`).

A lightweight periodic task (60s tick, started in the app lifespan)
stops hosts idle > 15 minutes (`host.stop()`).  Stopped hosts stay
registered for cheap restart — the next call from the owner
re-starts them via `ensure_sandbox_host`.

`stop_all_sandbox()` is called on app shutdown (pre-sets `_stopping`
on every sandbox host so the crash monitor doesn't race the
supervisor's kill-tree).

### Routing (shadowing)

When a caller routes `plugin.{id}.{cmd}`:

| Caller | Sandbox host exists for `(caller, id)`? | Route |
|--------|------------------------------------------|-------|
| Authenticated owner | Yes | **Sandbox host** (bypasses entitlement gate — it's the owner's dev artifact) |
| Authenticated non-owner | No (lookup is keyed by `caller_user_id`) | Global host (normal entitlement gate) |
| Guest (no session) | No (`caller_user_id` is None) | Global host (normal entitlement gate) |
| Any | No sandbox + no global host | 404 |

The `metrics` host-served special-case works for sandbox hosts too
(served from host counters, no RPC roundtrip).

### Owner commands

| Command | Params | readonly | Description |
|---------|--------|----------|-------------|
| `sandbox_install` | `{url, ref?, sha256?, trust?, force?}` | No | Install from git/release source into the caller's sandbox. |
| `sandbox_list` | `{}` | Yes | List the caller's sandbox plugins: `{id, version, status, pinned_source}`. |
| `sandbox_logs` | `{plugin_id, lines?}` | Yes | Last N lines from the sandbox host's stderr ring buffer. |
| `sandbox_restart` | `{plugin_id}` | No | Stop+start the sandbox host. |
| `sandbox_uninstall` | `{plugin_id}` | No | Stop host + remove package/data dirs + drop registry + remove scoped pin. |

All commands are scoped strictly to `_caller_user_id` — guests get
403, and a user never sees another user's sandbox (404 for unknown /
not-owned ids).

### Security checklist

- **Path safety**: `plugin_id` is validated by the manifest id regex
  (`[A-Za-z0-9][A-Za-z0-9_-]*`) before any path join — no traversal.
- **Data dir isolation**: a sandbox host's `data_dir` is under the
  user's sandbox dir (`<base>/sandbox/<user_id>/<plugin_id>-data`),
  overriding the host's default data dir.
- **No global exposure**: sandbox hosts are never surfaced via
  `list_service_plugins` (global discovery list stays unchanged).
- **TOFU pin**: scoped per `(user_id, plugin_id)`; mismatch refuses
  without `force` (force is owner-implicit since the command is
  scoped to the caller).
- **Sidecar name isolation**: sandbox hosts use
  `sidecar_name = "sandbox:<user_id>:<plugin_id>"` so two users with
  the same plugin id don't collide on the supervisor's
  `plugin:<plugin_id>` namespace.

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

> **Tip:** run `upgrade --apply` (§8) before publishing a package
> authored against an older scaffold — it touches the manifest, so
> re-sign afterwards (the `publish` command signs for you when `--key`
> is passed).

### Community catalog (source index)

The community catalog (`StitchWB/stitch-plugin-catalog`) is a
**source index**: each entry points at a git repo or a GitHub release
tarball — the catalog no longer hosts zip packages.  Installation
reuses the existing `install_from_source` machinery (git clone or
release download + sha256 verify) with **TOFU pin protection** so a
compromised catalog entry pointing at a different ref or tarball is
surfaced as a visible pin mismatch.

#### Entry shapes

A catalog entry MAY carry a `source` field in addition to the legacy
fields.  Three shapes are accepted:

**Legacy (zip-era, backward compatible):**
```json
{
  "id": "kiro-autoreg",
  "version": "1.0.0",
  "path": "plugins/kiro-autoreg/1.0.0",
  "sha256": "<hex64>"
}
```
Legacy entries install via the old zip-download flow (unchanged).  No
TOFU pin is recorded.

**Git source:**
```json
{
  "id": "my-plugin",
  "version": "2.0.0",
  "source": {
    "type": "git",
    "url": "https://github.com/author/my-plugin",
    "ref": "main"
  }
}
```
`ref` is a branch, tag, or 40-char commit SHA (default: `main`).  The
install clones `url@ref`, pins the resolved commit SHA into a
`.source.json` sidecar, and installs to `plugins-local/{id}/` (dev
tier — requires `STITCH_DEV_MODE=1` or `trust=True`).

**Release source:**
```json
{
  "id": "my-plugin",
  "version": "3.0.0",
  "source": {
    "type": "release",
    "url": "https://github.com/author/my-plugin/releases/download/v3.0.0/pkg.tar.gz",
    "sha256": "<hex64>"
  }
}
```
The install downloads the tarball, verifies `sha256` **before**
extract, and routes by signature: signed → verified cache install;
unsigned → community dir (gated by `STITCH_COMMUNITY_SERVICES` for
`kind=service` or `STITCH_COMMUNITY_ENABLED` for `kind=data`).

Malformed `source` (unknown type, missing `url`, non-hex64 `sha256`)
→ the entry is listed in the catalog but install is refused with a
clear reason.

#### TOFU pinning

After any successful source install, the plugin's pin is recorded in
`<app_data>/plugin_pins.json`:

```json
{
  "my-plugin": {
    "sha": "<commit_sha or release sha256>",
    "url": "<source url>",
    "installed_at": "<iso8601 utc>"
  }
}
```

- **Git mode**: pin = commit SHA from the `.source.json` sidecar.
- **Release mode**: pin = `sha256` from the catalog entry.

On installing a `plugin_id` that already has a pin:

| Prior pin | New pin | `force` | Outcome |
|-----------|---------|---------|---------|
| none | any | — | Proceed + record |
| same sha | same | — | Proceed + re-record |
| different sha | different | `False` | **Refuse** — error names both shas |
| different sha | different | `True` | Proceed + replace pin |

Release-mode pins are checked **before** install (sha256 is known
upfront).  Git-mode pins are checked **after** clone (commit SHA is
only known post-clone); on refusal the new install is rolled back
(removed from `plugins-local/`).

#### `install_community_plugin` command

```json
{
  "id": "my-plugin",
  "version": "2.0.0",
  "force": false,
  "trust": false
}
```

- `force` — TOFU pin override (accept a changed pin).
- `trust` — admin override for the dev-tier gate (git mode only;
  mirrors the `--trust` CLI flag on `install-from`).

Legacy entries (no `source`) ignore `force`/`trust` and use the
existing zip flow.

#### `get_community_catalog` command

Each entry is enriched with `sourceType` (`"git"` / `"release"` /
`"zip-legacy"` / `"malformed"`) and `sourceUrl` for the UI.

### Catalog lint (`catalog-lint`)

The catalog repo's CI calls `catalog-lint` on every PR to catch
malformed entries before merge.  It validates **offline** — never
fetches anything:

```bash
python -m stitch_plugin_tools catalog-lint catalog.json
```

Rules:
1. JSON must parse and be a dict with a `plugins` array.
2. Each entry must have `id` (str) and `version` (semver).
3. `source.type` must be `"git"` or `"release"`.
4. git: `url` required.  release: `url` + `sha256` (hex64) required.
5. Duplicate `id@version` → error.
6. Legacy entries (no `source`) accepted (backward compat).

Exit 0 on success, 1 on any error.  A per-entry report is printed.

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
      "page": { /* nodes vocabulary — see §4 */ }
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
| `upgrade <package_dir> [--apply]` | Migrate an authored plugin to the current scaffold conventions. Previews to `<package>/upgrade.diff`; `--apply` writes. Only canonical regions are rewritten (vendored `_vendor/rpc_server.py`, `_generated_by` marker, generated manifest fields) — author code is never clobbered. Legacy (unmarked) packages get a manual-migration checklist. Handles v2→v3 generation migration (inline fallback → try-import + vendored server). |
| `sync-template [--out <dir>] [--license <file>]` | Regenerate the repo-root `template/` directory (published as the GitHub template repo [StitchWB/stitch-plugin-template](https://github.com/StitchWB/stitch-plugin-template)) from the scaffold internals: scaffolded `stitch-plugin-template` package + vendored server + CI workflow, `.gitignore`, LICENSE, template-grade README, and a raw-stdin starter test. |
| `keygen --out <dir>` | Generate an ed25519 keypair. |
| `sign <package_dir> --key <private.key>` | Sign a plugin package. |
| `verify <package_dir> --pubkey <public.key>` | Verify a package signature. |
| `publish <package_dir> [--server-url …] [--key …]` | Sign + zip + POST to server. |
| `dev-install <package_dir>` | Copy package to `plugins-local/`. Refreshes `_vendor/rpc_server.py` from canonical on each install. |
| `run <package_dir>` | Interactive plugin REPL — spawn, stream child stderr live to the tool's stderr prefixed `[<plugin_id>]`, drive commands from stdin (`<command> [json-params]` -> pretty-printed result), and stub reverse-RPC `engine.oauth.*` requests so plugins that use `server.call_host` fail gracefully instead of hanging. Built-ins: `ping`, `init-info`, `logs`, `help`, `exit`. The author loop: `new` -> edit handlers -> `run` -> `test` -> `dev-install`. |
| `test <package_dir>` | Run the plugin's own tests via the venv pytest (`python -m pytest <dir>/tests -q --timeout=60`). No tests dir -> friendly message pointing at the template's `tests/test_plugin_protocol.py`. pytest absent -> error with install hint. |
| `vendor <package_dir>` | Vendor the canonical `RpcPluginServer` into `<pkg>/_vendor/rpc_server.py`. Idempotent — skips the write when the file is already canonical. Run after `dev-install` or before `publish` to refresh the vendored server. |
| `pack-engine <out_dir> [--version …]` | Assemble an engine-pack (captcha solvers). |
| `codes {issue\|list} [--server-url …] [--admin-key …]` | Issue and list activation codes (admin). |
| `install-from <url> [--ref\|--release] [--sha256] [--trust]` | Fetch + install a plugin from a git repo or release tarball. |
| `catalog-lint <catalog.json>` | Validate a community catalog offline (for catalog repo CI). Never fetches anything. |
| `drift [--server-url …] --plugin <id> [--version …] [--window-hours …] [--package-dir …] [--apply]` | **v1 selector tooling.** Fetch drift report + propose selector weight rerank. Expects `scenario.json` — not applicable to v2 service plugins. |
| `publish-selectors [--server-url …] --plugin-id <id> --plugin-version <ver> --package-dir <dir> [--note …]` | **v1 selector tooling.** Publish a selector overlay pack (hot update). Expects `scenario.json` — not applicable to v2 service plugins. |

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
