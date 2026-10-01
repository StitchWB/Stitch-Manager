"""Scenario loading and v1→v2 normalization for replay."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _load_scenario(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Scenario file must be a JSON object")
    steps = raw.get("steps")
    if not isinstance(steps, list):
        raise ValueError("Scenario file must contain steps: []")
    return raw


def _looks_like_v2(raw: dict[str, Any]) -> bool:
    try:
        return int(raw.get("version") or 0) >= 2 and isinstance(raw.get("steps"), list)
    except Exception:
        return False


def _normalize_to_v2(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize scenario input to a minimal v2-like dict.

    Runner expects either:
    - v2 steps with selectorCandidates
    - or legacy v1 steps with selector
    """
    if _looks_like_v2(raw):
        return raw

    try:
        from autoreg.scenario.normalize_v1_to_v2 import normalize_recorded_scenario_v1_to_v2

        v2 = normalize_recorded_scenario_v1_to_v2(raw)
        return {
            "version": v2.version,
            "name": v2.name,
            "createdAt": v2.created_at,
            "startedUrl": raw.get("startedUrl") or raw.get("started_url") or "about:blank",
            "steps": [
                {
                    "id": s.id,
                    "tabId": s.tab_id,
                    "kind": s.kind,
                    "selectorCandidates": [
                        {"kind": c.kind, "value": c.value, "weight": c.weight}
                        for c in s.selector_candidates
                    ],
                    "value": s.value,
                    "url": s.url,
                    "timeoutMs": s.timeout_ms,
                    "retry": s.retry,
                    "sensitive": s.sensitive,
                    "meta": s.meta or {},
                }
                for s in v2.steps
            ],
        }
    except Exception:
        # Best-effort fallback to raw v1
        return raw
