#!/usr/bin/env python3
"""
Session Manager - OAuth session management utilities

Provides centralized session management for OAuth flows across all providers.
Handles session persistence, recovery, cleanup, and database synchronization.

Features:
- Session lifecycle management (create, start, complete, cancel)
- Persistent session storage for recovery
- Database synchronization for account linking
- Session cleanup and garbage collection
- Multi-provider support (Kiro, Windsurf, Trae)
"""

import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


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

    # OAuth parameters
    idp: str  # Identity provider (BuilderId, Github, Google)
    callback_port: int
    redirect_uri: str

    # PKCE parameters
    code_verifier: str | None = None
    code_challenge: str | None = None
    state: str | None = None

    # Flow data
    auth_url: str | None = None
    authorization_code: str | None = None

    # Session state
    status: SessionStatus = SessionStatus.CREATED
    created_at: float = 0.0
    updated_at: float = 0.0
    expires_at: float | None = None

    # Results
    token_data: dict[str, Any] | None = None
    error: str | None = None
    error_description: str | None = None

    # Metadata
    user_agent: str | None = None
    client_info: dict[str, Any] | None = None

    def __post_init__(self):
        """Initialize timestamps if not set"""
        if self.created_at == 0.0:
            self.created_at = time.time()
        if self.updated_at == 0.0:
            self.updated_at = self.created_at
        if self.expires_at is None:
            # Default expiration: 1 hour
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
        # Convert enums to strings
        data['provider'] = self.provider.value
        data['status'] = self.status.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'SessionData':
        """Create from dictionary"""
        # Convert string enums back to enum objects
        if isinstance(data.get('provider'), str):
            data['provider'] = Provider(data['provider'])
        if isinstance(data.get('status'), str):
            data['status'] = SessionStatus(data['status'])

        return cls(**data)


class SessionStore:
    """
    Persistent session storage

    Handles saving and loading session data to/from disk for recovery.
    """

    def __init__(self, storage_path: Path | None = None):
        """
        Initialize session store

        Args:
            storage_path: Directory to store session files
        """
        self.storage_path = storage_path or Path.home() / ".oauth-sessions"
        self.storage_path.mkdir(exist_ok=True)
        self._lock = threading.Lock()

    def save_session(self, session: SessionData) -> bool:
        """
        Save session to disk

        Args:
            session: Session data to save

        Returns:
            True if saved successfully, False otherwise
        """
        try:
            with self._lock:
                session_file = self.storage_path / f"{session.session_id}.json"
                session_file.write_text(json.dumps(session.to_dict(), indent=2))
                return True
        except Exception as e:
            logger.error(f"Failed to save session {session.session_id}: {e}")
            return False

    def load_session(self, session_id: str) -> SessionData | None:
        """
        Load session from disk

        Args:
            session_id: Session ID to load

        Returns:
            Session data if found, None otherwise
        """
        try:
            with self._lock:
                session_file = self.storage_path / f"{session_id}.json"
                if session_file.exists():
                    data = json.loads(session_file.read_text())
                    return SessionData.from_dict(data)
        except Exception as e:
            logger.error(f"Failed to load session {session_id}: {e}")
        return None

    def delete_session(self, session_id: str) -> bool:
        """
        Delete session from disk

        Args:
            session_id: Session ID to delete

        Returns:
            True if deleted successfully, False otherwise
        """
        try:
            with self._lock:
                session_file = self.storage_path / f"{session_id}.json"
                if session_file.exists():
                    session_file.unlink()
                return True
        except Exception as e:
            logger.error(f"Failed to delete session {session_id}: {e}")
            return False

    def list_sessions(self, provider: Provider | None = None) -> list[SessionData]:
        """
        List all stored sessions

        Args:
            provider: Filter by provider (optional)

        Returns:
            List of session data
        """
        sessions = []
        try:
            with self._lock:
                for session_file in self.storage_path.glob("*.json"):
                    try:
                        data = json.loads(session_file.read_text())
                        session = SessionData.from_dict(data)

                        if provider is None or session.provider == provider:
                            sessions.append(session)
                    except Exception as e:
                        logger.warning(f"Failed to load session file {session_file}: {e}")
        except Exception as e:
            logger.error(f"Failed to list sessions: {e}")

        return sessions

    def cleanup_expired_sessions(self) -> int:
        """
        Remove expired session files

        Returns:
            Number of sessions cleaned up
        """
        cleaned = 0
        try:
            sessions = self.list_sessions()
            for session in sessions:
                if session.is_expired() or session.status in [
                    SessionStatus.COMPLETED,
                    SessionStatus.FAILED,
                    SessionStatus.CANCELLED
                ]:
                    if self.delete_session(session.session_id):
                        cleaned += 1
                        logger.debug(f"Cleaned up session {session.session_id}")
        except Exception as e:
            logger.error(f"Failed to cleanup sessions: {e}")

        return cleaned


