from __future__ import annotations

import json
import logging
import sys
import threading
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class PipelineEvent:
    event: str
    data: dict[str, Any]

    def to_json(self) -> str:
        return json.dumps({"event": self.event, "data": self.data}, ensure_ascii=False, default=str)


@dataclass
class PipelineCommand:
    command: str
    step_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_json(cls, raw: str) -> PipelineCommand | None:
        try:
            obj = json.loads(raw.strip())
            return cls(
                command=obj.get("command", ""),
                step_id=obj.get("step_id"),
                data=obj.get("data", {}),
            )
        except (json.JSONDecodeError, KeyError):
            logger.warning(f"Invalid command JSON: {raw!r}")
            return None


class PipeTransport:
    def __init__(self):
        self._lock = threading.Lock()
        self._queue: list[PipelineCommand] = []
        self._reader_thread: threading.Thread | None = None
        self._started = False

    def _ensure_reader(self) -> None:
        if self._started:
            return
        self._started = True
        self._reader_thread = threading.Thread(target=self._stdin_reader, daemon=True)
        self._reader_thread.start()

    def _stdin_reader(self) -> None:
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                cmd = PipelineCommand.from_json(line)
                if cmd:
                    self._queue.append(cmd)
        except Exception:
            pass

    def emit(self, event: str, data: dict[str, Any]) -> None:
        msg = PipelineEvent(event=event, data=data).to_json()
        with self._lock:
            sys.stdout.write(msg + "\n")
            sys.stdout.flush()
        logger.debug(f"Emitted event: {event}")

    def read_command(self, timeout: float | None = None) -> PipelineCommand | None:
        self._ensure_reader()
        import time

        deadline = None
        if timeout is not None:
            deadline = time.monotonic() + timeout
        while True:
            if self._queue:
                return self._queue.pop(0)

            if deadline is not None and time.monotonic() > deadline:
                return None

            time.sleep(0.1)

    def wait_for_command(
        self,
        expected: str | list[str],
        step_id: str | None = None,
        timeout: float | None = None,
    ) -> PipelineCommand | None:
        if isinstance(expected, str):
            expected = [expected]

        while True:
            cmd = self.read_command(timeout=timeout)
            if cmd is None:
                return None
            if cmd.command in expected:
                if step_id is None or cmd.step_id == step_id or cmd.step_id is None:
                    return cmd
            logger.debug(f"Ignoring unexpected command: {cmd.command} (expected {expected})")
