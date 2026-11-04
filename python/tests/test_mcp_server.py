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


def test_core_tools_all_registered():
    code = (
        "from stitch_backend.startup import import_command_modules;"
        "import_command_modules();"
        "from stitch_backend.core.command_registry import list_commands;"
        "from stitch_backend.mcp_server.server import CORE_TOOLS;"
        "missing=[c for c in CORE_TOOLS if c not in set(list_commands())];"
        "assert not missing, missing"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
