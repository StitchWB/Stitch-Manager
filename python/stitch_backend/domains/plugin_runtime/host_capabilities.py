"""Host-advertised capabilities + tolerant parsing of plugin-declared ones."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)



SUPPORTED_CAPABILITIES: list[str] = [
    "reverse_rpc", "caller_identity", "structured_logging", "plugin_rpc",
    "host_driver",
]

HOST_DRIVER = "host_driver"


def host_driver_eligible(capabilities: list[str], source: str) -> bool:
    """True when a manifest may claim the host_driver trust class.

    Community/sandbox sources are never eligible: the capability is
    stripped at discovery regardless of what the manifest declares.
    """
    return source in ("local", "cache") and HOST_DRIVER in capabilities


def parse_capabilities(init_result: Any) -> list[str]:
    """Extract the ``capabilities`` list from a plugin.init result.

    Tolerant contract:
      - Missing key / None / non-list value → ``[]`` (backward compat
        with plugins that predate the capability handshake).
      - Non-string entries are dropped (defensive — the contract is
        ``list[str]``).
      - Unknown capability strings (not in :data:`SUPPORTED_CAPABILITIES`)
        are logged at WARNING and kept verbatim — the host never
        silently drops a declared capability.
    """
    if not isinstance(init_result, dict):
        return []
    raw = init_result.get("capabilities")
    if not isinstance(raw, list):
        return []
    known = set(SUPPORTED_CAPABILITIES)
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item:
            continue
        if item not in known:
            logger.warning(
                "[Plugin] init result declares unknown capability %r "
                "(kept for observability)", item,
            )
        out.append(item)
    return out
