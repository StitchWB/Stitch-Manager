"""In-memory session store for OAuth / device-code auth flows."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

_TTL_SECONDS = 600  # 10 minutes


def _now_ts() -> int:
    return int(time.time())


@dataclass
class AuthFlowSession:
    session_id: str
    provider: str
    state: str
    auth_url: str
    callback_url: str | None = None
    phase: str = "awaiting_user"
    error: str | None = None
    created_at: int = 0
    updated_at: int = 0
    expires_at: int = 0
    flow_type: str | None = None


class AuthFlowSessionManager:
    """In-memory session store for OAuth / device-code flows."""

    def __init__(self) -> None:
        self._sessions: dict[str, AuthFlowSession] = {}

    def _cleanup(self) -> None:
        now = _now_ts()
        expired = [k for k, v in self._sessions.items() if v.expires_at <= now]
        for k in expired:
            del self._sessions[k]

    def create_session(self, provider: str, auth_url: str, state: str = "",
                       flow_type: str | None = None) -> AuthFlowSession:
        self._cleanup()
        now = _now_ts()
        session = AuthFlowSession(
            session_id=f"sess_{uuid.uuid4().hex[:16]}",
            provider=provider,
            state=state,
            auth_url=auth_url,
            flow_type=flow_type,
            created_at=now,
            updated_at=now,
            expires_at=now + _TTL_SECONDS,
        )
        self._sessions[session.session_id] = session
        return session

    def get_session(self, session_id: str) -> AuthFlowSession | None:
        self._cleanup()
        return self._sessions.get(session_id)

    def update_session(self, session_id: str, **kwargs: Any) -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        for k, v in kwargs.items():
            setattr(session, k, v)
        session.updated_at = _now_ts()

    def remove_session(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


_auth_flow_mgr: AuthFlowSessionManager | None = None


def get_auth_flow_manager() -> AuthFlowSessionManager:
    global _auth_flow_mgr
    if _auth_flow_mgr is None:
        _auth_flow_mgr = AuthFlowSessionManager()
    return _auth_flow_mgr
