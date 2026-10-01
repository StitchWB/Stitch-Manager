"""Logging bridge — forwards provider/pipeline logger output to a log callback."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable


# Providers log via logger.info(), never self.log() — without this bridge zero logs reach the frontend.
class _LogBridgeHandler(logging.Handler):
    """Forward Python logging records to a ``Callable[[str], None]`` callback."""

    # Marker must survive module hot-reload, where isinstance() sees a different class object.
    _is_stitch_log_bridge = True

    def __init__(self, callback: Callable[[str], None]) -> None:
        super().__init__(level=logging.DEBUG)
        self._callback = callback

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self._callback(msg)
        except Exception:
            pass  # Never let logging crash the provider


# Logger names to bridge — covers all autoreg providers + pipeline code
_BRIDGE_LOGGER_NAMES = ("autoreg",)


def _install_log_bridge(callback: Callable[[str], None]) -> list[_LogBridgeHandler]:
    """Attach ``_LogBridgeHandler`` to all autoreg/pipeline loggers.

    Idempotent: stale bridge handlers are removed first so overlapping jobs in
    the same process can NEVER accumulate multiple handlers (each log would be
    delivered N times).
    """
    handlers: list[_LogBridgeHandler] = []
    for name in _BRIDGE_LOGGER_NAMES:
        lg = logging.getLogger(name)
        # Match by marker, not isinstance: handlers from a hot-reloaded module must also be removed.
        for h in list(lg.handlers):
            if getattr(h, "_is_stitch_log_bridge", False):
                lg.removeHandler(h)
                try:
                    h.close()
                except Exception:
                    pass
        handler = _LogBridgeHandler(callback)
        handler.setFormatter(logging.Formatter("%(message)s"))
        lg.addHandler(handler)
        # Ensure the logger level allows info/debug records through.
        if lg.level == logging.NOTSET or lg.level > logging.DEBUG:
            lg.setLevel(logging.DEBUG)
        # Disable propagation so records don't ALSO go to the root logger.
        lg.propagate = False
        handlers.append(handler)
    return handlers


def _remove_log_bridge(handlers: list[_LogBridgeHandler]) -> None:
    """Detach bridge handlers from their loggers and restore propagation."""
    for handler in handlers:
        for name in _BRIDGE_LOGGER_NAMES:
            try:
                lg = logging.getLogger(name)
                lg.removeHandler(handler)
                # Restore propagation so normal logging works outside of jobs
                lg.propagate = True
            except Exception:
                pass
        handler.close()
