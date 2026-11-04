# MCP server

Stitch Manager ships a local [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio. It exposes the backend command surface as typed MCP tools so
an IDE agent (opencode, Claude Desktop, Cursor, Kiro, …) can drive the client:
list/add/refresh accounts, run registrations, replay scenarios, inspect safety
state.

Everything runs in-process on the local machine; no network listener is opened.

## Start

```bash
python -m stitch_backend.mcp_server
# or the console script installed with the package:
stitch-mcp
```

The process speaks MCP on **stdout**. All logging is routed to **stderr** — a
client that pipes stdout into a JSON parser must also drain stderr, or the
server blocks once the stderr pipe fills.

## Tools

Two groups are registered.

**Core tools** — one typed tool per core command (`server.py:CORE_TOOLS`):
accounts (15), registration (10), scenarios (8), flows (5), proxy (5),
turnstile solver (3), replenishment (3), AWS (3), MCP bridge (1), settings (2).
Parameters are generated from each command's Pydantic request model
(camelCase aliases preserved); a truly no-arg command takes no arguments.
Commands whose handler builds its request by hand (no Pydantic model, e.g.
`validate_account`, scenario and flow handlers) expose a single optional
`args` object instead, so any argument the command documents can still be
passed.

**Meta tools:**

| Tool | Purpose |
| --- | --- |
| `list_mcp_commands` | List registered backend command names (optional substring filter). |
| `execute_any` | Escape hatch: invoke any registered command by name. |
| `get_backend_health` | Command count, declared vs registered tool counts. |
| `get_safety_status` | Write-guard state: autonomy, dry-run, kill-switch, journal path. |
| `read_critical_journal` | Tail the critical-action journal (`limit`, max 500). |
| `get_mcp_doctor` | Diagnose the surface: drift, schema coverage, warnings. |

### Account listings

`list_accounts` / `get_accounts` default to `limit=100`, `includeSecrets=false`
at the MCP boundary so a single call cannot dump every row's tokens. Pass
`includeSecrets=true` (and a higher `limit`) to opt back in. The HTTP/UI path
keeps its previous behaviour (all rows, secrets included).

## Policy and permissions

MCP calls carry a caller identity (`_mcp_caller`): role `admin` by default,
because the stdio process is a trusted local surface. Override with:

| Env var | Meaning |
| --- | --- |
| `STITCH_MCP_ROLE` | Caller role (default `admin`). |
| `STITCH_MCP_USER_ID` | Optional caller user id. |

Commands that the HTTP dispatcher marks `admin_only` are rejected here too when
the role is not `admin`, and every command runs under the same per-command
timeout the dispatcher enforces (default 25 s; `-1` disables).

## Write safety

Write commands route through the same guards as the rest of the backend:

| Env var | Meaning |
| --- | --- |
| `STITCH_MCP_AUTONOMY_ENABLED` | Master switch (default on). |
| `STITCH_MCP_DRY_RUN` | Preview writes without executing (default off). |
| `STITCH_MCP_ALLOW_ACCOUNT_PERSIST` | Allow composed-flow runs to persist accounts. |
| `STITCH_MCP_KILL_SWITCH_FILE` | Override kill-switch path. |
| `STITCH_MCP_CRITICAL_JOURNAL_PATH` | Override journal path. |

Defaults live under `~/.stitch-manager/`: creating the `mcp.kill-switch` file
blocks all writes immediately; every write appends a line to
`mcp-critical-actions.ndjson`. Inspect both at runtime with `get_safety_status`
and `read_critical_journal`.

## Wiring into an IDE

Register the server as a local (stdio) MCP server. For opencode, add to
`opencode.json`:

```json
{
  "mcp": {
    "stitch-manager": {
      "type": "local",
      "command": ["<repo>\\.venv\\Scripts\\python.exe", "-m", "stitch_backend.mcp_server"],
      "enabled": true
    }
  }
}
```

Use the interpreter that has the package installed (the project venv, or
`stitch-mcp` on `PATH`). A configuration change takes effect in a new session.

If something looks off, call `get_mcp_doctor` first: it reports declared-but-
unregistered tools, how many tools have a typed schema vs the open `args`
fallback, and any warnings.
