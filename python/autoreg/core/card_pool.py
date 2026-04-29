"""
Card pool manager — парсинг и хранение карт для провайдеров.

Поддерживаемые форматы:
  1. Pipe-separated: number|MM|YYYY|CVV
  2. Live format:    Live | number|MM|YYYY|CVV | [BIN: ...] | ...
  3. Stripe format:  number MM/YY CVV
  4. Simple CSV:     number,MM,YYYY,CVV
"""

import logging
import os
import random
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class Card:
    number: str
    exp_month: str  # MM
    exp_year: str   # YY or YYYY
    cvv: str
    raw_line: str = ""
    used: bool = False

    @property
    def expiry_mmyy(self) -> str:
        """Return expiry as MM/YY for Stripe input."""
        year = self.exp_year
        if len(year) == 4:
            year = year[2:]
        return f"{self.exp_month}/{year}"

    @property
    def expiry_mmyyyy(self) -> str:
        """Return expiry as MM/YYYY."""
        year = self.exp_year
        if len(year) == 2:
            year = f"20{year}"
        return f"{self.exp_month}/{year}"


class CardParser:
    """Parse cards from various text formats."""

    # Pattern: 13-19 digit card number
    _CARD_NUMBER_RE = re.compile(r'\b(\d{13,19})\b')

    @staticmethod
    def parse_line(line: str) -> Optional[Card]:
        """Parse a single line into a Card, trying multiple formats."""
        line = line.strip()
        if not line:
            return None

        # Try all parsers in order
        for parser in [
            CardParser._parse_pipe_format,
            CardParser._parse_live_format,
            CardParser._parse_csv_format,
            CardParser._parse_space_format,
        ]:
            result = parser(line)
            if result:
                result.raw_line = line
                return result
        return None

    @staticmethod
    def parse_text(text: str) -> list[Card]:
        """Parse multiple lines of text into a list of Cards."""
        cards = []
        for line in text.splitlines():
            card = CardParser.parse_line(line)
            if card:
                cards.append(card)
        return cards

    @staticmethod
    def parse_file(filepath: str) -> list[Card]:
        """Parse cards from a file."""
        path = Path(filepath)
        if not path.exists():
            logger.warning(f"Card file not found: {filepath}")
            return []
        text = path.read_text(encoding='utf-8', errors='ignore')
        cards = CardParser.parse_text(text)
        logger.info(f"Parsed {len(cards)} cards from {filepath}")
        return cards

    @staticmethod
    def _parse_pipe_format(line: str) -> Optional[Card]:
        """Parse: number|MM|YYYY|CVV or number|MM|YY|CVV"""
        # Clean up spaces around pipes
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 4:
            return None

        # Find the part that looks like a card number
        for i, part in enumerate(parts):
            if re.match(r'^\d{13,19}$', part) and i + 3 < len(parts):
                number = part
                month = parts[i + 1]
                year = parts[i + 2]
                cvv = parts[i + 3]

                if re.match(r'^\d{1,2}$', month) and re.match(r'^\d{2,4}$', year) and re.match(r'^\d{3,4}$', cvv):
                    return Card(
                        number=number,
                        exp_month=month.zfill(2),
                        exp_year=year,
                        cvv=cvv,
                    )
        return None

    @staticmethod
    def _parse_live_format(line: str) -> Optional[Card]:
        """Parse: Live | number|MM|YYYY|CVV | [BIN: ...] | ..."""
        lower = line.lower()
        if not any(kw in lower for kw in ['live', 'charge ok', 'gate', 'bin:']):
            return None
        # Extract card data from pipe-separated tokens
        return CardParser._parse_pipe_format(line)

    @staticmethod
    def _parse_csv_format(line: str) -> Optional[Card]:
        """Parse: number,MM,YYYY,CVV"""
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 4:
            return None
        number, month, year, cvv = parts[0], parts[1], parts[2], parts[3]
        if (re.match(r'^\d{13,19}$', number) and re.match(r'^\d{1,2}$', month)
                and re.match(r'^\d{2,4}$', year) and re.match(r'^\d{3,4}$', cvv)):
            return Card(
                number=number,
                exp_month=month.zfill(2),
                exp_year=year,
                cvv=cvv,
            )
        return None

    @staticmethod
    def _parse_space_format(line: str) -> Optional[Card]:
        """Parse: number MM/YY CVV or number MMYY CVV"""
        match = re.match(r'(\d{13,19})\s+(\d{2})/(\d{2,4})\s+(\d{3,4})', line)
        if match:
            return Card(
                number=match.group(1),
                exp_month=match.group(2),
                exp_year=match.group(3),
                cvv=match.group(4),
            )
        return None


class CardPool:
    """Thread-safe card pool per provider."""

    def __init__(self):
        self._lock = threading.Lock()
        # provider_name -> list of cards
        self._pools: dict[str, list[Card]] = {}

    def load_cards(self, provider: str, cards: list[Card]):
        """Load cards for a provider."""
        with self._lock:
            if provider not in self._pools:
                self._pools[provider] = []
            self._pools[provider].extend(cards)
            logger.info(f"Loaded {len(cards)} cards for provider '{provider}' (total: {len(self._pools[provider])})")

    def load_from_text(self, provider: str, text: str):
        """Parse and load cards from text."""
        cards = CardParser.parse_text(text)
        self.load_cards(provider, cards)

    def load_from_file(self, provider: str, filepath: str):
        """Parse and load cards from file."""
        cards = CardParser.parse_file(filepath)
        self.load_cards(provider, cards)

    def get_card(self, provider: str) -> Optional[Card]:
        """Get next unused card for a provider. If all used, resets and reuses them."""
        with self._lock:
            pool = self._pools.get(provider, [])
            if not pool:
                logger.warning(f"No cards available for provider '{provider}'")
                return None
                
            for card in pool:
                if not card.used:
                    card.used = True
                    logger.info(f"Card allocated for '{provider}': ****{card.number[-4:]}")
                    return card
                    
            # All cards used, reset and cycle
            for c in pool:
                c.used = False
                
            card = pool[0]
            card.used = True
            logger.info(f"Card (reused) allocated for '{provider}': ****{card.number[-4:]}")
            return card

    def get_random_card(self, provider: str) -> Optional[Card]:
        """Get a random card for a provider (infinite reuse)."""
        with self._lock:
            pool = self._pools.get(provider, [])
            if not pool:
                logger.warning(f"No cards available for provider '{provider}'")
                return None
                
            unused = [c for c in pool if not c.used]
            if not unused:
                # All used, reset
                for c in pool:
                    c.used = False
                unused = pool
                
            card = random.choice(unused)
            card.used = True
            logger.info(f"Random card allocated for '{provider}': ****{card.number[-4:]}")
            return card

    def available_count(self, provider: str) -> int:
        """Get count of available (unused) cards."""
        with self._lock:
            pool = self._pools.get(provider, [])
            return sum(1 for c in pool if not c.used)

    def total_count(self, provider: str) -> int:
        """Get total card count for provider."""
        with self._lock:
            return len(self._pools.get(provider, []))

    def reset(self, provider: str):
        """Mark all cards as unused for a provider."""
        with self._lock:
            for card in self._pools.get(provider, []):
                card.used = False

    def providers(self) -> list[str]:
        """List all providers with loaded cards."""
        with self._lock:
            return list(self._pools.keys())


# Global singleton
_global_pool = CardPool()


def get_card_pool() -> CardPool:
    """Get the global card pool instance."""
    return _global_pool
