"""NotebookLM domain (Phase 2b) — in-process library wrapper, own surface."""

from .service import (
    NotebookLMService,
    NotebookLMUnavailableError,
    cookies_to_storage_state,
    parse_account_cookies,
    write_storage_state_file,
)

__all__ = [
    "NotebookLMService",
    "NotebookLMUnavailableError",
    "cookies_to_storage_state",
    "parse_account_cookies",
    "write_storage_state_file",
]
