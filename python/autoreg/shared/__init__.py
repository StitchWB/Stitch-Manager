"""
Shared module - Common utilities used by all providers.

Contains:
- OAuth callback server
- OAuth session manager
"""

from .oauth_callback_server import OAuthCallbackServer, CallbackHandler
from .session_manager import (
    SessionManager, SessionData, SessionStatus, Provider,
    get_session_manager
)

__all__ = [
    'OAuthCallbackServer', 
    'CallbackHandler',
    'SessionManager',
    'SessionData',
    'SessionStatus',
    'Provider',
    'get_session_manager',
]
