"""Z.AI device-token collector — browser-based window.z_um.getToken() collector.

Python port of GLM-ZAI-2API token-collector/main.go.
Uses PatchrightEngine (playwright sync API) to open chat.z.ai,
trigger the captcha SDK, and collect device tokens into tokens.sqlite.

Designed to run on-demand (UI button / command), NOT inside chat requests.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

ZAI_URL: str = "https://chat.z.ai"
DEFAULT_TOKEN_COUNT: int = 750
MAX_TOKEN_COUNT: int = 1250
TOKEN_COLLECT_TIMEOUT: float = 90.0
ZUM_READY_TIMEOUT: float = 30.0
ZUM_POLL_INTERVAL: float = 0.5


class BrowserEngine(Protocol):
    def launch(self) -> Any: ...
    def close(self) -> None: ...
    def goto(self, url: str, wait_until: str = "domcontentloaded", timeout: float = 30.0) -> None: ...
    def fill(self, _selector: str, value: str, _humanize: bool | None = None) -> None: ...
    def click(self, _selector: str, timeout: float = 10.0) -> None: ...
    def wait_for_selector(self, _selector: str, timeout: float = 10.0, state: str = "visible") -> Any | None: ...
    def evaluate(self, _expression: str, arg: Any | None = None) -> Any: ...


class TokenCollectorError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class TokenCollectionResult:
    collected: int
    db_path: str
    elapsed_seconds: float


def collect_tokens(
    engine: BrowserEngine,
    db_path: Path,
    count: int = DEFAULT_TOKEN_COUNT,
) -> TokenCollectionResult:
    """Collect device tokens from chat.z.ai and save to SQLite.

    Parameters
    ----------
    engine
        A browser engine with a Playwright-compatible API (e.g. PatchrightEngine).
    db_path
        Path to the output tokens.sqlite file.
    count
        Number of tokens to collect (capped at MAX_TOKEN_COUNT).
    """
    if count <= 0:
        count = DEFAULT_TOKEN_COUNT
    if count > MAX_TOKEN_COUNT:
        count = MAX_TOKEN_COUNT

    logger.info("Collecting %d Z.AI device tokens", count)

    engine.launch()
    try:
        _navigate_and_trigger(engine)
        tokens = _collect_zum_tokens(engine, count)
    finally:
        engine.close()

    _save_tokens(db_path, tokens)
    return TokenCollectionResult(
        collected=len(tokens),
        db_path=str(db_path),
        elapsed_seconds=0.0,
    )


def _navigate_and_trigger(engine: BrowserEngine) -> None:
    """Navigate to chat.z.ai, fill chat input, click send to trigger captcha SDK."""
    logger.info("Navigating to chat.z.ai...")
    engine.goto(ZAI_URL, wait_until="domcontentloaded", timeout=30.0)

    chat_input = engine.wait_for_selector("#chat-input", timeout=15.0)
    if chat_input is None:
        raise TokenCollectorError("page_load_failed", "Chat input not found on chat.z.ai")

    engine.fill("#chat-input", "__")
    engine.click("#send-message-button")
    logger.info("Send clicked, waiting for captcha SDK...")

    _wait_for_zum(engine)


def _wait_for_zum(engine: BrowserEngine) -> None:
    """Poll until window.z_um.getToken is defined."""
    deadline = time.monotonic() + ZUM_READY_TIMEOUT
    while time.monotonic() < deadline:
        ready = engine.evaluate(
            "typeof window.z_um !== 'undefined' && typeof window.z_um.getToken === 'function'"
        )
        if ready:
            logger.info("window.z_um.getToken is ready")
            return
        time.sleep(ZUM_POLL_INTERVAL)
    raise TokenCollectorError("zum_timeout", "window.z_um.getToken did not become ready")


def _collect_zum_tokens(engine: BrowserEngine, total: int) -> list[str]:
    """Call window.z_um.getToken() in a loop and collect tokens."""
    logger.info("Collecting %d tokens...", total)
    js_expr = f"""
    (async () => {{
        const out = new Array({total});
        for (let i = 0; i < {total}; i++) {{
            const tok = window.z_um.getToken();
            out[i] = (tok && typeof tok.then === 'function') ? await tok : tok;
            if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }}
        return out;
    }})()
    """

    result = engine.evaluate(js_expr)
    if not isinstance(result, list):
        raise TokenCollectorError("collection_failed", "getToken did not return an array")

    tokens = [str(t) for t in result if t]
    logger.info("Collected %d tokens", len(tokens))
    return tokens


def _save_tokens(path: Path, tokens: list[str]) -> None:
    """Save tokens to SQLite database (same schema as GLM-ZAI-2API)."""
    # Remove existing file to start fresh
    if path.exists():
        path.unlink()

    conn = sqlite3.connect(str(path))
    try:
        conn.execute("CREATE TABLE tokens (id INTEGER PRIMARY KEY, token TEXT)")
        conn.executemany(
            "INSERT INTO tokens (id, token) VALUES (?, ?)",
            enumerate(tokens),
        )
        conn.commit()
    finally:
        conn.close()

    size_kb = path.stat().st_size / 1024 if path.exists() else 0
    logger.info("Saved %d tokens to %s (%.1f KB)", len(tokens), path, size_kb)


def get_token_count(db_path: Path) -> int:
    """Return the number of tokens in the database, or 0 if missing/empty."""
    if not db_path.exists():
        return 0
    try:
        with sqlite3.connect(str(db_path)) as conn:
            row = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()
            return int(row[0]) if row else 0
    except sqlite3.Error:
        return 0
