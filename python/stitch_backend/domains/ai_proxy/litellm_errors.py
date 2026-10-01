from __future__ import annotations


def _is_safe_transport_failure(exc: BaseException) -> bool:
    safe_names = {
        "ConnectError",
        "ConnectTimeout",
        "InvalidURL",
        "ProxyError",
        "UnsupportedProtocol",
    }
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        if type(current).__name__ in safe_names:
            return True
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return False
