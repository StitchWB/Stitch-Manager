"""Root-logger setup for the backend process: INFO to stdout, WARNING+ to stderr."""

from __future__ import annotations

import logging
import sys


def configure_logging(level: str) -> None:
    """Configure logging to write INFO to stdout, ERROR/WARNING to stderr."""
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)

    stderr_handler = logging.StreamHandler(sys.stderr)
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

    # httpx/httpcore log one INFO line per request; KeyHealth probes ~35 keys every 5 min.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # Must run here, not in run(): dev mode launches uvicorn via CLI, which never calls run().
    logging.getLogger("uvicorn.access").disabled = True
