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
    # v2 extensions (plan §4.3) — declarative, executed by the engine.
    "extract",
    "branch",
    "imap.otp",
    "captcha.solve",
    "stripe.fill_checkout",
    "totp.register",
    "firebase.auth",
    "account.save",
    # Tolerated unknown kinds are mapped to "noop" by parse_scenario_v2.
    "noop",
]

# Engine API version (plan §3.1 item 1).  Bumped when the engine gains
# capabilities; old binaries tolerate newer manifests via the noop fallback.
ENGINE_API: int = 2


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
