"""Email generators for creating email addresses"""

from .base import IEmailGenerator, EmailContext
from .static import StaticEmailGenerator
from .counter import CounterEmailGenerator
from .addyio import AddyIoEmailGenerator
from .thirtythreemail import ThirtyThreeMailGenerator
from .mailtm import MailTmEmailGenerator

__all__ = [
    'IEmailGenerator',
    'EmailContext',
    'StaticEmailGenerator',
    'CounterEmailGenerator',
    'AddyIoEmailGenerator',
    'ThirtyThreeMailGenerator',
    'MailTmEmailGenerator',
]
