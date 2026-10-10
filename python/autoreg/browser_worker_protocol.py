"""Stdio plumbing and exceptions for the browser worker."""

import builtins
import sys
from pathlib import Path

# Add python directory to sys.path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

# JSON protocol rides stdout, so print defaults to stderr unless file= is passed explicitly.
_original_print = builtins.print


def _stderr_print(*args, **kwargs):
    """Print to stderr by default to avoid breaking JSON protocol

    IMPORTANT: If 'file' is explicitly provided, respect it!
    This allows JSON responses to go to stdout while debug logs go to stderr.
    """
    # Only redirect to stderr if file is NOT explicitly specified
    if 'file' not in kwargs:
        kwargs['file'] = sys.stderr
    kwargs.setdefault('flush', True)
    _original_print(*args, **kwargs)


def install_stderr_print():
    """Redirect bare ``print`` to stderr for the worker process only.

    Only ``browser_worker.main`` calls this: importing the module (tests,
    the host process) must not mutate ``builtins.print`` process-wide.
    """
    builtins.print = _stderr_print


def log_stderr(*args, **kwargs):
    """Helper function to print to stderr and flush."""
    _original_print(*args, file=sys.stderr, flush=True, **kwargs)


class BrowserWorkerError(Exception):
    """Base exception for browser worker errors"""
    pass


class ElementNotFoundError(BrowserWorkerError):
    """Element not found within timeout"""
    pass


class BrowserCrashedError(BrowserWorkerError):
    """Browser process crashed or disconnected"""
    pass


class TimeoutError(BrowserWorkerError):
    """Operation timed out"""
    pass
