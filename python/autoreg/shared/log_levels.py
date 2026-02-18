"""
Log level and stage enums for structured logging system.
"""

from enum import Enum


class LogLevel(Enum):
    """Log verbosity levels"""
    MINIMAL = "minimal"    # Only critical steps (success/error)
    NORMAL = "normal"      # Standard output (default) - info + success + error
    VERBOSE = "verbose"    # All details including progress updates
    DEBUG = "debug"        # Technical details and debug information


class LogStage(Enum):
    """Registration process stages"""
    BROWSER = "Browser"
    EMAIL = "Email"
    NAME = "Name"
    IMAP = "IMAP"
    VERIFICATION = "Verification"
    PASSWORD = "Password"
    OAUTH = "OAuth"
    AWS = "AWS"
    SYSTEM = "System"
    
    def __str__(self) -> str:
        return self.value
