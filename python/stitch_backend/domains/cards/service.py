"""Card tools service — generation (Luhn), BIN check, find-live-card.

Ported from Rust ``commands/card_check.rs``.
Card number generation uses the Luhn algorithm for valid check digits.
BIN lookup uses an external HTTP API (configurable via env).
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ── BIN check API ─────────────────────────────────────────────────────────────
# Configurable via environment variable; falls back to a free BIN lookup.
import os
_BIN_CHECK_URL = os.environ.get(
    "BIN_CHECK_API_URL",
    "https://bincheck.io/api/v1/card",
)
_HTTP_TIMEOUT = 15.0


# ── Luhn helpers ──────────────────────────────────────────────────────────────

def _luhn_checksum(num: str) -> int:
    total = 0
    alternate = False
    for ch in reversed(num):
        n = int(ch)
        if alternate:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alternate = not alternate
    return total


def _luhn_check_digit(partial: str) -> int:
    total = 0
    alternate = True
    for ch in reversed(partial):
        n = int(ch)
        if alternate:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alternate = not alternate
    return (10 - (total % 10)) % 10


# ── Card generation ───────────────────────────────────────────────────────────

def _generate_card_number(bin_digits: str) -> str:
    """Generate a Luhn-valid card number from a BIN prefix."""
    clean = "".join(c for c in bin_digits if c.isdigit())
    if len(clean) < 6:
        raise ValueError("BIN must have at least 6 digits")
    target_len = 15 if clean.startswith("3") else 16
    random_needed = target_len - len(clean) - 1
    partial = clean + "".join(str(random.randint(0, 9)) for _ in range(random_needed))
    check = _luhn_check_digit(partial)
    return partial + str(check)


def _generate_cvv(card_number: str) -> str:
    length = 4 if card_number.startswith("3") else 3
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def generate_cards(
    bin_str: str,
    quantity: int,
    month: str | None = None,
    year: str | None = None,
) -> list[dict[str, Any]]:
    """Generate *quantity* cards with valid Luhn check digits."""
    quantity = max(1, min(quantity, 1000))
    cards: list[dict[str, Any]] = []
    seed_base = int(time.time() * 1000)

    for i in range(quantity):
        random.seed(seed_base + i)
        number = _generate_card_number(bin_str)
        m = month or f"{random.randint(1, 12):02d}"
        y = year or str(random.randint(2026, 2030))
        cvv = _generate_cvv(number)
        fmt = f"{number}|{m}|{y}|{cvv}"
        cards.append({
            "id": f"card_{random.randint(0, 2**53)}",
            "number": number,
            "month": m,
            "year": y,
            "cvv": cvv,
            "format": fmt,
        })

    # Reset seed to avoid affecting other random usage
    random.seed()
    return cards


# ── Card check ────────────────────────────────────────────────────────────────

async def check_card(card_data: str) -> dict[str, Any]:
    """Check a card via BIN lookup API.

    *card_data* format: ``number|month|year|cvv`` or just ``number``.
    Returns a ``CardCheckResult``-shaped dict.
    """
    parts = card_data.split("|")
    number = parts[0].strip() if parts else card_data.strip()
    if len(number) < 6:
        raise ValueError("Card number too short for BIN lookup")

    bin_prefix = number[:6]
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                _BIN_CHECK_URL,
                params={"bin": bin_prefix},
                headers=headers,
            )
            if resp.status_code >= 400:
                return _error_result(f"BIN API returned {resp.status_code}")
            data = resp.json()
    except httpx.TimeoutException:
        return _error_result("BIN API timeout")
    except Exception as exc:
        return _error_result(str(exc))

    # Normalize API response to CardCheckResult shape
    card_info = data.get("card", data)
    bank = card_info.get("bank", "")
    brand = card_info.get("brand", "")
    card_type = card_info.get("type", "")
    category = card_info.get("category", "")
    country = card_info.get("country", {})
    return {
        "success": True,
        "status": "Unknown",
        "message": "BIN lookup successful",
        "bank": bank,
        "cardType": card_type,
        "category": category,
        "brand": brand,
        "countryName": country.get("name", ""),
        "countryCode": country.get("code", ""),
        "countryEmoji": country.get("emoji", ""),
        "error": None,
    }


# ── Find live card ────────────────────────────────────────────────────────────

async def find_live_card(
    bin_str: str,
    max_attempts: int = 50,
    month: str | None = None,
    year: str | None = None,
) -> dict[str, Any] | None:
    """Generate and check cards until a 'live' one is found or max_attempts."""
    max_attempts = max(1, min(max_attempts, 200))
    for _ in range(max_attempts):
        cards = generate_cards(bin_str, 1, month, year)
        card = cards[0]
        result = await check_card(card["format"])
        if result.get("success") and result.get("status") == "Live":
            return card
    return None


# ── Internal ──────────────────────────────────────────────────────────────────

def _error_result(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "status": "Error",
        "message": message,
        "bank": "", "cardType": "", "category": "", "brand": "",
        "countryName": "", "countryCode": "", "countryEmoji": "",
        "error": message,
    }
