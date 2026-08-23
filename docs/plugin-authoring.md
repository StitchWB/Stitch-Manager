# Plugin Authoring — Command Naming & SPI Surface Contract

This document is the **command and SPI contract** for service-plugin
authors. It covers command naming policy, the SPI method-to-command
map, reserved names, versioning, and a pre-publish checklist.

> **Scope boundary:** this document governs the command surface and SPI
> surface that a `kind=service` plugin exposes to the host. The
> subprocess protocol (stdio JSON-RPC 2.0, `plugin.init` / `plugin.call`
> / `plugin.ping` / `plugin.shutdown`), the manifest schema, the
> declarative UI vocabulary, storage/migrations, entitlements, and the
> dev loop are documented in **[docs/service-plugins.md](service-plugins.md)** —
> that document is the protocol reference and is not duplicated here.

---

## 1. Scope & References

| Document | Covers |
|----------|--------|
| [docs/service-plugins.md](service-plugins.md) | Subprocess protocol, manifest v2, declarative UI, storage, entitlements, dev loop, publishing. |
| `python/stitch_backend/api/cmd_dispatcher.py` | HTTP dispatcher — routes `plugin.{id}.{cmd}` and dual-format commands. |
| `python/stitch_backend/domains/plugin_runtime/bridge.py` | `call_plugin_command` — entitlement check + RPC forward for namespaced commands. |
| `python/stitch_backend/domains/plugin_runtime/spi_bridge.py` | `_SPI_NAME_MAP` + `SPI_METHOD_MAP` — the SPI proxy that forwards protocol methods to plugin commands. |
| `python/stitch_backend/core/spi.py` | SPI Protocol interfaces (`TotpProvider`, `MailInboxSPI`, `EmailVerificationProvider`, `OAuthProvider`) and the registry with built-in fallback. |
| `python/stitch_backend/domains/plugin_runtime/*_dual.py` | Dual-routing maps (`TOTP_DUAL`, `SHEETS_DUAL`, `MAIL_DUAL`, …) — the exact name maps a dual-mirroring plugin MUST match. |

