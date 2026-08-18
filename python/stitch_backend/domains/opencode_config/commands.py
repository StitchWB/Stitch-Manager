"""OpenCode config commands - command handlers for config management."""

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.opencode_config.api_tester import OpenCodeApiTester
from stitch_backend.domains.opencode_config.service import OpenCodeConfigService


@register_command("get_opencode_config")
async def get_opencode_config(params: dict) -> dict:
    """Read opencode.json configuration."""
    service = OpenCodeConfigService()
    return await service.read_opencode_config()


@register_command("set_opencode_config")
async def set_opencode_config(params: dict) -> dict:
    """Write opencode.json configuration."""
    config = params.get("config", {})
    service = OpenCodeConfigService()
    await service.write_opencode_config(config)
    return {"success": True}


@register_command("get_oh_my_openagent_config")
async def get_oh_my_openagent_config(params: dict) -> dict:
    """Read oh-my-openagent.json configuration."""
    service = OpenCodeConfigService()
    return await service.read_oh_my_openagent_config()


@register_command("set_oh_my_openagent_config")
async def set_oh_my_openagent_config(params: dict) -> dict:
    """Write oh-my-openagent.json configuration."""
    config = params.get("config", {})
    service = OpenCodeConfigService()
    await service.write_oh_my_openagent_config(config)
    return {"success": True}


@register_command("test_opencode_api")
async def test_opencode_api(params: dict) -> dict:
    """Test API endpoint and discover available models."""
    base_url = params.get("baseUrl", "")
    api_key = params.get("apiKey", "")

    if not base_url or not api_key:
        return {"success": False, "error": "baseUrl and apiKey are required"}

    tester = OpenCodeApiTester()
    return await tester.test_api(base_url, api_key)


@register_command("bulk_test_opencode_api")
async def bulk_test_opencode_api(params: dict) -> dict:
    """Test multiple API keys against the same base URL in parallel."""
    base_url = params.get("baseUrl", "")
    api_keys = params.get("apiKeys", [])
    concurrency = params.get("concurrency", 10)

    if not base_url:
        return {"success": False, "error": "baseUrl is required"}
    if not api_keys or not isinstance(api_keys, list):
        return {"success": False, "error": "apiKeys must be a non-empty list"}

    tester = OpenCodeApiTester()
    return await tester.bulk_test_api(base_url, api_keys, concurrency=concurrency)
