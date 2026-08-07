from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

StepKind = Literal[
    "goto",
    "click",
    "fill",
    "press",
    "waitFor",
    "assert",
    "manual.pause",
    "proxy.switch",
]


@dataclass(frozen=True)
class SelectorCandidate:
    kind: str  # css|text|role|testid
    value: str
    weight: float = 1.0


@dataclass(frozen=True)
class ScenarioStep:
    id: str
    tab_id: str
    kind: StepKind
    selector_candidates: list[SelectorCandidate]
    value: str | None = None
    url: str | None = None
    timeout_ms: int = 15000
    retry: int = 0
    sensitive: bool = False
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class ScenarioV2:
    version: int
    name: str
    created_at: str
    steps: list[ScenarioStep]
