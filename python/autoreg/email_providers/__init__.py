"""
Email provider system for automated registration.

This package provides a clean architecture for email generation, verification,
and strategy management with support for multiple providers.
"""

from .adapter import EmailManagerAdapter, LegacyEmailContext
from .base import EmailContext, IEmailGenerator, IEmailStrategy, IEmailVerifier
from .cleanup_queue import CleanupQueue, CleanupTask, cleanup_queue

__all__ = [
    'EmailContext',
    'IEmailGenerator',
    'IEmailVerifier',
    'IEmailStrategy',
    'CleanupQueue',
    'CleanupTask',
    'cleanup_queue',
    'EmailManagerAdapter',
    'LegacyEmailContext',
]
