"""Dev reload supervisor: watchfiles run_process with INFO routed to stdout.

Replaces ``python -m watchfiles`` whose CLI hardcodes a stderr handler.
"""

from __future__ import annotations

import logging
import sys

from watchfiles import run_process
from watchfiles.cli import build_filter


def _configure() -> None:
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.WARNING)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(stdout_handler)
    root.addHandler(stderr_handler)


def main(argv: list[str]) -> None:
    _configure()
    command, *paths = argv
    watch_filter, _ = build_filter("python", "__pycache__,*.pyc")
    run_process(
        *paths,
        target=command,
        target_type="command",
        watch_filter=watch_filter,
        debounce=3000,
        step=200,
        sigint_timeout=3,
        sigkill_timeout=2,
        grace_period=2,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
