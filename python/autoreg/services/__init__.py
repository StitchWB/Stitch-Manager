"""
Services module - Shared services for autoreg.
"""

from .addyio import AddyIoConfig, AddyIoService, create_email_alias
from .email_manager import EmailContext, EmailManager

__all__ = [
    'AddyIoService',
    'AddyIoConfig',
    'create_email_alias',
    'EmailManager',
    'EmailContext',
]
