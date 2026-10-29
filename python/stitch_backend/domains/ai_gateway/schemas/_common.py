"""Shared validation helpers for the ai_gateway schema modules."""

from __future__ import annotations

import json
from typing import Any

# 10KB JSON cap on free-form policy dicts bounds storage abuse (ponytail: lower if a real policy shape lands).
_MAX_DICT_JSON_BYTES = 10240


def _validate_dict_size(v: dict[str, Any] | None, field: str) -> dict[str, Any] | None:
    """Reject free-form dicts whose serialized JSON exceeds the size cap."""
    if v is None:
        return v
    if len(json.dumps(v)) > _MAX_DICT_JSON_BYTES:
        raise ValueError(
            f"{field} serialized JSON exceeds {_MAX_DICT_JSON_BYTES} bytes"
        )
    return v
