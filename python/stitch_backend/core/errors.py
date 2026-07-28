"""Structured error types for command invocation.

Provides error codes and a unified error format for both MCP and CLI consumers.
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any


class ErrorCode(IntEnum):
    """Semantic error codes for command failures.

    Exit code mapping:
      0 = OK (success)
      1 = INVALID_ARGS (bad input)
      2 = NOT_FOUND (resource missing)
      3 = VALIDATION (Pydantic validation failed)
      4 = WRITE_BLOCKED (safety guard prevented write)
      99 = INTERNAL (unexpected error)
    """

    OK = 0
    INVALID_ARGS = 1
    NOT_FOUND = 2
    VALIDATION = 3
    WRITE_BLOCKED = 4
    INTERNAL = 99


class StitchError(Exception):
    """Base exception for command invocation failures.

    Attributes:
        code: Semantic error code (see ErrorCode enum)
        message: Human-readable error description
        details: Optional structured context (e.g., validation errors)
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-friendly dict for MCP/CLI responses."""
        return {
            "code": self.code.value,
            "message": self.message,
            "details": self.details,
        }


class WriteBlockedError(StitchError):
    """Raised when a write command is blocked by safety guards."""

    def __init__(self, command: str, reason: str):
        super().__init__(
            code=ErrorCode.WRITE_BLOCKED,
            message=f"Write command '{command}' blocked: {reason}",
            details={"command": command, "reason": reason},
        )


class CommandNotFoundError(StitchError):
    """Raised when a command is not registered."""

    def __init__(self, command: str):
        super().__init__(
            code=ErrorCode.NOT_FOUND,
            message=f"Unknown command: '{command}'",
            details={"command": command},
        )
