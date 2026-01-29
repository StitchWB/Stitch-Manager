"""
Shared module - Common utilities used by all providers.

Contains:
- OAuth callback server
- OAuth session manager
- Password generation utilities
- Name generation utilities
- Browser initialization utilities
- Logging utilities
"""

from .browser_utils import (
    clear_browser_data,
    create_browser,
    create_browser_options,
    wait_for_cdp_ready,
)
from .logging_utils import SafeLogger, create_safe_logger, safe_log, strip_ansi_codes
from .name_utils import generate_github_username, generate_name_from_email, split_name
from .oauth_callback_server import CallbackHandler, OAuthCallbackServer
from .password_utils import generate_secure_password
from .session_manager import (
    Provider,
    SessionData,
    SessionManager,
    SessionStatus,
    get_session_manager,
)

__all__ = [
    # OAuth
    'OAuthCallbackServer',
    'CallbackHandler',
    # Session management
    'SessionManager',
    'SessionData',
    'SessionStatus',
    'Provider',
    'get_session_manager',
    # Password utilities
    'generate_secure_password',
    # Name utilities
    'generate_name_from_email',
    'generate_github_username',
    'split_name',
    # Browser utilities
    'create_browser_options',
    'create_browser',
    'wait_for_cdp_ready',
    'clear_browser_data',
    # Logging utilities
    'safe_log',
    'create_safe_logger',
    'SafeLogger',
    'strip_ansi_codes',
]
