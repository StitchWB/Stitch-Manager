"""Replay control channel (NDJSON command file), manual pause, step artifacts."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from .._common import _event
from .report import _redact_text


class ReplayAbort(Exception):  # noqa: N818 — established control-flow name
    pass


class CommandTail:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = 0

    def ensure(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def read_new_commands(self) -> list[tuple[str, dict[str, Any] | None]]:
        if not self.path.exists():
            return []
        raw = self.path.read_text(encoding="utf-8", errors="replace")
        if self.offset >= len(raw):
            return []
        chunk = raw[self.offset :]
        self.offset = len(raw)
        out: list[tuple[str, dict[str, Any] | None]] = []
        for line in chunk.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    cmd = obj.get("command")
                    payload = obj.get("payload")
                    if isinstance(cmd, str) and cmd.strip():
                        out.append(
                            (cmd.strip().lower(), payload if isinstance(payload, dict) else None)
                        )
                        continue
            except Exception:
                pass
            out.append((line.lower(), None))
        return out


async def _manual_pause(
    *,
    page: Any | None,
    reason: str,
    step_index: int,
    total_steps: int,
    command_tail: CommandTail,
    command_file_path: str,
    timeout_s: int,
) -> None:
    if page is not None:
        try:
            await page.evaluate(
                "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Manual pause')"
            )
        except Exception:
            pass

    _event(
        "scenario.replay.manual.pause",
        {
            "reason": reason,
            "stepIndex": step_index,
            "totalSteps": total_steps,
            "commandFilePath": command_file_path,
        },
    )
    deadline = time.time() + max(1, timeout_s)
    last_ping = 0.0

    while time.time() < deadline:
        commands = command_tail.read_new_commands()
        for cmd, payload in commands:
            if cmd in ("resume", "continue"):
                if page is not None:
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Running')"
                        )
                    except Exception:
                        pass
                _event(
                    "scenario.replay.manual.resume",
                    {
                        "reason": reason,
                        "stepIndex": step_index,
                        "totalSteps": total_steps,
                        "payload": payload or {},
                    },
                )
                return
            if cmd in ("abort", "cancel", "stop"):
                if page is not None:
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Stopping')"
                        )
                    except Exception:
                        pass
                _event(
                    "scenario.replay.manual.abort",
                    {
                        "reason": reason,
                        "stepIndex": step_index,
                        "totalSteps": total_steps,
                        "payload": payload or {},
                    },
                )
                raise ReplayAbort("Manual abort requested")

        if time.time() - last_ping >= 5.0:
            _event(
                "scenario.replay.manual.waiting",
                {
                    "reason": reason,
                    "stepIndex": step_index,
                    "totalSteps": total_steps,
                    "secondsLeft": int(max(0, deadline - time.time())),
                },
            )
            last_ping = time.time()

        await asyncio.sleep(0.35)

    raise TimeoutError("Manual pause timeout")


async def _save_step_artifacts(page: Any, artifacts_dir: Path, step_index: int) -> dict[str, str]:
    artifacts: dict[str, str] = {}
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    png = artifacts_dir / f"step_{step_index:04d}_error.png"
    html = artifacts_dir / f"step_{step_index:04d}_error.html"

    try:
        await page.screenshot(path=str(png), full_page=True)
        artifacts["screenshot"] = str(png)
    except Exception:
        pass

    try:
        content = await page.content()
        html.write_text(_redact_text(content), encoding="utf-8")
        artifacts["html"] = str(html)
    except Exception:
        pass

    return artifacts
