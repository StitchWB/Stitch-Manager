from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


class StepStatus(enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"
    WAITING = "waiting"


@dataclass
class PipelineStep:
    id: str
    label: str
    execute_fn: Callable[..., dict[str, Any]]
    execute_kwargs: dict[str, Any] = field(default_factory=dict)

    enabled: bool = True
    required: bool = True
    skippable: bool = False
    pause_after: bool = True
    allow_manual: bool = False
    retry_on_fail: bool = True

    config: dict[str, Any] = field(default_factory=dict)

    status: StepStatus = StepStatus.PENDING
    result: dict[str, Any] | None = None
    error: str | None = None

    def execute(self, browser: Any) -> dict[str, Any]:
        kwargs = {**self.execute_kwargs, **self.config}
        return self.execute_fn(browser, **kwargs)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "enabled": self.enabled,
            "required": self.required,
            "skippable": self.skippable,
            "pause_after": self.pause_after,
            "allow_manual": self.allow_manual,
            "retry_on_fail": self.retry_on_fail,
            "status": self.status.value,
            "config": self.config,
        }
