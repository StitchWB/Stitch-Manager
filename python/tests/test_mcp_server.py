import asyncio
import subprocess
import sys
from pathlib import Path

from stitch_backend.core import command_registry
from stitch_backend.mcp_server import tools


def test_as_structured_wraps_non_dict():
    assert tools._as_structured({"a": 1}) == {"a": 1}
    assert tools._as_structured([1, 2]) == {"result": [1, 2]}
    assert tools._as_structured(5) == {"result": 5}
    assert tools._as_structured(None) == {"result": None}


def test_mcp_caller_defaults_to_admin():
    assert tools._mcp_caller()["_caller_role"] == "admin"


def test_mcp_listing_defaults_bound_and_redact():
    for name in ("list_accounts", "get_accounts"):
        assert tools._MCP_PARAM_DEFAULTS[name]["limit"] == 100
        assert tools._MCP_PARAM_DEFAULTS[name]["includeSecrets"] is False


async def test_policy_blocks_admin_only_for_non_admin():
    @command_registry.register_command("_mcp_test_admin_only", admin_only=True)
    async def _handler(params):
        return {"ran": True}

    result = await tools._invoke_with_policy(
        "_mcp_test_admin_only", {"_caller_role": "user"}
    )
    assert result["ok"] is False
    assert "admin" in result["error"]["message"]


async def test_policy_allows_admin_only_for_admin():
    @command_registry.register_command("_mcp_test_admin_only_ok", admin_only=True)
    async def _handler(params):
        return {"ran": True}

    result = await tools._invoke_with_policy(
        "_mcp_test_admin_only_ok", {"_caller_role": "admin"}
    )
    assert result["ok"] is True
    assert result["data"] == {"ran": True}


async def test_policy_enforces_per_command_timeout():
    async def _slow(params):
        await asyncio.sleep(30)
        return {}

    command_registry._COMMAND_REGISTRY["_mcp_test_slow"] = _slow
    command_registry._COMMAND_META["_mcp_test_slow"] = command_registry.CommandMeta(
        timeout=0.05
    )
    try:
        result = await tools._invoke_with_policy("_mcp_test_slow", {})
    finally:
        command_registry._COMMAND_REGISTRY.pop("_mcp_test_slow", None)
        command_registry._COMMAND_META.pop("_mcp_test_slow", None)
    assert result["ok"] is False
    assert result["error"]["code"] == "timeout"


def test_derive_param_specs_from_params_reads():
    import ast

    from stitch_backend.core.command_meta import _derive_param_specs, _synthesize_model

    tree = ast.parse(
        "async def h(params):\n"
        '    a = params.get("accountId")\n'
        '    b = params.get("provider", "kiro")\n'
        '    c = params.get("limit", 50)\n'
        '    d = params["requiredKey"]\n'
        '    e = params.get("_caller_role")\n'
        "    return a, b, c, d, e\n"
    )
    specs, open_key = _derive_param_specs(tree)
    by_name = {s.name: s for s in specs}
    assert open_key is None
    assert set(by_name) == {"accountId", "provider", "limit", "requiredKey"}
    assert by_name["provider"].annotation is str
    assert by_name["provider"].required is False
    assert by_name["limit"].annotation is int
    assert by_name["requiredKey"].required is True

    model = _synthesize_model("h", specs)
    assert model is not None
    assert set(model.model_fields) == {"accountId", "provider", "limit", "requiredKey"}
    assert model.model_fields["requiredKey"].is_required() is True
    assert not any(name.startswith("_") for name in model.model_fields)


def test_derive_param_specs_detects_open_payload():
    import ast

    from stitch_backend.core.command_meta import _derive_param_specs

    tree = ast.parse('async def h(params):\n    return params.get("settings", params)\n')
    specs, open_key = _derive_param_specs(tree)
    assert open_key == "settings"
    assert specs == []


