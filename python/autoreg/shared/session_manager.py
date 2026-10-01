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

import logging
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .session_models import Provider, SessionData, SessionStatus
from .session_store import SessionStore

logger = logging.getLogger(__name__)


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

        self.sessions: dict[str, SessionData] = {}
        self._lock = threading.Lock()

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

        self.store.save_session(session)

        logger.info(f"Created OAuth session {session_id} for {provider.value} (account: {account_id})")

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

        for key, value in updates.items():
            if hasattr(session, key):
                setattr(session, key, value)

        session.updated_at = time.time()

        self.store.save_session(session)

        logger.debug(f"Updated session {session_id}: {updates}")

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

        for key, value in additional_data.items():
            if hasattr(session, key):
                setattr(session, key, value)

        self.store.save_session(session)

        logger.info(f"Session {session_id} status: {old_status.value} -> {status.value}")

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
        all_sessions = {}

        with self._lock:
            all_sessions.update(self.sessions)

        disk_sessions = self.store.list_sessions(provider)
        for session in disk_sessions:
            if session.session_id not in all_sessions:
                all_sessions[session.session_id] = session

        filtered_sessions = []
        for session in all_sessions.values():
            if provider and session.provider != provider:
                continue

            if status and session.status != status:
                continue

            if account_id and session.account_id != account_id:
                continue

            if active_only and not session.is_active():
                continue

            filtered_sessions.append(session)

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

        for provider in Provider:
            provider_sessions = [s for s in all_sessions if s.provider == provider]
            stats["by_provider"][provider.value] = len(provider_sessions)

        for status in SessionStatus:
            status_sessions = [s for s in all_sessions if s.status == status]
            stats["by_status"][status.value] = len(status_sessions)

        return stats

    def _load_existing_sessions(self):
        """Load existing sessions from disk on startup"""
        try:
            self.recover_sessions()
            self.cleanup_sessions()
        except Exception as e:
            logger.error(f"Failed to load existing sessions: {e}")

    def _notify_callbacks(self, session_id: str, event_data: dict[str, Any]):
        """Notify registered callbacks of session events"""
        try:
            if self.db_callback:
                self.db_callback(session_id, event_data)
        except Exception as e:
            logger.error(f"Database callback error for session {session_id}: {e}")

        try:
            if self.rust_callback:
                self.rust_callback(session_id, event_data)
        except Exception as e:
            logger.error(f"Rust callback error for session {session_id}: {e}")


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
