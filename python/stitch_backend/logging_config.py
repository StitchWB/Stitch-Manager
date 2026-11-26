"""Root-logger setup for the backend process: INFO to stdout, WARNING+ to stderr."""

from __future__ import annotations

import logging
import sys
from typing import Any, TypeVar

_T = TypeVar("_T")


class _UnicodeSafeStream:
    """Delegate text writes, degrading unmappable Unicode to replacements."""

    def __init__(self, stream: Any) -> None:
        self._stream = stream

    def write(self, data: str) -> Any:
        try:
            return self._stream.write(data)
        except UnicodeEncodeError:
            encoding = getattr(self._stream, "encoding", None) or "utf-8"
            replacement = data.encode(encoding, errors="replace").decode(
                encoding, errors="replace"
            )
            return self._stream.write(replacement)

    def flush(self) -> Any:
        return self._stream.flush()

    def __getattr__(self, name: str) -> object:
        return getattr(self._stream, name)


def _force_utf8_replace(stream: _T) -> _T:
    """Best-effort UTF-8/replace reconfiguration for console text streams.

    Windows service and pywebview hosts often provide cp1251/cp866-backed
    stdout/stderr.  Backend log messages are allowed to contain Unicode
    provider/model text; a strict legacy encoding must never turn logging
    into an application failure.
    """
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            # Some capture/redirect objects expose reconfigure but reject it.
            # StreamHandler itself handles ordinary emit failures; this is only
            # a best-effort hardening of real console streams.
            pass
    return stream


def configure_logging(level: str) -> None:
    """Configure logging to write INFO to stdout, ERROR/WARNING to stderr."""
    sys.stdout = _force_utf8_replace(sys.stdout)
    sys.stderr = _force_utf8_replace(sys.stderr)
    stdout_handler = logging.StreamHandler(_UnicodeSafeStream(sys.stdout))
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)

    stderr_handler = logging.StreamHandler(_UnicodeSafeStream(sys.stderr))
    stderr_handler.setLevel(logging.WARNING)

    formatter = logging.Formatter(
        "%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    stdout_handler.setFormatter(formatter)
    stderr_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.addHandler(stdout_handler)
    root_logger.addHandler(stderr_handler)

    # command_registry warnings are expected in dev mode with --reload.
    logging.getLogger("stitch_backend.core.command_registry").setLevel(logging.ERROR)

    # uvicorn ships its own stderr-only handlers; route them through the root split.
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True

    # httpx/httpcore log one INFO line per request; KeyHealth probes ~35 keys every 5 min.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # Must run here, not in run(): dev mode launches uvicorn via CLI, which never calls run().
    logging.getLogger("uvicorn.access").disabled = True
