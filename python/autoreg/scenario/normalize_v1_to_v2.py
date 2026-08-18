from __future__ import annotations

import hashlib
from typing import Any

from .schema import ScenarioStep, ScenarioV2, SelectorCandidate


def _pick_legacy_selector(step: dict[str, Any]) -> str | None:
    selector = step.get("selector")
    if isinstance(selector, str) and selector.strip():
        return selector.strip()

    selectors = step.get("selectors")
    if not isinstance(selectors, list):
        return None

    flattened: list[str] = []
    for row in selectors:
        if isinstance(row, str) and row.strip():
            flattened.append(row.strip())
            continue
        if isinstance(row, list):
            for item in row:
                if isinstance(item, str) and item.strip():
                    flattened.append(item.strip())

    if not flattened:
        return None

    # Prefer CSS-like selectors first.
    for candidate in flattened:
        lower = candidate.lower()
        if lower.startswith("xpath"):
            continue
        if lower.startswith("aria/"):
            continue
        if lower.startswith("text/"):
            continue
        if lower.startswith("pierce/"):
            return candidate[len("pierce/") :].strip() or None
        return candidate

    # Fallback to first non-empty selector.
    first = flattened[0]
    if first.lower().startswith("pierce/"):
        first = first[len("pierce/") :]
    return first.strip() or None


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
        kind_raw = str(s.get("kind") or s.get("type") or "unknown").strip().lower()
        selector = _pick_legacy_selector(s)
        url = s.get("url") if isinstance(s.get("url"), str) else None
        value = s.get("value") if isinstance(s.get("value"), str) else None
        meta = s.get("meta") if isinstance(s.get("meta"), dict) else None

        if meta is None:
            meta = {}

        if isinstance(s.get("target"), str) and s.get("target"):
            meta = {**meta, "target": s.get("target")}

        key = s.get("key") if isinstance(s.get("key"), str) else None

        # Map V1 kinds → V2 DSL
        if kind_raw in ("nav", "goto", "navigate"):
            kind = "goto"
        elif kind_raw in ("click", "doubleclick"):
            kind = "click"
            if kind_raw == "doubleclick":
                meta = {**meta, "doubleClick": True}
        elif kind_raw in ("change", "fill", "input"):
            kind = "fill"
        elif kind_raw in ("keydown", "key_down"):
            # Preserve meaningful key actions for replay.
            if not key:
                continue
            normalized_key = key.strip()
            if not normalized_key:
                continue
            if normalized_key.lower() in ("meta", "control", "alt", "shift"):
                continue
            kind = "press"
            value = normalized_key
        elif kind_raw in ("keyup", "key_up"):
            continue
        elif kind_raw == "submit":
            kind = "press"
            if value is None:
                value = "Enter"
        elif kind_raw == "proxy.switch":
            kind = "proxy.switch"
            # Never keep secrets in normalized scenario value.
            value = None
            if isinstance(meta, dict):
                if "runtimeProxy" in meta:
                    meta.pop("runtimeProxy", None)
                if "raw" in meta:
                    meta.pop("raw", None)
        else:
            # Drop unknown noise by default (can be improved later)
            continue

        candidates: list[SelectorCandidate] = []
        if selector:
            candidates.append(SelectorCandidate(kind="css", value=selector, weight=1.0))

        # Very light enrichment from meta text.
        text_meta = meta.get("text") if isinstance(meta, dict) else None
        if isinstance(text_meta, str) and text_meta.strip():
            candidates.append(
                SelectorCandidate(kind="text", value=text_meta.strip()[:80], weight=0.6)
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