A service plugin runs as a subprocess over stdio JSON-RPC 2.0, entered
via `python -m <entry.module>`. The SDK class is
`autoreg.plugin.rpc.RpcPluginServer`; when `autoreg` is not on
`sys.path` (standalone plugin without the host's Python tree), the
generated template includes an inline equivalent — same protocol, no
external dependency. See [docs/service-plugins.md §3](service-plugins.md#3-using-rpcpluginserver)
for the server-side usage pattern.

---

## 2. Command Naming Policy

### 2.1 Shape: `snake_case` `verb_object`

Command names are `snake_case` following a `verb_object` shape
(`list_keys`, `upsert_profile`, `generate_code`). The host's
`_PLUGIN_ID_RE` (`[A-Za-z0-9][A-Za-z0-9_-]*`) constrains the **plugin
id** (no dots, no path separators); command names themselves are
free-form strings dispatched by `plugin.call`.

### 2.2 Plugin-scoped — short names are acceptable

Every plugin command is dispatched as `plugin.{id}.{cmd}` (parsed by
`bridge.parse_plugin_command`), so the plugin id is the namespace.
Short names like `list_keys` or `sync` are acceptable **because the
plugin id disambiguates them** — `plugin.stitch-totp.list_keys` and
`plugin.stitch-mail.list` never collide.

### 2.3 Dual-mirrored commands MUST match their `*_dual` map exactly

When a plugin mirrors a built-in command, the host installs a
dual-format route that forwards the built-in name to a plugin command
name **looked up in a fixed map**. The plugin's command name MUST
exactly match the value (right-hand side) in the corresponding map:

| Dual map file | Built-in prefix | Example mapping |
|---------------|-----------------|------------------|
| [`totp_dual.py`](../python/stitch_backend/domains/plugin_runtime/totp_dual.py) (`TOTP_DUAL`) | `totp_` / `totp_` (stripped) | `list_totp_keys` → `list_keys`, `add_totp_key` → `add_key` |
| [`sheets_dual.py`](../python/stitch_backend/domains/plugin_runtime/sheets_dual.py) (`SHEETS_DUAL`) | `google_sheets_` (stripped) | `test_google_sheets_connection` → `test_connection`, `fetch_google_sheets_dataset` → `fetch_dataset` |
| [`mail_dual.py`](../python/stitch_backend/domains/plugin_runtime/mail_dual.py) (`MAIL_DUAL`) | `email_` / `email_inbox_` (stripped) | `email_inbox_list` → `list`, `email_inbox_upsert_profile` → `upsert_profile` |

A mismatch (plugin ships `list_all_keys` but the map expects
`list_keys`) silently breaks the dual route — the built-in handler runs
unchanged and the plugin never takes over. There is no validation at
install time; the map is the contract.

### 2.4 Avoid generic single-word names unless mirroring

Avoid bare verbs (`list`, `sync`, `test_connection`) for **non-mirrored**
commands — they read as built-in names and confuse the dual-route
precedence in the dispatcher. The exception is when the plugin IS the
dual-mirror of an existing built-in (e.g. `test_connection` in
`SHEETS_DUAL` is correct because it mirrors
`test_google_sheets_connection`). For plugin-only commands, prefer the
`verb_object` shape (`list_notebooks`, `generate_audio`).

### 2.5 Never rename a shipped command

Renaming a command that has shipped is a breaking change:

- **Dual maps break** — the `*_dual` map still points at the old name;
  the dual route silently falls through to the built-in.
- **Frontend breaks** — the declarative UI `command` field and
  `safeInvoke` calls reference the old name; a rename makes the button
  invoke a non-existent command (JSON-RPC `-32601`).

New commands are **additive** — add new names, do not rename or remove
existing ones. If a command must change shape, add the new name and
keep the old one as a thin alias until the next major version.

---

## 3. SPI Surface Contract

A plugin may declare `contributions.spi` — a list of SPI **class names**
(the public contract). The host's `spi_bridge._SPI_NAME_MAP` translates
each class name to a core SPI registry constant, and
`spi_bridge.SPI_METHOD_MAP` drives a generated proxy that forwards each
protocol method to a plugin RPC command.

### 3.1 Declared SPI class names

| SPI class name (`contributions.spi`) | Core SPI constant | Protocol interface |
|---------------------------------------|-------------------|--------------------|
| `"MailInboxSPI"` | `mail_inbox` | `MailInboxSPI` |
| `"EmailVerificationProvider"` | `email_verification` | `EmailVerificationProvider` |
| `"TotpProvider"` | `totp` | `TotpProvider` |
| `"OAuthProvider"` | `oauth` | `OAuthProvider` |

Unknown class names are logged and skipped (tolerant reader) — a newer
manifest does not crash an older host.

### 3.2 Method → command map (`SPI_METHOD_MAP`)

The proxy forwards **only** the methods listed below. The command name
is looked up at call time via `self._spi_const`, so the same generated
method serves any SPI that declares it. Methods shared across SPIs
(e.g. `wait_otp` under both `mail_inbox` and `email_verification`) must
have identical params — the factory verifies this at install time.

#### `mail_inbox` (class `MailInboxSPI`)

| Protocol method | Plugin command | Params (required / default) |
|-----------------|----------------|----------------------------|
| `list_profiles` | `list_profiles` | `owner_id` (default `None`) |
| `wait_otp` | `wait_otp` | `email` (required), `subject_filter` (default `""`), `code_pattern` (default `None`), `timeout` (default `120.0`) |
| `sync` | `sync` | `profile_id` (required) |

#### `email_verification` (class `EmailVerificationProvider`)

| Protocol method | Plugin command | Params (required / default) |
|-----------------|----------------|----------------------------|
| `wait_otp` | `wait_otp` | `email` (required), `subject_filter` (default `""`), `code_pattern` (default `None`), `timeout` (default `120.0`) |
| `close` | *(local no-op — `cmd: None`)* | none |

> **Note on `close`:** the plugin has no persistent IMAP connection to
> release (the built-in `EmailService` is per-call), so `close` is a
> local no-op in the proxy — the plugin does not need to implement it.

#### `totp` (class `TotpProvider`)

| Protocol method | Plugin command | Params (required / default) |
|-----------------|----------------|----------------------------|
| `generate_secret` | `generate_secret` | none |
| `get_code` | **`generate_code`** | `secret` (required), `timestamp` (default `None`) |
| `verify_code` | `verify_code` | `secret` (required), `code` (required) |
| `count_owned_keys` | `count_owned_keys` | `owner_id` (default `None`) |
| `list_keys` | `list_keys` | none |

> **Name mismatch — `get_code` → `generate_code`:** the protocol method
> is `get_code` but the plugin command is `generate_code`. This is
> exactly why the method map must be explicit — blind forwarding would
> call `get_code`, which the plugin does not implement. A
> `TotpProvider` plugin MUST implement all five commands:
> `generate_secret`, `generate_code`, `verify_code`,
> `count_owned_keys`, `list_keys`.

#### `oauth` (class `OAuthProvider`)

| Protocol method | Plugin command | Params (required / default) |
|-----------------|----------------|----------------------------|
| `start_pkce_flow` | `start_pkce_flow` | `authorize_url`, `token_url`, `client_id` (required); `redirect_uri` (default `http://localhost:25584/api/oauth/callback`), `scope` (default `"openid profile email"`), `state` (default `None`) |
| `start_device_flow` | `start_device_flow` | `device_auth_url`, `token_url`, `client_id` (required); `scope` (default `""`) |
| `exchange_code` | `exchange_code` | `code`, `code_verifier`, `token_url`, `client_id` (required); `redirect_uri` (default `http://localhost:25584/api/oauth/callback`), `proxy` (default `None`) |

### 3.3 Partial SPI — degraded but safe

A plugin declaring an SPI it does not fully serve is **not** a hard
error. The proxy's `_forward` method catches `RpcCallError` /
`RpcTimeoutError` / `PluginCallTimeout` / `PluginNotRunning` and falls
back per-call to the built-in impl for that SPI (looked up via the
registry's internal `_impls` dict). If no built-in is registered, the
original exception is re-raised.

This means a `TotpProvider` plugin that ships `generate_secret` and
`list_keys` but omits `generate_code` will serve those two via RPC and
fall back to the built-in `pyotp`-backed impl for `get_code` /
`verify_code` / `count_owned_keys` — degraded but safe. The host's
`spi.resolve()` priority is: **healthy plugin impl > built-in impl**.

---

## 4. Reserved Names

### 4.1 `_migrate_db` (reserved command name)

`_migrate_db` is a **reserved** `plugin.call` name. When
`contributions.storage.migrations` is set, the host calls
`plugin.call` with `name = "_migrate_db"` and
`{from_version, to_version}` after `plugin.init` and before any regular
command. The plugin creates or migrates its SQLite tables in this call.
A plugin MUST NOT register a user command named `_migrate_db`.

### 4.2 Protocol methods (`plugin.init`, `plugin.ping`, `plugin.shutdown`)

These are JSON-RPC **method names** handled by `RpcPluginServer`
internally — they are not user commands. A plugin MUST NOT register a
user command named `init`, `ping`, or `shutdown` via
`server.register(...)`, because the host's `plugin.call` dispatch would
shadow them and the names are reserved for the protocol handshake,
liveness probe, and graceful shutdown.

| Reserved name | Layer | Purpose |
|---------------|-------|---------|
| `_migrate_db` | `plugin.call` command | Storage migration (called by host when `storage.migrations` is set). |
| `plugin.init` | JSON-RPC method | Handshake — host passes `{engine_api, plugin_id, db_path, data_dir}`. |
| `plugin.ping` | JSON-RPC method | Liveness probe — host uses for health checks. |
| `plugin.shutdown` | JSON-RPC method | Graceful shutdown — plugin cleans up and exits. |

---

## 5. Versioning

### 5.1 `version` — bump on every shipped change

`version` is Semver 2.0.0 (`MAJOR.MINOR.PATCH`), validated by the
manifest parser. Bump it on **every** shipped change — even a doc-only
or name-only fix. The loader picks the **newest** version from the cache
(sorted by semver tuple), so an unbumped version means the new code is
ignored at install time.

### 5.2 `engine.api` — protocol generation (int)

`engine.api` is an integer identifying the protocol generation the
plugin targets. The host runs with a fixed `ENGINE_API` (currently `2`).
A plugin whose `engine.api > ENGINE_API` is **skipped at load time**
with a warning log — this is the forward-compatibility gate (a newer
plugin that needs a protocol feature the host does not offer does not
load, rather than crashing at runtime).

Set `engine.api` to the lowest generation that supports every protocol
feature the plugin uses. Bump `engine.api` only when the plugin starts
using a feature from a newer protocol generation.

### 5.3 `engine.min` — minimum host engine version

`engine.min` declares the minimum host engine version the plugin
requires. The format is validated at parse time per API level:
`engine.api >= 2` requires semver 2.0.0 (e.g. `"0.3.0"`);
`engine.api == 1` requires CalVer `YYYY.MM` (e.g. `"2026.08"`, used by
signed v1 packages).

For v2 service plugins, `engine.min` is enforced at discovery: a plugin
whose `engine.min` is strictly newer than the host's service-plugin
engine version (`SERVICE_ENGINE_VERSION` in
`stitch_backend/domains/plugin_runtime/discovery.py`) is skipped with a
warning log — startup never crashes on a too-new plugin. Set it to the
host version you developed and tested against.

### 5.4 Summary

| Field | Type | Enforced? | Semantics |
|-------|------|-----------|-----------|
| `version` | semver string | Yes — loader picks newest | Bump on every shipped change. |
| `engine.api` | int | Yes — `api > ENGINE_API` → skipped | Protocol generation. Set to the lowest generation the plugin needs. |
| `engine.min` | semver string (api ≥ 2) / CalVer `YYYY.MM` (api 1) | Yes — format at parse time; v2 service plugins newer than `SERVICE_ENGINE_VERSION` skipped at discovery | Minimum host engine version. |

---

## 6. Checklist Before Publishing

1. **Command names match the dual maps (if mirroring).** If the plugin
   mirrors a built-in command, verify the command name matches the
   right-hand side of the corresponding `*_dual` map exactly
   (`TOTP_DUAL` / `SHEETS_DUAL` / `MAIL_DUAL` / …). A mismatch silently
   breaks the dual route.
2. **SPI commands are complete (if declaring an SPI).** If the plugin
   declares `contributions.spi`, verify every protocol method in the
   relevant `SPI_METHOD_MAP` section maps to a command the plugin
   implements. Partial SPI is degraded-but-safe (per-call built-in
   fallback), but a complete implementation is the contract.
3. **No reserved names.** The plugin does not register user commands
   named `_migrate_db`, `init`, `ping`, or `shutdown`.
4. **`readonly` flag is set correctly.** `contributions.commands[].readonly`
   is informational today (the host does not yet enforce it for plugin
   commands), but it documents intent and gates future enforcement.
   Mark read-only commands (`list_*`, `get_*`) with `readonly: true`;
   mark write commands with `readonly: false`.
5. **`version` is bumped.** Semver bumped from the previous shipped
   version — even for a one-line fix.
6. **`engine.api` is minimal.** Set to the lowest protocol generation
   the plugin needs (do not over-bump — a higher `engine.api` narrows
   the installable host range).
7. **Tests pass.** Plugin commands have tests covering the happy path
   and the dual-route fallback (dead host → built-in). See
   `python/tests/test_totp_plugin.py` and `python/tests/test_mail_dual.py`
   for the dual-route test pattern.
8. **Sign the package.** `python -m stitch_plugin_tools sign <pkg> --key keys/private.key`.
   Unsigned packages load only in dev mode (`STITCH_DEV_MODE=1`); the
   cache always requires a valid `ed25519:` signature.
9. **Dev-install smoke.** `python -m stitch_plugin_tools dev-install <pkg>`
   → `STITCH_DEV_MODE=1 python -m stitch_backend` → verify the plugin
   appears in `list_service_plugins` and its commands respond via
   `plugin.{id}.{cmd}`.
