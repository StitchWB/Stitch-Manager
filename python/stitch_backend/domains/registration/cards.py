"""Card pool loading for registration runs."""

from __future__ import annotations

import logging

# Logger name pinned to the pre-split service module — must not change.
logger = logging.getLogger("stitch_backend.domains.registration.service")


def _load_cards(provider_name: str, config: dict) -> None:
    """Load card pool from config (cards_file, cards_text, card_bin)."""
    cards_file = config.get("cards_file") or config.get("cardsFile") or ""
    cards_text = config.get("cards_text") or config.get("cardsText") or ""
    card_bin = config.get("card_bin") or config.get("cardBin") or ""

    if not any([cards_file, cards_text, card_bin]):
        return

    try:
        from autoreg.core.card_pool import get_card_pool
        pool = get_card_pool()
        if cards_file:
            pool.load_from_file(provider_name, cards_file)
        elif cards_text:
            pool.load_from_text(provider_name, cards_text)
        elif card_bin:
            from autoreg.core.card_generator import start_live_card_search
            finder = start_live_card_search(card_bin, max_attempts=50)
            import time
            time.sleep(5)
            if finder.live_card:
                pool.load_from_text(provider_name, finder.live_card)
    except Exception as exc:
        logger.warning("Card pool loading failed: %s", exc)
