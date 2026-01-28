"""
Services module - Shared services for autoreg.
"""

from .addyio import AddyIoService, AddyIoConfig, create_email_alias
from .email_manager import EmailManager, EmailContext

__all__ = [
    'AddyIoService',
    'AddyIoConfig',
    'create_email_alias',
    'EmailManager',
    'EmailContext',
]
