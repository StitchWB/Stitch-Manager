"""
Centralized structured logging system for autoreg Python modules.

Provides consistent, formatted logging across all registration providers
with support for different verbosity levels and automatic duration tracking.

This replaces the previous simpler implementation with a more comprehensive
modular system split across log_levels.py, log_formatters.py, and this file.
"""

import time
from typing import Optional, Dict
from .log_levels import LogLevel, LogStage
from .log_formatters import format_log_entry, format_progress
from .logging_utils import safe_log


class StructuredLogger:
    """
    Centralized logger for registration processes.

    Features:
    - Automatic duration tracking per stage
    - Configurable log levels (MINIMAL, NORMAL, VERBOSE, DEBUG)
    - Consistent formatting with icons and timestamps
    - Thread-safe output with flush=True
    - Windows-safe emoji handling via logging_utils

    Usage:
        logger = StructuredLogger(account_id="1/3", log_level=LogLevel.NORMAL)
        logger.info("Email", "Entering email...")
        logger.success("Email", "Email entered", duration=2.5)
        logger.error("IMAP", "Failed to get code", error=e)

    Example Output:
        [1/3] [Email] 📧 ℹ️ Entering email...
        [1/3] [Email] 📧 [+2.5s] ✅ Email entered
        [1/3] [IMAP] 📬 ❌ Failed to get code: Connection timeout
    """

    def __init__(
        self, account_id: str, log_level: LogLevel = LogLevel.NORMAL, verbose: bool = False
    ):
        """
        Initialize structured logger.

        Args:
            account_id: Account identifier (e.g., "1/3" for first of three accounts)
            log_level: Logging verbosity level
            verbose: If True, override log_level to VERBOSE (for backwards compatibility)
        """
        self.account_id = account_id
        self.log_level = log_level if not verbose else LogLevel.VERBOSE
        self.stage_timers: Dict[str, float] = {}  # Track start time for each stage
        self.start_time = time.time()

    def _should_log(self, level: LogLevel) -> bool:
        """
        Check if message should be logged based on current log level.

        Args:
            level: Required log level for this message

        Returns:
            True if message should be logged, False otherwise
        """
        level_priority = {
            LogLevel.MINIMAL: 0,
            LogLevel.NORMAL: 1,
            LogLevel.VERBOSE: 2,
            LogLevel.DEBUG: 3,
        }
        return level_priority[level] <= level_priority[self.log_level]

    def _start_stage_timer(self, stage: str) -> None:
        """
        Start timer for a stage if not already started.

        Args:
            stage: Stage name to track
        """
        if stage not in self.stage_timers:
            self.stage_timers[stage] = time.time()

    def _get_stage_duration(self, stage: str) -> Optional[float]:
        """
        Get duration since stage started.

        Args:
            stage: Stage name to get duration for

        Returns:
            Duration in seconds, or None if stage timer not started
        """
        if stage in self.stage_timers:
            return time.time() - self.stage_timers[stage]
        return None

    def _reset_stage_timer(self, stage: str) -> None:
        """
        Reset timer for a stage (useful for multi-step stages).

        Args:
            stage: Stage name to reset
        """
        if stage in self.stage_timers:
            del self.stage_timers[stage]

    def _safe_print(self, message: str) -> None:
        """
        Print message with Windows-safe emoji handling.

        Args:
            message: Message to print (may contain emojis)
        """
        safe_message = safe_log(message)
        print(safe_message, flush=True)

    def info(self, stage: str, message: str, duration: Optional[float] = None) -> None:
        """
        Log info message (NORMAL level).

        Args:
            stage: Stage name (e.g., "Email", "Browser")
            message: Log message
            duration: Optional duration to display
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        self._start_stage_timer(stage)
        formatted = format_log_entry(self.account_id, stage, "info", message, duration, "info")
        self._safe_print(formatted)

    def debug(self, stage: str, message: str) -> None:
        """
        Log debug message (DEBUG level only).

        Args:
            stage: Stage name
            message: Debug message
        """
        if not self._should_log(LogLevel.DEBUG):
            return

        formatted = format_log_entry(self.account_id, stage, "debug", message, None, "info")
        self._safe_print(formatted)

    def success(self, stage: str, message: str, duration: Optional[float] = None) -> None:
        """
        Log success message (NORMAL level).

        Automatically calculates duration from stage start if not provided.

        Args:
            stage: Stage name
            message: Success message
            duration: Optional duration override (uses auto-tracked duration if None)
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        if duration is None:
            duration = self._get_stage_duration(stage)

        formatted = format_log_entry(
            self.account_id, stage, "success", message, duration, "success"
        )
        self._safe_print(formatted)

        # Reset timer after success
        self._reset_stage_timer(stage)

    def error(
        self,
        stage: str,
        message: str,
        error: Optional[Exception] = None,
        duration: Optional[float] = None,
    ) -> None:
        """
        Log error message (always shown, regardless of log level).

        Args:
            stage: Stage name
            message: Error message
            error: Optional exception to include in message
            duration: Optional duration to display
        """
        error_msg = message
        if error:
            error_msg = f"{message}: {str(error)}"

        formatted = format_log_entry(self.account_id, stage, "error", error_msg, duration, "error")
        self._safe_print(formatted)

        # Reset timer after error
        self._reset_stage_timer(stage)

    def warning(self, stage: str, message: str) -> None:
        """
        Log warning message (NORMAL level).

        Args:
            stage: Stage name
            message: Warning message
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        formatted = format_log_entry(self.account_id, stage, "warning", message, None, "warning")
        self._safe_print(formatted)

    def progress(self, stage: str, current: int, total: int, message: str) -> None:
        """
        Log progress message with counter (VERBOSE level).

        Args:
            stage: Stage name
            current: Current step number
            total: Total number of steps
            message: Progress message
        """
        if not self._should_log(LogLevel.VERBOSE):
            return

        progress_msg = f"{format_progress(current, total)} {message}"
        formatted = format_log_entry(
            self.account_id, stage, "progress", progress_msg, None, "progress"
        )
        self._safe_print(formatted)

    def minimal(self, stage: str, message: str, duration: Optional[float] = None) -> None:
        """
        Log minimal message (MINIMAL level - only critical steps).

        Args:
            stage: Stage name
            message: Message
            duration: Optional duration to display
        """
        if not self._should_log(LogLevel.MINIMAL):
            return

        formatted = format_log_entry(
            self.account_id, stage, "minimal", message, duration, "success"
        )
        self._safe_print(formatted)

    def get_total_duration(self) -> float:
        """
        Get total duration since logger creation.

        Returns:
            Total duration in seconds
        """
        return time.time() - self.start_time

    def get_stage_duration(self, stage: str) -> Optional[float]:
        """
        Get duration for a specific stage (public method).

        Args:
            stage: Stage name

        Returns:
            Duration in seconds, or None if stage not started
        """
        return self._get_stage_duration(stage)

    # IMAP Smart Grouping Methods
    def imap_attempt_start(self, attempt: int, total: int) -> None:
        """
        Start IMAP attempt - only show if verbose.

        Args:
            attempt: Current attempt number
            total: Total number of attempts
        """
        if not self._should_log(LogLevel.VERBOSE):
            return

        from .log_formatters import format_imap_attempt

        message = format_imap_attempt(attempt, total, "searching")
        formatted = format_log_entry(self.account_id, "IMAP", "debug", message, None, "progress")
        self._safe_print(formatted)

    def imap_attempt_progress(self, attempt: int, total: int, found_count: int) -> None:
        """
        Update progress inline - show condensed info.
        Only show every 5th attempt or when emails found.

        Args:
            attempt: Current attempt number
            total: Total number of attempts
            found_count: Number of emails found in this attempt
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        # Only show every 5th attempt or when found
        if attempt % 5 == 0 or found_count > 0:
            from .log_formatters import format_imap_attempt

            status = f"checking {found_count} emails" if found_count > 0 else "searching"
            message = f"⏳ [{attempt}/{total}] {format_imap_attempt(attempt, total, status)}"
            formatted = format_log_entry(self.account_id, "IMAP", "progress", message, None, None)
            self._safe_print(formatted)

    def imap_attempt_success(self, attempt: int, code: str, duration: float) -> None:
        """
        Show success with code.

        Args:
            attempt: Attempt number where code was found
            code: Verification code found
            duration: Total duration to find code
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        message = f"Code received: {code} (attempt {attempt})"
        formatted = format_log_entry(
            self.account_id, "IMAP", "success", message, duration, "success"
        )
        self._safe_print(formatted)

    def imap_search_summary(self, strategies_tried: int, emails_checked: int) -> None:
        """
        Show summary instead of each email.

        Args:
            strategies_tried: Number of search strategies attempted
            emails_checked: Total number of emails checked
        """
        if not self._should_log(LogLevel.DEBUG):
            return

        message = f"Searched {strategies_tried} strategies, checked {emails_checked} emails"
        formatted = format_log_entry(self.account_id, "IMAP", "debug", message, None, "info")
        self._safe_print(formatted)

    def imap_waiting(self) -> None:
        """
        Show waiting for verification code message.
        """
        if not self._should_log(LogLevel.NORMAL):
            return

        message = "📬 Waiting for verification code..."
        formatted = format_log_entry(self.account_id, "IMAP", "info", message, None, None)
        self._safe_print(formatted)

    def imap_no_code(self, attempts: int) -> None:
        """
        Show failure message after all attempts.

        Args:
            attempts: Total number of attempts made
        """
        message = f"✗ No code after {attempts} attempts"
        formatted = format_log_entry(self.account_id, "IMAP", "error", message, None, None)
        self._safe_print(formatted)

    # Legacy compatibility methods (for existing code using old API)
    def start_timer(self, operation: str) -> None:
        """Start timing an operation (legacy compatibility)"""
        self._start_stage_timer(operation)

    def end_timer(self, operation: str) -> float:
        """End timing and return duration in seconds (legacy compatibility)"""
        duration = self._get_stage_duration(operation) or 0.0
        self._reset_stage_timer(operation)
        return duration


def create_logger(
    account_id: str, log_level: LogLevel = LogLevel.NORMAL, verbose: bool = False
) -> StructuredLogger:
    """
    Factory function to create a structured logger.

    Args:
        account_id: Account identifier (e.g., "1/3")
        log_level: Logging verbosity level
        verbose: If True, override log_level to VERBOSE

    Returns:
        Configured StructuredLogger instance
    """
    return StructuredLogger(account_id=account_id, log_level=log_level, verbose=verbose)
