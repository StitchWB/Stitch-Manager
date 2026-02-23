"""
Email provider system for automated registration.

This package provides a clean architecture for email generation, verification,
and strategy management with support for multiple providers.
"""

from .base import EmailContext, IEmailGenerator, IEmailVerifier, IEmailStrategy
from .cleanup_queue import CleanupQueue, CleanupTask, cleanup_queue
from .adapter import EmailManagerAdapter, LegacyEmailContext

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
