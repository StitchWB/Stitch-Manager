"""
Shared module - Common utilities used by all providers.

Contains:
- OAuth callback server
- IMAP mail handler
- Base browser automation
"""

from .mail_handler import MailHandler, create_mail_handler_from_env
from .oauth_callback_server import OAuthCallbackServer, CallbackHandler

__all__ = [
    'MailHandler',
    'create_mail_handler_from_env',
    'OAuthCallbackServer', 
    'CallbackHandler',
]
