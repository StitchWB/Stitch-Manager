"""Persisted per-profile engine state (``engine_state.json`` in the profile dir)."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

# Logger name pinned to autoreg.browser.profile_launcher: log stream identity must survive the split.
logger = logging.getLogger("autoreg.browser.profile_launcher")


def engine_state_path(profile_path: Path) -> Path:
    return profile_path / "engine_state.json"


def load_engine_state(profile_path: Path) -> dict:
    """Load persisted engine state (e.g. ``shard_profile_id``).

    Missing or corrupt file is treated as absent — never raises.
    """
    try:
        path = engine_state_path(profile_path)
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        logger.warning("engine_state.json is not a JSON object; ignoring")
        return {}
    except Exception as e:
        logger.debug("Could not load engine_state.json: %s", e)
        return {}


def save_engine_state(profile_path: Path, shard_profile_id: str) -> None:
    """Persist ``shard_profile_id`` so the next standalone launch reuses it.

    Never raises — persistence failure is logged but does not break launch.
    """
    try:
        profile_path.mkdir(parents=True, exist_ok=True)
        payload = {
            "shard_profile_id": shard_profile_id,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        engine_state_path(profile_path).write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("Could not save engine_state.json: %s", e)
