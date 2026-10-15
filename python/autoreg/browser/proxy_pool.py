"""Round-robin proxy pool with ban-on-error rotation."""

from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from autoreg.browser.proxy_utils import ProxyConfig, parse_proxy_line

__all__ = ["ProxyPool"]


@dataclass
class _ProxyStats:
    proxy: ProxyConfig
    is_alive: bool = True
    ban_until: float = 0.0
    used_count: int = 0


class ProxyPool:
    def __init__(self, entries: Iterable[str] | None = None, *, ban_seconds: int = 300) -> None:
        self.ban_seconds = ban_seconds
        self._stats: list[_ProxyStats] = []
        self._index = 0
        for entry in entries or ():
            proxy = parse_proxy_line(entry)
            if proxy is not None:
                self._stats.append(_ProxyStats(proxy=proxy))

    @classmethod
    def from_file(cls, path: str | Path, *, ban_seconds: int = 300) -> ProxyPool:
        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError:
            return cls(ban_seconds=ban_seconds)
        return cls(text.splitlines(), ban_seconds=ban_seconds)

    def acquire(self) -> ProxyConfig | None:
        total = len(self._stats)
        if total == 0:
            return None
        now = time.time()
        for _ in range(total):
            stats = self._stats[self._index % total]
            self._index += 1
            # a marked-bad proxy is skipped only while its ban window is active
            if not stats.is_alive and now < stats.ban_until:
                continue
            return stats.proxy
        return None

    def mark_bad(self, proxy: ProxyConfig) -> None:
        for stats in self._stats:
            if stats.proxy == proxy:
                stats.is_alive = False
                stats.ban_until = time.time() + self.ban_seconds
                return

    def mark_used(self, proxy: ProxyConfig) -> None:
        for stats in self._stats:
            if stats.proxy == proxy:
                stats.used_count += 1
                return

    @property
    def size(self) -> int:
        return len(self._stats)

    @property
    def available(self) -> int:
        now = time.time()
        return sum(1 for stats in self._stats if stats.is_alive and now >= stats.ban_until)