def test_redact_secrets_masks_by_key_name():
    from stitch_backend.mcp_server.tools import _is_secret_key, _redact_secrets

    assert _is_secret_key("imap_password") is True
    assert _is_secret_key("imapPassword") is True
    assert _is_secret_key("localChatToken") is True
    assert _is_secret_key("google_sheets_service_account_json") is True
    assert _is_secret_key("proxy_list") is True
    assert _is_secret_key("token_refresh_enabled") is False
    assert _is_secret_key("password_length") is False
    assert _is_secret_key("theme") is False

    redacted = _redact_secrets(
        {"imap_password": "raw", "theme": "dark", "rows": [{"apiKey": "k", "id": 1}]}
    )
    assert redacted["imap_password"] == "********"
    assert redacted["theme"] == "dark"
    assert redacted["rows"][0]["apiKey"] == "********"
    assert redacted["rows"][0]["id"] == 1


def test_apply_list_policy_bounds_and_projects():
    from stitch_backend.mcp_server.tools import _apply_list_policy

    rows = [{"id": i, "name": f"n{i}"} for i in range(5)]
    assert _apply_list_policy(rows, limit=2, offset=0, fields=None) == rows[:2]
    assert _apply_list_policy(rows, limit=0, offset=3, fields=None) == rows[3:]
    assert _apply_list_policy(rows, limit=0, offset=0, fields=["id"]) == [{"id": i} for i in range(5)]
    assert _apply_list_policy({"a": 1}, limit=1, offset=0, fields=None) == {"a": 1}


def test_core_tools_register_under_bootstrap():
    code = (
        "import asyncio;"
        "from fastmcp import FastMCP;"
        "from stitch_backend.bootstrap import bootstrap;"
        "from stitch_backend.core.command_registry import list_commands;"
        "from stitch_backend.core.command_meta import get_all_command_meta;"
        "from stitch_backend.mcp_server.server import CORE_TOOLS;"
        "from stitch_backend.mcp_server.tools import register_all_tools;"
        "asyncio.run(bootstrap());"
        "mcp=FastMCP('t');"
        "n=register_all_tools(mcp, core_only=True);"
        "present=[c for c in CORE_TOOLS if c in set(list_commands())];"
        "assert n==len(present), (n, len(present));"
        "meta=get_all_command_meta();"
        "bad=[c for c in present if meta[c].schema_source=='unparsed'];"
        "assert not bad, bad"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_surface_allowlist_levels(monkeypatch):
    from stitch_backend.mcp_server import server

    monkeypatch.setenv("STITCH_MCP_SURFACE", "meta")
    assert server._surface_allowlist() == set()
    monkeypatch.setenv("STITCH_MCP_SURFACE", "lite")
    assert server._surface_allowlist() == set(server.CURATED_TOOLS)
    monkeypatch.setenv("STITCH_MCP_SURFACE", "core")
    assert server._surface_allowlist() == set(server.CORE_TOOLS)
    monkeypatch.setenv("STITCH_MCP_SURFACE", "full")
    assert server._surface_allowlist() is None
    monkeypatch.setenv("STITCH_MCP_SURFACE", "garbage")
    assert server._surface() == "core"


def test_surface_registers_expected_count():
    code = (
        "import asyncio;"
        "from fastmcp import FastMCP;"
        "from stitch_backend.bootstrap import bootstrap;"
        "from stitch_backend.core.command_registry import list_commands;"
        "from stitch_backend.mcp_server.server import CORE_TOOLS, CURATED_TOOLS;"
        "from stitch_backend.mcp_server.tools import register_all_tools;"
        "asyncio.run(bootstrap());"
        "present=set(list_commands());"
        "assert register_all_tools(FastMCP('m'), allow=set()) == 0;"
        "lite=[c for c in CURATED_TOOLS if c in present];"
        "assert register_all_tools(FastMCP('l'), allow=set(CURATED_TOOLS)) == len(lite);"
        "core=[c for c in CORE_TOOLS if c in present];"
        "nc=register_all_tools(FastMCP('c'), allow=set(CORE_TOOLS));"
        "assert nc == len(core);"
        "nf=register_all_tools(FastMCP('f'), core_only=False);"
        "assert nf > nc, (nf, nc)"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
