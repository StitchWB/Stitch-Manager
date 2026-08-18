from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .step import PipelineStep, StepStatus
from .transport import PipeTransport

logger = logging.getLogger(__name__)


@dataclass
class PipelineState:
    current_step_id: str | None = None
    paused: bool = False
    manual_mode: bool = False
    cancelled: bool = False
    pause_requested: bool = False
    step_results: dict[str, dict[str, Any]] = field(default_factory=dict)
    step_errors: dict[str, str] = field(default_factory=dict)


@dataclass
class PipelineResult:
    success: bool
    provider: str
    email: str | None = None
    password: str | None = None
    error: str | None = None
    step_results: dict[str, dict[str, Any]] = field(default_factory=dict)
    skipped_steps: list[str] = field(default_factory=list)
    failed_step: str | None = None


class RegistrationPipeline:
    def __init__(
        self,
        steps: list[PipelineStep],
        transport: PipeTransport | None = None,
        provider: str = "unknown",
    ):
        self.steps = steps
        self.transport = transport or PipeTransport()
        self.provider = provider
        self.state = PipelineState()
        self._browser: Any = None

    def set_browser(self, browser: Any) -> None:
        self._browser = browser

    def run(self) -> PipelineResult:
        self._emit_pipeline_config()

        for step in self.steps:
            if self.state.cancelled:
                logger.info("Pipeline cancelled")
                break

            self._drain_config_commands()

            if not step.enabled:
                step.status = StepStatus.SKIPPED
                self.state.step_results[step.id] = {"success": True, "reason": "disabled"}
                self._emit("step_skipped", step_id=step.id, reason="disabled")
                continue

            step.status = StepStatus.RUNNING
            self.state.current_step_id = step.id
            self._emit("step_started", step=step.to_dict())

            result = self._execute_step(step)

            if result.get("human_pause"):
                # Step requested human intervention (e.g. captcha image challenge)
                step.status = StepStatus.WAITING
                self._emit("human_pause", step_id=step.id, reason=result.get("human_pause_reason", "Manual intervention required"))
                self._play_alert_sound()
                self._wait_for_human_pause(step, result)
                if self.state.cancelled:
                    break
                continue

            if result.get("success"):
                step.status = StepStatus.COMPLETED
                step.result = result
                self.state.step_results[step.id] = result
                self._emit("step_completed", step_id=step.id, result=result)
            else:
                step.status = StepStatus.FAILED
                step.error = result.get("error", "unknown")
                self.state.step_errors[step.id] = step.error
                self._emit("step_failed", step_id=step.id, error=step.error, result=result)

                action = self._handle_step_failure(step, result)
                if action == "skip":
                    step.status = StepStatus.SKIPPED
                    self.state.step_results[step.id] = {"success": True, "reason": "skipped_after_failure"}
                    self._emit("step_skipped", step_id=step.id, reason="failure")
                    continue
                elif action == "retry":
                    result = self._execute_step(step)
                    if result.get("success"):
                        step.status = StepStatus.COMPLETED
                        step.result = result
                        self.state.step_results[step.id] = result
                        self._emit("step_completed", step_id=step.id, result=result)
                    else:
                        if step.required:
                            return self._fail(step.id, result.get("error", "Retry failed"))
                        step.status = StepStatus.SKIPPED
                        self.state.step_results[step.id] = {"success": True, "reason": "skipped_after_retry"}
                        self._emit("step_skipped", step_id=step.id, reason="retry_failed")
                        continue
                elif action == "abort":
                    return self._fail(step.id, step.error or "Aborted by user")

            # User-requested pause takes effect after current step
            if self.state.pause_requested:
                self.state.pause_requested = False
                step.status = StepStatus.WAITING
                self._emit("step_waiting", step_id=step.id, reason="user_pause")
                self._wait_for_control(step.id)

            if step.pause_after:
                step.status = StepStatus.WAITING
                self._emit("step_waiting", step_id=step.id, reason="pause_after")
                self._wait_for_control(step.id)

            if self.state.cancelled:
                logger.info("Pipeline cancelled during pause")
                break

        return self._build_result()

    def _execute_step(self, step: PipelineStep) -> dict[str, Any]:
        if not self._browser:
            return {"success": False, "error": "No browser available"}
        try:
            result = step.execute(self._browser)
        except Exception as e:
            logger.error(f"Step {step.id} crashed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        # matched_candidate sensor (plan §3.4 item 11): 0-based index of the
        # weighted SelectorCandidate that matched, or None when none were used.
        result.setdefault("matched_candidate", None)
        return result

    def _drain_config_commands(self) -> None:
        while True:
            cmd = self.transport.read_command(timeout=0.05)
            if cmd is None:
                break
            if cmd.command == "configure" and cmd.step_id:
                self.update_step_config(cmd.step_id, cmd.data)
            elif cmd.command == "pause":
                self.state.pause_requested = True
                logger.info("Pause requested — will pause after current step")
            elif cmd.command == "abort":
                self.state.cancelled = True
                self._emit("pipeline_aborted", step_id=cmd.step_id)
                break
            else:
                logger.debug(f"Buffering unexpected command between steps: {cmd.command}")

    def _play_alert_sound(self) -> None:
        """Play system alert sound to notify user of human-pause state."""
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
        except Exception:
            # Fallback: ASCII bell
            print("\a", flush=True)

    def _wait_for_human_pause(self, step: PipelineStep, result: dict[str, Any]) -> None:
        """Handle human_pause request from a step.

        Waits for resume/skip/abort command. If human_pause_timeout is configured,
        auto-skips after timeout (for non-required steps) or aborts (for required).
        """
        timeout = step.config.get("human_pause_timeout")
        if timeout is None:
            timeout = 300  # default 5 minutes

        self._emit("human_pause_waiting", step_id=step.id, timeout=timeout)
        logger.info(f"Human pause active for step '{step.id}' (timeout={timeout}s). Waiting for resume/skip/abort...")

        if timeout and timeout > 0:
            cmd = self.transport.wait_for_command(["resume", "skip", "abort"], step_id=step.id, timeout=timeout)
        else:
            cmd = self.transport.wait_for_command(["resume", "skip", "abort"], step_id=step.id)

        if cmd is None:
            # Timeout reached
            logger.warning(f"Human pause timeout ({timeout}s) reached for step '{step.id}'")
            self._emit("human_pause_timeout", step_id=step.id)
            if step.required:
                step.status = StepStatus.FAILED
                self.state.step_results[step.id] = {"success": False, "error": "Human pause timeout"}
                self._emit("step_failed", step_id=step.id, error="Human pause timeout")
            else:
                step.status = StepStatus.SKIPPED
                self.state.step_results[step.id] = {"success": True, "reason": "human_pause_timeout"}
                self._emit("step_skipped", step_id=step.id, reason="human_pause_timeout")
            return

        if cmd.command == "resume":
            # User indicates they manually completed the challenge
            step.status = StepStatus.COMPLETED
            self.state.step_results[step.id] = {"success": True, "reason": "human_pause_resolved"}
            self._emit("step_completed", step_id=step.id, result={"success": True, "reason": "human_pause_resolved"})
            logger.info(f"Human pause resolved for step '{step.id}' — resuming")
        elif cmd.command == "skip":
            step.status = StepStatus.SKIPPED
            self.state.step_results[step.id] = {"success": True, "reason": "human_pause_skipped"}
            self._emit("step_skipped", step_id=step.id, reason="human_pause_skip")
            logger.info(f"Human pause skipped for step '{step.id}'")
        elif cmd.command == "abort":
            self.state.cancelled = True
            self._emit("pipeline_aborted", step_id=step.id, reason="human_pause_abort")
            logger.info(f"Pipeline aborted from human pause at step '{step.id}'")

    def _handle_step_failure(self, step: PipelineStep, result: dict[str, Any]) -> str:
        if step.skippable:
            self._emit("step_waiting", step_id=step.id, reason="failure_choose", options=["retry", "skip", "abort"])
            cmd = self.transport.wait_for_command(["skip", "retry", "abort"], step_id=step.id)
            if cmd:
                return cmd.command
        if step.required:
            return "abort"
        return "skip"

    def _wait_for_control(self, step_id: str) -> None:
        self.state.paused = True
        self._emit("pipeline_paused", step_id=step_id)

        while self.state.paused and not self.state.cancelled:
            cmd = self.transport.read_command(timeout=1.0)
            if cmd is None:
                continue
            if cmd.command == "resume":
                self.state.paused = False
                self.state.manual_mode = False
                self._emit("pipeline_resumed", step_id=step_id)
                break
            elif cmd.command == "pause":
                logger.debug("Pause command received while already paused — ignoring")
                continue
            elif cmd.command == "manual":
                self.state.manual_mode = True
                self._emit("manual_mode_entered", step_id=step_id)
            elif cmd.command == "skip":
                step = self._find_step(step_id)
                if step and step.skippable:
                    self.state.paused = False
                    step.status = StepStatus.SKIPPED
                    self.state.step_results[step_id] = {"success": True, "reason": "skipped_by_user"}
                    self._emit("step_skipped", step_id=step_id, reason="user")
                    break
            elif cmd.command == "abort":
                self.state.cancelled = True
                self.state.paused = False
                self._emit("pipeline_aborted", step_id=step_id)
                break

        if self.state.manual_mode and not self.state.cancelled:
            self._emit("manual_mode_active", step_id=step_id, message="Browser under manual control. Send 'resume' when done.")
            while self.state.manual_mode and not self.state.cancelled:
                cmd = self.transport.read_command(timeout=1.0)
                if cmd and cmd.command == "resume":
                    self.state.manual_mode = False
                    self._emit("manual_mode_exited", step_id=step_id)
                    break
                elif cmd and cmd.command == "abort":
                    self.state.cancelled = True
                    self.state.manual_mode = False
                    self._emit("pipeline_aborted", step_id=step_id)
                    break

    def _find_step(self, step_id: str) -> PipelineStep | None:
        for step in self.steps:
            if step.id == step_id:
                return step
        return None

    def update_step_config(self, step_id: str, config: dict[str, Any]) -> None:
        step = self._find_step(step_id)
        if step:
            for key in ("enabled", "pause_after", "allow_manual", "skippable", "retry_on_fail"):
                if key in config:
                    setattr(step, key, config[key])
            step.config.update({k: v for k, v in config.items() if k not in ("enabled", "pause_after", "allow_manual", "skippable", "retry_on_fail")})
            self._emit("step_config_updated", step_id=step_id, config=step.to_dict())

    def _emit_pipeline_config(self) -> None:
        self._emit("pipeline_config", provider=self.provider, steps=[s.to_dict() for s in self.steps])

    def _emit(self, event: str, **data: Any) -> None:
        self.transport.emit(event, data)

    def _fail(self, step_id: str, error: str) -> PipelineResult:
        return PipelineResult(
            success=False,
            provider=self.provider,
            error=f"Step {step_id} failed: {error}",
            failed_step=step_id,
            step_results=dict(self.state.step_results),
            skipped_steps=[s.id for s in self.steps if s.status == StepStatus.SKIPPED],
        )

    def _build_result(self) -> PipelineResult:
        has_failure = any(s.status == StepStatus.FAILED for s in self.steps if s.required)
        return PipelineResult(
            success=not has_failure,
            provider=self.provider,
            step_results=dict(self.state.step_results),
            skipped_steps=[s.id for s in self.steps if s.status == StepStatus.SKIPPED],
            failed_step=next((s.id for s in self.steps if s.status == StepStatus.FAILED and s.required), None),
        )
