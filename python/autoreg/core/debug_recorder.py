"""
autoreg.core.debug_recorder
============================
Stub module kept for backward compatibility.

The original DebugRecorder class was removed during the CloakBrowser
browser-integration refactor.  Several provider modules (e.g. kiro/browser.py)
still import from here.  This stub provides the same public API as no-ops so
that imports succeed without changing every call site.

If detailed browser-session recording is needed in the future, implement it
here and remove the no-op bodies.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Generator

logger = logging.getLogger(__name__)


class DebugRecorder:
    """No-op debug recorder.  All methods silently do nothing."""

    def __init__(self, session_id: str | None = None, **kwargs: Any) -> None:
        self.session_id = session_id

    # ── Recording lifecycle ──────────────────────────────────────────────────

    def start(self) -> None:  # noqa: D401
        """Start recording (no-op)."""

    def stop(self) -> None:
        """Stop recording (no-op)."""

    def save(self, path: str | None = None) -> str | None:
        """Save the recording to *path* (no-op, returns None)."""
        return None

    # ── Event capture ────────────────────────────────────────────────────────

    def record_step(self, name: str, **meta: Any) -> None:
        """Record a named step (no-op)."""

    def record_screenshot(self, data: bytes | None = None, **meta: Any) -> None:
        """Capture a screenshot (no-op)."""

    def record_error(self, error: BaseException | str, **meta: Any) -> None:
        """Record an error event (no-op)."""

    # ── Context manager ──────────────────────────────────────────────────────

    @contextmanager
    def step(self, name: str, **meta: Any) -> Generator[None, None, None]:
        """Context manager that wraps a named step (no-op)."""
        yield


# Module-level convenience: a single shared no-op instance.
_default_recorder: DebugRecorder = DebugRecorder()


def get_recorder(session_id: str | None = None) -> DebugRecorder:
    """Return the default no-op recorder (or a new one if *session_id* given)."""
    if session_id:
        return DebugRecorder(session_id=session_id)
    return _default_recorder
