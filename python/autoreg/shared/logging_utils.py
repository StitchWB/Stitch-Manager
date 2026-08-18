"""Logging utilities for safe cross-platform output."""

import re
import sys
from collections.abc import Callable


def safe_log(message: str) -> str:
    """
    Remove emojis and special characters for safe logging.

    This is critical for Windows console compatibility where emojis
    can cause encoding errors or display issues.

    Args:
        message: Original message with potential emojis

    Returns:
        Sanitized message safe for logging

    Example:
        >>> safe_log("✅ Success!")
        '[OK] Success!'
        >>> safe_log("❌ Error occurred")
        '[ERROR] Error occurred'
    """
    # Replace common emojis with text equivalents
    emoji_map = {
        '✓': '[OK]',
        '✅': '[OK]',
        '❌': '[ERROR]',
        '⚠️': '[WARN]',
        '⚠': '[WARN]',
        '📧': '',
        '🔍': '',
        '🔐': '',
        '📬': '',
        '🚀': '',
        '🌐': '',
        '📝': '',
        '📮': '',
        '📥': '',
        '⏳': '',
        '⏱️': '',
        '⏱': '',
        '💡': '',
        '🗑️': '',
        '🗑': '',
        '👤': '',
        '🔑': '',
        '📍': '',
        '🔄': '',
        '🖱️': '',
        '🖱': '',
        '📐': '',
    }

    # Replace known emojis
    for emoji, replacement in emoji_map.items():
        message = message.replace(emoji, replacement)

    # Remove any remaining non-ASCII characters
    message = re.sub(r'[^\x00-\x7F]+', '', message)

    return message


def create_safe_logger(prefix: str = "") -> Callable[[str], None]:
    """
    Create a logger function that safely handles emojis.

    Args:
        prefix: Optional prefix for all log messages (e.g., "[Provider]")

    Returns:
        Logger function that takes a message string

    Example:
        >>> log = create_safe_logger("[GitHub]")
        >>> log("✅ Registration successful")
        [GitHub] [OK] Registration successful
    """
    def log(message: str):
        safe_message = safe_log(message)
        if prefix:
            safe_message = f"{prefix} {safe_message}"
        print(safe_message, flush=True)

    return log


def setup_console_encoding():
    """
    Setup console encoding for better Unicode support.

    This attempts to configure the console for UTF-8 on Windows,
    which can help with emoji display. Call this at the start of
    your script if you want to try displaying emojis.

    Note: This may not work on all Windows configurations.
    """
    if sys.platform == 'win32':
        try:
            # Try to set UTF-8 encoding on Windows
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleCP(65001)  # UTF-8 input
            kernel32.SetConsoleOutputCP(65001)  # UTF-8 output
        except Exception:
            pass  # Silently fail if not supported


def strip_ansi_codes(text: str) -> str:
    """
    Remove ANSI color codes from text.

    Useful for cleaning up colored terminal output before
    saving to files or sending to systems that don't support colors.

    Args:
        text: Text potentially containing ANSI codes

    Returns:
        Text with ANSI codes removed

    Example:
        >>> strip_ansi_codes("\\033[31mError\\033[0m")
        'Error'
    """
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)


class SafeLogger:
    """
    Logger class with safe emoji handling and optional callback.

    Example:
        >>> logger = SafeLogger(prefix="[Provider]")
        >>> logger.log("✅ Success")
        [Provider] [OK] Success

        >>> def callback(msg):
        ...     print(f"Callback: {msg}")
        >>> logger = SafeLogger(callback=callback)
        >>> logger.log("Test")
        Test
        Callback: Test
    """

    def __init__(self, prefix: str = "", callback: Callable[[str], None] | None = None):
        """
        Initialize SafeLogger.

        Args:
            prefix: Optional prefix for all messages
            callback: Optional callback function to receive log messages
        """
        self.prefix = prefix
        self.callback = callback

    def log(self, message: str):
        """Log a message with safe emoji handling."""
        safe_message = safe_log(message)
        if self.prefix:
            safe_message = f"{self.prefix} {safe_message}"

        print(safe_message, flush=True)

        if self.callback:
            self.callback(safe_message)

    def set_callback(self, callback: Callable[[str], None]):
        """Set or update the callback function."""
        self.callback = callback
