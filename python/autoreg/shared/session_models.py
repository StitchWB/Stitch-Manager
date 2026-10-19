"""OAuth session data model and status enums."""

import time
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class SessionStatus(Enum):
    """OAuth session status enumeration"""
    CREATED = "created"
    STARTED = "started"
    CALLBACK_RECEIVED = "callback_received"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class Provider(Enum):
    """Supported OAuth providers"""
    KIRO = "kiro"
    WINDSURF = "windsurf"
    TRAE = "trae"


@dataclass
class SessionData:
    """
    OAuth session data structure

    Contains all information needed to track and recover OAuth sessions.
    """
    session_id: str
    provider: Provider
    account_id: int | None

    idp: str  # Identity provider (BuilderId, Github, Google)
    callback_port: int
    redirect_uri: str

    code_verifier: str | None = None
    code_challenge: str | None = None
    state: str | None = None

    auth_url: str | None = None
    authorization_code: str | None = None

    status: SessionStatus = SessionStatus.CREATED
    created_at: float = 0.0
    updated_at: float = 0.0
    expires_at: float | None = None

    token_data: dict[str, Any] | None = None
    error: str | None = None
    error_description: str | None = None

    user_agent: str | None = None
    client_info: dict[str, Any] | None = None

    def __post_init__(self):
        """Initialize timestamps if not set"""
        if self.created_at == 0.0:
            self.created_at = time.time()
        if self.updated_at == 0.0:
            self.updated_at = self.created_at
        if self.expires_at is None:
            self.expires_at = self.created_at + 3600

    def update_status(self, status: SessionStatus, error: str | None = None):
        """Update session status and timestamp"""
        self.status = status
        self.updated_at = time.time()
        if error:
            self.error = error

    def is_expired(self) -> bool:
        """Check if session is expired"""
        return self.expires_at is not None and time.time() > self.expires_at

    def is_active(self) -> bool:
        """Check if session is active (not completed, failed, cancelled, or expired)"""
        return (
            self.status in [SessionStatus.CREATED, SessionStatus.STARTED, SessionStatus.CALLBACK_RECEIVED]
            and not self.is_expired()
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        data = asdict(self)
        data['provider'] = self.provider.value
        data['status'] = self.status.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'SessionData':
        """Create from dictionary"""
        if isinstance(data.get('provider'), str):
            data['provider'] = Provider(data['provider'])
        if isinstance(data.get('status'), str):
            data['status'] = SessionStatus(data['status'])

        return cls(**data)
