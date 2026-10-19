"""Replay report sanitization (credential redaction) and safe write."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_SENSITIVE_KEY_RE = re.compile(
    r'("(?:token|refresh_token|password|secret|cookie|authorization|session_data?)"\s*:\s*)"[^"]*"',
    flags=re.IGNORECASE,
)

_SENSITIVE_VALUE_RE = re.compile(
    r"\b(Bearer)\s+([A-Za-z0-9\-._~+/]+=*)",
    flags=re.IGNORECASE,
)


def _redact_text(value: str) -> str:
    if not value:
        return value
    out = _SENSITIVE_KEY_RE.sub(r'\1"***"', value)
    out = _SENSITIVE_VALUE_RE.sub(r"\\1 ***", out)
    return out


def _sanitize_report(report: dict[str, Any]) -> dict[str, Any]:
    out = dict(report)
    if out.get("error"):
        out["error"] = _redact_text(str(out.get("error") or ""))

    failed_steps = out.get("failedSteps")
    if isinstance(failed_steps, list):
        sanitized: list[dict[str, Any]] = []
        for entry in failed_steps:
            if not isinstance(entry, dict):
                continue
            row = dict(entry)
            if row.get("error"):
                row["error"] = _redact_text(str(row.get("error") or ""))
            sanitized.append(row)
        out["failedSteps"] = sanitized
    return out


def _write_safe_report(path: Path, report: dict[str, Any]) -> None:
    safe = _sanitize_report(report)
    path.write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
