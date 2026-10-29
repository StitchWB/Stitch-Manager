"""Router command handlers — 5 commands.

Ported from Rust ``commands/router.rs`` + lib.rs inline registrations.
Frontend uses snake_case arg keys: { model_id: "..." }
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("route_provider")
async def cmd_route_provider(params: dict) -> str:
    """Route a model ID to the primary provider."""
    from stitch_backend.domains.router import service
    model_id = params.get("model_id", params.get("modelId", ""))
    return service.route_provider(model_id)


@register_command("route_provider_with_fallback")
async def cmd_route_provider_with_fallback(params: dict) -> dict:
    """Route a model ID and return primary + fallback providers."""
    from stitch_backend.domains.router import service
    model_id = params.get("model_id", params.get("modelId", ""))
    return service.route_provider_with_fallback(model_id)


@register_command("get_routing_rules")
async def cmd_get_routing_rules(params: dict) -> list:
    """Get the list of routing rules."""
    from stitch_backend.domains.router import service
    return service.get_routing_rules()


@register_command("clear_route_cache")
async def cmd_clear_route_cache(params: dict) -> dict:
    """Clear the router cache."""
    from stitch_backend.domains.router import service
    service.clear_route_cache()
    return {"success": True}


@register_command("get_cache_stats")
async def cmd_get_cache_stats(params: dict) -> dict:
    """Get router cache statistics."""
    from stitch_backend.domains.router import service
    return service.get_cache_stats()
