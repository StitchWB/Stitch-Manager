from __future__ import annotations

import hashlib
from typing import Any

from .schema import ScenarioV2, ScenarioStep, SelectorCandidate


def _step_id(step: dict[str, Any], index: int) -> str:
    raw = f"{index}:{step.get('kind')}:{step.get('selector')}:{step.get('url')}:{step.get('ts')}"
    return hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()[:12]


def normalize_recorded_scenario_v1_to_v2(payload: dict[str, Any]) -> ScenarioV2:
    name = str(payload.get("name") or "scenario")
    created_at = str(payload.get("recordedAt") or payload.get("recorded_at") or "")
    steps_in = payload.get("steps")
    if not isinstance(steps_in, list):
        steps_in = []

    steps: list[ScenarioStep] = []
    for i, s in enumerate([x for x in steps_in if isinstance(x, dict)], start=1):
        kind_raw = str(s.get("kind") or "unknown").lower()
        selector = s.get("selector") if isinstance(s.get("selector"), str) else None
        url = s.get("url") if isinstance(s.get("url"), str) else None
        value = s.get("value") if isinstance(s.get("value"), str) else None
        meta = s.get("meta") if isinstance(s.get("meta"), dict) else None

        # Map V1 kinds → V2 DSL
        if kind_raw in ("nav", "goto", "navigate"):
            kind = "goto"
        elif kind_raw == "click":
            kind = "click"
        elif kind_raw in ("change", "fill", "input"):
            kind = "fill"
        elif kind_raw == "submit":
            kind = "press"
            if value is None:
                value = "Enter"
        else:
            # Drop unknown noise by default (can be improved later)
            continue

        candidates: list[SelectorCandidate] = []
        if selector:
            candidates.append(SelectorCandidate(kind="css", value=selector, weight=1.0))

        # Very light enrichment from meta text.
        if meta and isinstance(meta.get("text"), str) and meta.get("text").strip():
            candidates.append(
                SelectorCandidate(kind="text", value=meta["text"].strip()[:80], weight=0.6)
            )

        step = ScenarioStep(
            id=_step_id(s, i),
            tab_id="main",
            kind=kind,  # type: ignore[arg-type]
            selector_candidates=candidates,
            value=value,
            url=url,
            timeout_ms=15000,
            retry=1,
            sensitive=value == "***",
            meta=meta,
        )
        steps.append(step)

    return ScenarioV2(version=2, name=name, created_at=created_at, steps=steps)
