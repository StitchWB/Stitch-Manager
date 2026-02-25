import json
import os
from datetime import datetime


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def get_correlation_id() -> str | None:
    return os.environ.get("CORRELATION_ID") or None


def emit_event(event: dict) -> None:
    """Emit a single NDJSON line to stdout."""
    print(json.dumps(event, ensure_ascii=False), flush=True)


def emit_log(message: str, level: str = "info", **fields) -> None:
    emit_event(
        {
            "type": "log",
            "level": level,
            "message": message,
            "timestamp": _now_iso(),
            "correlationId": get_correlation_id(),
            **({"fields": fields} if fields else {}),
        }
    )


def emit_progress(step: str, pct: float | None = None, **fields) -> None:
    emit_event(
        {
            "type": "progress",
            "step": step,
            "pct": pct,
            "timestamp": _now_iso(),
            "correlationId": get_correlation_id(),
            **({"fields": fields} if fields else {}),
        }
    )


def emit_result(data: dict, ok: bool | None = None, error: dict | None = None) -> None:
    """Terminal result event. data should include provider, success, email, error, accounts[], raw."""
    emit_event(
        {
            "type": "result",
            "ok": ok if ok is not None else bool(data.get("success")),
            "data": data,
            "error": error,
            "timestamp": _now_iso(),
            "correlationId": get_correlation_id(),
        }
    )
