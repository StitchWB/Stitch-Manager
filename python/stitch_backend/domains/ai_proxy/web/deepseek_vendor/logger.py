"""
Structured JSON logger for the DeepSeek API proxy.

Centralised so every module emits the same envelope. Falls back to a
plain text handler when stdout is not a TTY and JSON logging is disabled.
"""
import json
import logging
import os
import sys
import time
from typing import Any

_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
_LOG_FORMAT = os.environ.get("LOG_FORMAT", "json").lower()  # json | text
_LOGGER_NAME = "ds2api"


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record (production-friendly)."""

    # Standard `LogRecord` attributes we never want to serialize.
    _RESERVED = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime",
    }

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Include any extra= fields the caller passed.
        for key, value in record.__dict__.items():
            if key in self._RESERVED or key.startswith("_"):
                continue
            payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def _build_handler() -> logging.Handler:
    handler = logging.StreamHandler(stream=sys.stdout)
    if _LOG_FORMAT == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)-5s %(name)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
    return handler


_logger = logging.getLogger(_LOGGER_NAME)
_logger.setLevel(getattr(logging, _LOG_LEVEL, logging.INFO))
_logger.handlers.clear()
_logger.addHandler(_build_handler())
_logger.propagate = False


def get_logger(name: str | None = None) -> logging.Logger:
    """Return a child logger under the project namespace."""
    if name:
        return logging.getLogger(f"{_LOGGER_NAME}.{name}")
    return _logger


def configure_from_env() -> None:
    """Re-read LOG_LEVEL / LOG_FORMAT (call after dotenv loaded)."""
    global _LOG_LEVEL, _LOG_FORMAT
    _LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
    _LOG_FORMAT = os.environ.get("LOG_FORMAT", "json").lower()
    _logger.setLevel(getattr(logging, _LOG_LEVEL, logging.INFO))
    _logger.handlers.clear()
    _logger.addHandler(_build_handler())
