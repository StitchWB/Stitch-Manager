"""Non-blocking per-credential in-flight limiter."""

from __future__ import annotations

import threading

PER_CREDENTIAL_CAP = 6

_registry: dict[str, int] = {}
_lock = threading.Lock()


def try_acquire(credential_id: str, cap: int = PER_CREDENTIAL_CAP) -> bool:
    with _lock:
        current = _registry.get(credential_id, 0)
        if current >= cap:
            return False
        _registry[credential_id] = current + 1
        return True


def release(credential_id: str) -> None:
    with _lock:
        current = _registry.get(credential_id, 0) - 1
        if current > 0:
            _registry[credential_id] = current
        else:
            _registry.pop(credential_id, None)


def in_flight(credential_id: str) -> int:
    with _lock:
        return _registry.get(credential_id, 0)


def reset() -> None:
    with _lock:
        _registry.clear()
