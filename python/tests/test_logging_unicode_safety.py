"""Regression coverage for Unicode-safe backend logging during persistence."""

from __future__ import annotations

import logging

from stitch_backend import logging_config
from stitch_backend.domains.ai_gateway import credential_state, probe_worker


class StrictCp1251Stream:
    encoding = "cp1251"
    errors = "strict"

    def __init__(self) -> None:
        self.writes: list[str] = []

    def reconfigure(self, **kwargs) -> None:
        raise ValueError("stream is not reconfigurable")

    def write(self, data: str) -> int:
        data.encode(self.encoding, errors=self.errors)
        self.writes.append(data)
        return len(data)

    def flush(self) -> None:
        return None


def test_configure_logging_degrades_unicode_on_legacy_windows_stream(monkeypatch):
    stream = StrictCp1251Stream()
    monkeypatch.setattr("sys.stdout", stream)
    monkeypatch.setattr("sys.stderr", StrictCp1251Stream())

    root = logging.getLogger()
    old_handlers = root.handlers[:]
    old_level = root.level
    access_logger = logging.getLogger("uvicorn.access")
    old_access_disabled = access_logger.disabled
    try:
        root.handlers[:] = []
        logging_config.configure_logging("INFO")
        logging.getLogger("unicode-safety-test").info("credential recovered → active")
        for handler in root.handlers:
            handler.flush()
    finally:
        root.handlers[:] = old_handlers
        root.setLevel(old_level)
        access_logger.disabled = old_access_disabled

    written = "".join(stream.writes)
    assert "credential recovered" in written
    assert "?" in written


async def test_probe_logging_failure_cannot_rollback_savepoint(monkeypatch):
    events: list[str] = []
    exits: list[type[BaseException] | None] = []

    class Nested:
        async def __aenter__(self):
            events.append("enter")
            return self

        async def __aexit__(self, exc_type, exc, tb):
            exits.append(exc_type)
            events.append("exit")
            return False

    class Session:
        def begin_nested(self):
            return Nested()

        async def flush(self):
            events.append("flush")

    async def run_in_session(op):
        await op(Session())

    async def transition(*args, **kwargs):
        events.append("transition")

    class RaisingLogger:
        def log(self, level, message, *args, **kwargs):
            events.append("log")
            raise UnicodeEncodeError("cp1251", "→", 0, 1, "ordinal not in range")

    monkeypatch.setattr(probe_worker, "run_in_session", run_in_session)
    monkeypatch.setattr(probe_worker, "logger", RaisingLogger())
    monkeypatch.setattr(
        credential_state,
        "record_outcome",
        lambda **kwargs: events.append("record"),
    )
    monkeypatch.setattr(credential_state, "transition_credential", transition)

    await probe_worker.ProbeWorker._persist_probe_results([
        {
            "credential_id": "cred-1",
            "endpoint_id": "endpoint-1",
            "success": True,
            "http_status": 200,
            "latency_ms": 12,
            "classified": None,
        }
    ])

    assert events == ["record", "enter", "transition", "flush", "exit", "log"]
    assert exits == [None]
