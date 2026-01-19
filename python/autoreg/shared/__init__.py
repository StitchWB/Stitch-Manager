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

from .oauth_callback_server import OAuthCallbackServer, CallbackHandler
from .session_manager import (
    SessionManager, SessionData, SessionStatus, Provider,
    get_session_manager
)
from .password_utils import generate_secure_password
from .name_utils import (
    generate_name_from_email,
    generate_github_username,
    split_name
)
from .browser_utils import (
    create_browser_options,
    create_browser,
    wait_for_cdp_ready,
    clear_browser_data
)
from .logging_utils import (
    safe_log,
    create_safe_logger,
    SafeLogger,
    strip_ansi_codes
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
