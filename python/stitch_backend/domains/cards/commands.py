"""Card tools command handlers — 3 commands.

Ported from Rust ``commands/card_check.rs`` (registered in lib.rs).
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("generate_cards")
async def cmd_generate_cards(params: dict) -> list:
    """Generate cards with valid Luhn check digits."""
    from stitch_backend.domains.cards import service
    req = params.get("req", params)
    bin_str = req.get("bin", "")
    quantity = int(req.get("quantity", 1))
    month = req.get("month")
    year = req.get("year")
    return service.generate_cards(bin_str, quantity, month, year)


@register_command("check_card_rust")
async def cmd_check_card_rust(params: dict) -> dict:
    """Check a card via BIN lookup API."""
    from stitch_backend.domains.cards import service
    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    card_data = params.get("cardData", params.get("card_data", ""))
    return await service.check_card(card_data, proxy=_get_outbound_proxy())


@register_command("find_live_card")
async def cmd_find_live_card(params: dict) -> dict | None:
    """Generate and check cards until a live one is found."""
    from stitch_backend.domains.cards import service
    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    bin_str = params.get("bin", "")
    max_attempts = int(params.get("maxAttempts", params.get("max_attempts", 50)))
    month = params.get("month")
    year = params.get("year")
    return await service.find_live_card(
        bin_str, max_attempts, month, year, proxy=_get_outbound_proxy(),
    )
