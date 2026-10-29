"""totp.register capability for StepKind v2 (plan §4.3, v1.1)."""

from __future__ import annotations

import logging
import re
from typing import Any

from ..scenario.schema import ScenarioStep
from ..stitch_backend_bridge import get_database_path
from .capabilities_base import StepResult, build_selector

logger = logging.getLogger(__name__)

_BASE32_RE = re.compile(r"[A-Z2-7]{16,64}")


def _generate_totp(
    secret: str, timestamp: int | None = None, *, digits: int = 6, period: int = 30
) -> str:
    """Generate a TOTP code (RFC 6238) using stdlib only.

    No new dependencies — ``hmac``/``hashlib``/``base64``/``time`` only.
    Cross-checked against ``pyotp`` when available (tests).
    """
    import base64  # noqa: PLC0415
    import hashlib  # noqa: PLC0415
    import hmac  # noqa: PLC0415
    import time as _time  # noqa: PLC0415

    if timestamp is None:
        timestamp = int(_time.time())
    counter = timestamp // period

    # Decode Base32 secret (pad to multiple of 8).
    clean = secret.upper().replace(" ", "").rstrip("=")
    pad = (8 - len(clean) % 8) % 8
    key = base64.b32decode(clean + "=" * pad)

    # HOTP: HMAC-SHA1 of counter (big-endian 8 bytes).
    mac = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    binary = (
        (mac[offset] & 0x7F) << 24
        | (mac[offset + 1] & 0xFF) << 16
        | (mac[offset + 2] & 0xFF) << 8
        | (mac[offset + 3] & 0xFF)
    )
    return str(binary % (10**digits)).zfill(digits)


def _extract_totp_secret_from_page(browser: Any) -> str | None:
    """Extract a Base32 TOTP secret from page text/html.

    Searches the page's ``html`` property for ``[A-Z2-7]{16,64}`` matches.
    Returns the first match (uppercased) or ``None``.
    """
    html = getattr(browser, "html", None)
    if not html:
        return None
    # Strip tags so attributes don't pollute the match.
    text = re.sub(r"<[^>]*>", " ", str(html))
    for m in _BASE32_RE.finditer(text):
        candidate = m.group(0)
        # Avoid matching short Base32-like fragments in URLs/scripts.
        if len(candidate) >= 16:
            return candidate.upper()
    return None


def _persist_totp_secret(
    *, secret: str, label: str, issuer: str = "AWS Builder ID"
) -> str | None:
    """Persist TOTP secret to the local ``totp_keys`` SQLite table.

    Duplicates the minimal insert from the built-in kiro_v2 mfa step
    (providers/kiro_v2/steps/mfa.py) because the zone-boundary leak-guard
    prevents importing that Zone-2 module from Zone-1.  Schema ownership
    stays in mfa.py — this is a minimal duplicate that creates the table
    if needed (same DDL) and inserts one row.
    """
    import sqlite3  # noqa: PLC0415
    import uuid  # noqa: PLC0415

    try:
        db_path = get_database_path()
        if db_path is None:
            return None
        key_id = str(uuid.uuid4())
        secret_clean = secret.strip().upper()

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_keys (
                    id          TEXT PRIMARY KEY,
                    label       TEXT NOT NULL,
                    secret      TEXT NOT NULL,
                    issuer      TEXT,
                    account_id  TEXT,
                    digits      INTEGER NOT NULL DEFAULT 6,
                    period      INTEGER NOT NULL DEFAULT 30,
                    algorithm   TEXT NOT NULL DEFAULT 'SHA1',
                    enabled     INTEGER NOT NULL DEFAULT 1,
                    created_at  TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO totp_keys
                    (id, label, secret, issuer, account_id,
                     digits, period, algorithm, enabled, created_at)
                VALUES (?, ?, ?, ?, NULL, 6, 30, 'SHA1', 1, datetime('now'))
                """,
                (key_id, label, secret_clean, issuer),
            )
            conn.commit()
        logger.info("totp.register: secret saved to DB (id=%s)", key_id)
        return key_id
    except Exception as exc:  # noqa: BLE001
        logger.warning("totp.register: failed to save secret to DB: %s", exc)
        return None


def totp_register_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Register a TOTP MFA device (plan §4.3 totp.register, v1.1).

    Best-effort sub-flow: navigate, click through sub-flow candidates in
    order (each tolerant), extract Base32 secret from page text, compute
    TOTP code (stdlib), fill code input, confirm, persist secret to DB.

    Any sub-step failure → return failed StepResult (optional semantics
    will skip); NEVER raise.  Stores ``account.totp_ref`` = secret on
    success so ``account.save`` outputs can capture it.
    """
    meta = step.meta or {}
    optional = bool(meta.get("optional", False))

    def _fail(msg: str) -> StepResult:
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"totp.register: {msg} (optional)",
            )
        return StepResult(step.id, step.kind, False, error=f"totp.register: {msg}")

    try:
        # 1. Navigate if requested.
        navigate_url = meta.get("navigate_url")
        if navigate_url:
            try:
                browser.get(navigate_url)
            except Exception as exc:  # noqa: BLE001
                return _fail(f"navigate failed: {exc}")

        # Click sub-flow candidates in order (tolerant); input-looking ones are filled later.
        candidates = step.selector_candidates
        code_input_candidate = None
        for cand in candidates:
            sel = build_selector(cand)
            # Detect code-input candidates (xpath with //input).
            if "input" in sel.lower() and ("xpath" in sel.lower() or "//" in sel):
                code_input_candidate = cand
                continue
            try:
                elem = browser.ele(sel, timeout=5.0)
                if elem:
                    elem.click()
            except Exception:  # noqa: BLE001
                continue  # tolerant

        # 3. Extract secret from page text.
        secret = _extract_totp_secret_from_page(browser)
        if not secret:
            return _fail("could not extract Base32 secret from page")

        # 4. Compute TOTP code (stdlib, no new deps).
        code = _generate_totp(secret)

        # 5. Fill code input (from step candidates).
        if code_input_candidate is None:
            # Fallback: find any input in the step candidates.
            for cand in candidates:
                if "input" in build_selector(cand).lower():
                    code_input_candidate = cand
                    break
        if code_input_candidate is not None:
            try:
                elem = browser.ele(build_selector(code_input_candidate), timeout=10.0)
                if elem:
                    try:
                        elem.clear()
                    except Exception:  # noqa: BLE001
                        pass
                    elem.input(code)
            except Exception as exc:  # noqa: BLE001
                return _fail(f"code input fill failed: {exc}")

        # 6. Confirm: click remaining button candidates (assign, done).
        for cand in candidates:
            sel = build_selector(cand)
            if "input" in sel.lower() and ("xpath" in sel.lower() or "//" in sel):
                continue  # skip code input
            try:
                elem = browser.ele(sel, timeout=3.0)
                if elem:
                    elem.click()
            except Exception:  # noqa: BLE001
                continue  # tolerant

        # Persist only when account.email is seeded; drift/e2e runs must not pollute the totp table.
        label = str(store.get("account.email") or "")
        if label:
            _persist_totp_secret(secret=secret, label=label)

        # 8. Store output for account.save.
        store["account.totp_ref"] = secret
        return StepResult(
            step.id, step.kind, True,
            meta={"totp_secret": secret, "totp_code": code},
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(str(exc))