class SessionManager:
    """
    Central OAuth session manager

    Provides high-level session management with persistence, recovery,
    and database synchronization capabilities.
    """

    def __init__(
        self,
        storage_path: Path | None = None,
        db_callback: Callable[[str, dict[str, Any]], None] | None = None,
        rust_callback: Callable[[str, dict[str, Any]], None] | None = None
    ):
        """
        Initialize session manager

        Args:
            storage_path: Directory for session persistence
            db_callback: Callback for database synchronization (session_id, event_data)
            rust_callback: Callback for Rust notification (session_id, event_data)
        """
        self.store = SessionStore(storage_path)
        self.db_callback = db_callback
        self.rust_callback = rust_callback

        # In-memory session cache
        self.sessions: dict[str, SessionData] = {}
        self._lock = threading.Lock()

        # Load existing sessions on startup
        self._load_existing_sessions()

    def create_session(
        self,
        provider: Provider,
        idp: str,
        callback_port: int,
        account_id: int | None = None,
        expires_in: int = 3600,
        **kwargs
    ) -> SessionData:
        """
        Create new OAuth session

        Args:
            provider: OAuth provider (kiro, windsurf, trae)
            idp: Identity provider (BuilderId, Github, Google)
            callback_port: Port for OAuth callback
            account_id: Associated account ID for database linking
            expires_in: Session expiration time in seconds
            **kwargs: Additional session parameters

        Returns:
            Created session data
        """
        session_id = str(uuid.uuid4())
        redirect_uri = f"http://127.0.0.1:{callback_port}/oauth/callback"

        session = SessionData(
            session_id=session_id,
            provider=provider,
            account_id=account_id,
            idp=idp,
            callback_port=callback_port,
            redirect_uri=redirect_uri,
            expires_at=time.time() + expires_in,
            **kwargs
        )

        with self._lock:
            self.sessions[session_id] = session

        # Persist to disk
        self.store.save_session(session)

        logger.info(f"Created OAuth session {session_id} for {provider.value} (account: {account_id})")

        # Notify callbacks
        self._notify_callbacks(session_id, {
            "event": "session_created",
            "session": session.to_dict()
        })

        return session

    def get_session(self, session_id: str) -> SessionData | None:
        """
        Get session by ID

        Args:
            session_id: Session ID to retrieve

        Returns:
            Session data if found, None otherwise
        """
        with self._lock:
            session = self.sessions.get(session_id)

        # Try loading from disk if not in memory
        if session is None:
            session = self.store.load_session(session_id)
            if session:
                with self._lock:
                    self.sessions[session_id] = session

        return session

    def update_session(self, session_id: str, **updates) -> bool:
        """
        Update session data

        Args:
            session_id: Session ID to update
            **updates: Fields to update

        Returns:
            True if updated successfully, False if session not found
        """
        session = self.get_session(session_id)
        if not session:
            return False

        # Update fields
        for key, value in updates.items():
            if hasattr(session, key):
                setattr(session, key, value)

        session.updated_at = time.time()

        # Persist changes
        self.store.save_session(session)

        logger.debug(f"Updated session {session_id}: {updates}")

        # Notify callbacks
        self._notify_callbacks(session_id, {
            "event": "session_updated",
            "updates": updates
        })

        return True

    def update_session_status(
        self,
        session_id: str,
        status: SessionStatus,
        error: str | None = None,
        **additional_data
    ) -> bool:
        """
        Update session status

        Args:
            session_id: Session ID to update
            status: New session status
            error: Error message (if status is FAILED)
            **additional_data: Additional data to update

        Returns:
            True if updated successfully, False if session not found
        """
        session = self.get_session(session_id)
        if not session:
            return False

        old_status = session.status
        session.update_status(status, error)

        # Update additional data
        for key, value in additional_data.items():
            if hasattr(session, key):
                setattr(session, key, value)

        # Persist changes
        self.store.save_session(session)

        logger.info(f"Session {session_id} status: {old_status.value} -> {status.value}")

        # Notify callbacks
        self._notify_callbacks(session_id, {
            "event": "status_changed",
            "old_status": old_status.value,
            "new_status": status.value,
            "error": error
        })

        return True

    def cancel_session(self, session_id: str) -> bool:
        """
        Cancel active session

        Args:
            session_id: Session ID to cancel

        Returns:
            True if cancelled successfully, False if session not found
        """
        return self.update_session_status(session_id, SessionStatus.CANCELLED)

    def complete_session(
        self,
        session_id: str,
        token_data: dict[str, Any],
        **additional_data
    ) -> bool:
        """
        Mark session as completed with token data

        Args:
            session_id: Session ID to complete
            token_data: OAuth token data
            **additional_data: Additional completion data

        Returns:
            True if completed successfully, False if session not found
        """
        return self.update_session_status(
            session_id,
            SessionStatus.COMPLETED,
            token_data=token_data,
            **additional_data
        )

    def fail_session(self, session_id: str, error: str, **additional_data) -> bool:
        """
        Mark session as failed with error

        Args:
            session_id: Session ID to fail
            error: Error message
            **additional_data: Additional error data

        Returns:
            True if failed successfully, False if session not found
        """
        return self.update_session_status(
            session_id,
            SessionStatus.FAILED,
            error=error,
            **additional_data
        )

    def list_sessions(
        self,
        provider: Provider | None = None,
        status: SessionStatus | None = None,
        account_id: int | None = None,
        active_only: bool = False
    ) -> list[SessionData]:
        """
        List sessions with optional filtering

        Args:
            provider: Filter by provider
            status: Filter by status
            account_id: Filter by account ID
            active_only: Only return active sessions

        Returns:
            List of matching sessions
        """
        # Get all sessions (memory + disk)
        all_sessions = {}

        # Add sessions from memory
        with self._lock:
            all_sessions.update(self.sessions)

        # Add sessions from disk (if not already in memory)
        disk_sessions = self.store.list_sessions(provider)
        for session in disk_sessions:
            if session.session_id not in all_sessions:
                all_sessions[session.session_id] = session

        # Apply filters
        filtered_sessions = []
        for session in all_sessions.values():
            # Provider filter
            if provider and session.provider != provider:
                continue

            # Status filter
            if status and session.status != status:
                continue

            # Account ID filter
            if account_id and session.account_id != account_id:
                continue

            # Active only filter
            if active_only and not session.is_active():
                continue

            filtered_sessions.append(session)

        # Sort by creation time (newest first)
        filtered_sessions.sort(key=lambda s: s.created_at, reverse=True)

        return filtered_sessions

    def get_active_sessions(self, provider: Provider | None = None) -> list[SessionData]:
        """Get all active sessions"""
        return self.list_sessions(provider=provider, active_only=True)

    def cleanup_sessions(self, force: bool = False) -> int:
        """
        Cleanup expired and completed sessions

        Args:
            force: Force cleanup of all non-active sessions

        Returns:
            Number of sessions cleaned up
        """
        cleaned = 0

        # Cleanup from memory
        with self._lock:
            to_remove = []
            for session_id, session in self.sessions.items():
                should_remove = (
                    session.is_expired() or
                    session.status in [SessionStatus.COMPLETED, SessionStatus.FAILED, SessionStatus.CANCELLED] or
                    (force and not session.is_active())
                )

                if should_remove:
                    to_remove.append(session_id)

            for session_id in to_remove:
                del self.sessions[session_id]
                cleaned += 1

        # Cleanup from disk
        disk_cleaned = self.store.cleanup_expired_sessions()
        cleaned += disk_cleaned

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} OAuth sessions")

        return cleaned

    def recover_sessions(self) -> int:
        """
        Recover sessions from disk storage

        Returns:
            Number of sessions recovered
        """
        recovered = 0

        try:
            disk_sessions = self.store.list_sessions()

            with self._lock:
                for session in disk_sessions:
                    if session.session_id not in self.sessions and session.is_active():
                        self.sessions[session.session_id] = session
                        recovered += 1
                        logger.debug(f"Recovered session {session.session_id}")

            if recovered > 0:
                logger.info(f"Recovered {recovered} OAuth sessions from disk")

        except Exception as e:
            logger.error(f"Failed to recover sessions: {e}")

        return recovered

    def get_session_stats(self) -> dict[str, Any]:
        """
        Get session statistics

        Returns:
            Dictionary with session statistics
        """
        all_sessions = self.list_sessions()

        stats: dict[str, Any] = {
            "total_sessions": len(all_sessions),
            "active_sessions": len([s for s in all_sessions if s.is_active()]),
            "by_provider": {},
            "by_status": {},
            "expired_sessions": len([s for s in all_sessions if s.is_expired()])
        }

        # Count by provider
        for provider in Provider:
            provider_sessions = [s for s in all_sessions if s.provider == provider]
            stats["by_provider"][provider.value] = len(provider_sessions)

        # Count by status
        for status in SessionStatus:
            status_sessions = [s for s in all_sessions if s.status == status]
            stats["by_status"][status.value] = len(status_sessions)

        return stats

    def _load_existing_sessions(self):
        """Load existing sessions from disk on startup"""
        try:
            self.recover_sessions()
            self.cleanup_sessions()  # Clean up expired sessions
        except Exception as e:
            logger.error(f"Failed to load existing sessions: {e}")

    def _notify_callbacks(self, session_id: str, event_data: dict[str, Any]):
        """Notify registered callbacks of session events"""
        try:
            # Database callback
            if self.db_callback:
                self.db_callback(session_id, event_data)
        except Exception as e:
            logger.error(f"Database callback error for session {session_id}: {e}")

        try:
            # Rust callback
            if self.rust_callback:
                self.rust_callback(session_id, event_data)
        except Exception as e:
            logger.error(f"Rust callback error for session {session_id}: {e}")


# Global session manager instance
_global_session_manager: SessionManager | None = None


def get_session_manager(
    storage_path: Path | None = None,
    db_callback: Callable[[str, dict[str, Any]], None] | None = None,
    rust_callback: Callable[[str, dict[str, Any]], None] | None = None
) -> SessionManager:
    """
    Get global session manager instance

    Args:
        storage_path: Storage path (only used on first call)
        db_callback: Database callback (only used on first call)
        rust_callback: Rust callback (only used on first call)

    Returns:
        Global session manager instance
    """
    global _global_session_manager

    if _global_session_manager is None:
        _global_session_manager = SessionManager(
            storage_path=storage_path,
            db_callback=db_callback,
            rust_callback=rust_callback
        )

    return _global_session_manager


__all__ = [
    'SessionStatus',
    'Provider',
    'SessionData',
    'SessionStore',
    'SessionManager',
    'get_session_manager'
]
