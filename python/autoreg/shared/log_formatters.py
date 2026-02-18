"""
Log formatting utilities for structured logging system.
"""

from datetime import datetime
from typing import Optional


# Icon mapping for different stages
STAGE_ICONS = {
    "Browser": "🌐",
    "Email": "📧",
    "Name": "👤",
    "IMAP": "📬",
    "Verification": "📬",
    "Password": "🔐",
    "OAuth": "🔑",
    "AWS": "☁️",
    "System": "⚙️",
}

# Status icons for different message types
STATUS_ICONS = {
    "success": "✅",
    "error": "❌",
    "warning": "⚠️",
    "info": "ℹ️",
    "progress": "⏳",
}


def format_duration(seconds: float) -> str:
    """
    Format duration as +X.Xs
    
    Args:
        seconds: Duration in seconds
        
    Returns:
        Formatted duration string (e.g., "+2.5s")
    """
    return f"+{seconds:.1f}s"


def format_timestamp() -> str:
    """
    Format current timestamp as HH:MM:SS
    
    Returns:
        Formatted timestamp string
    """
    return datetime.now().strftime("%H:%M:%S")


def format_log_entry(
    account_id: str,
    stage: str,
    level: str,
    message: str,
    duration: Optional[float] = None,
    status: Optional[str] = None,
) -> str:
    """
    Format log entry with consistent structure.
    
    Format: [account_id] [stage] icon [+duration] status_icon message
    Example: [1/3] [Email] 📧 [+2.5s] ✅ Email entered
    
    Args:
        account_id: Account identifier (e.g., "1/3")
        stage: Stage name (e.g., "Email", "Browser")
        level: Log level (e.g., "info", "error", "debug")
        message: Log message
        duration: Optional duration in seconds
        status: Optional status type for icon (e.g., "success", "error")
        
    Returns:
        Formatted log entry string
    """
    # Build components
    parts = []
    
    # Account ID
    parts.append(f"[{account_id}]")
    
    # Stage with icon
    stage_icon = STAGE_ICONS.get(stage, "📋")
    parts.append(f"[{stage}] {stage_icon}")
    
    # Duration if provided
    if duration is not None:
        parts.append(f"[{format_duration(duration)}]")
    
    # Status icon if provided
    if status and status in STATUS_ICONS:
        parts.append(STATUS_ICONS[status])
    
    # Message
    parts.append(message)
    
    return " ".join(parts)


def format_progress(current: int, total: int) -> str:
    """
    Format progress counter as [X/Y]
    
    Args:
        current: Current step number
        total: Total number of steps
        
    Returns:
        Formatted progress string (e.g., "[2/5]")
    """
    return f"[{current}/{total}]"


def format_progress_bar(current: int, total: int, width: int = 20) -> str:
    """
    Format progress bar with percentage using ASCII-safe characters.
    
    Args:
        current: Current step number
        total: Total number of steps
        width: Width of progress bar in characters (default: 20)
        
    Returns:
        Formatted progress bar string (e.g., "[========........] 40%")
    """
    if total == 0:
        return "[" + "." * width + "] 0%"
    
    percentage = min(100, int((current / total) * 100))
    filled = int((current / total) * width)
    bar = "=" * filled + "." * (width - filled)
    
    return f"[{bar}] {percentage}%"


def format_imap_attempt(attempt: int, total: int, status: str = "searching") -> str:
    """
    Format IMAP attempt line with progress bar.
    
    Args:
        attempt: Current attempt number
        total: Total attempts
        status: Status text (searching, found, failed)
        
    Returns:
        Formatted attempt string (e.g., "Attempt 5/30 [==........] 17% - searching")
    """
    progress_bar = format_progress_bar(attempt, total, width=10)
    return f"Attempt {attempt}/{total} {progress_bar} - {status}"
