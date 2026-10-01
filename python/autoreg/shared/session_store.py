"""Persistent OAuth session storage on disk."""

import json
import logging
import threading
from pathlib import Path

from .session_models import Provider, SessionData, SessionStatus

# Logger name pinned: log routing targets the historical autoreg.shared.session_manager name.
logger = logging.getLogger("autoreg.shared.session_manager")


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
