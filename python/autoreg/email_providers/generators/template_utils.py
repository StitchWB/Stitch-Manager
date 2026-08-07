"""Template utilities for email address generation.

Provides a unified template system for all email generators:
- {rndN}     : N random lowercase alphanumeric chars
- {counter}  : Thread-safe incrementing counter
- {time}     : Unix timestamp (seconds)
- {name}     : Sanitized description/name (lower, spaces→hyphens, max 20 chars)
- {uuid4}    : UUID4 hex (no dashes)
- {uuid4_8}  : First 8 chars of UUID4
"""

import logging
import random
import string
import threading
import time
import uuid as uuid_module

logger = logging.getLogger(__name__)


class TemplateState:
    """Thread-safe state for template rendering."""

    def __init__(self, start_counter: int = 0):
        self._counter = start_counter
        self._lock = threading.Lock()

    def next_counter(self) -> int:
        with self._lock:
            current = self._counter
            self._counter += 1
            return current


def _get_rnd(length: int = 8) -> str:
    """Generate random alphanumeric string."""
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choices(chars, k=length))


def _get_time() -> str:
    """Current Unix timestamp as string."""
    return str(int(time.time()))


def _get_name(description: str | None) -> str:
    """Sanitize description for email local part."""
    if not description:
        return "auto"
    clean = description.lower().replace(' ', '-')[:20]
    # Remove chars not valid in email local part
    valid_chars = string.ascii_lowercase + string.digits + '-_.+'
    return ''.join(c for c in clean if c in valid_chars) or "auto"


def _get_uuid(full: bool = True) -> str:
    """UUID4 hex string."""
    uid = uuid_module.uuid4().hex
    if not full:
        uid = uid[:8]
    return uid


def render_template(
    template: str,
    state: TemplateState | None = None,
    description: str | None = None,
) -> str:
    """Render an email local-part template.

    Supported placeholders:
        {rndN}      → N random lowercase alphanumeric chars
        {counter}   → incrementing counter (requires state)
        {time}      → Unix timestamp
        {name}      → sanitized description
        {uuid4}     → full UUID4 hex (32 chars)
        {uuid4_8}   → first 8 chars of UUID4

    Args:
        template: Template string, e.g. "{name}-{rnd8}" or "{time}{rnd4}"
        state: Optional TemplateState for {counter}
        description: Optional description for {name}

    Returns:
        Rendered string suitable for email local part.

    Examples:
        >>> render_template("{rnd10}")
        'a3f9k2m8p1'
        >>> render_template("{name}-{rnd8}", description="Fireworks")
        'fireworks-a3f9k2m8'
        >>> render_template("{counter}-{time}", state=TemplateState(5))
        '5-1700000000'
    """
    import re

    result = template

    # {rndN} — random N chars
    for match in re.finditer(r'\{rnd(\d+)\}', template):
        full_match = match.group(0)
        n = int(match.group(1))
        result = result.replace(full_match, _get_rnd(n), 1)

    # {counter}
    if '{counter}' in result:
        if state is None:
            logger.warning("Template uses {counter} but no state provided, using 0")
            counter_val = 0
        else:
            counter_val = state.next_counter()
        result = result.replace('{counter}', str(counter_val), 1)

    # {time}
    if '{time}' in result:
        result = result.replace('{time}', _get_time(), 1)

    # {name}
    if '{name}' in result:
        result = result.replace('{name}', _get_name(description), 1)

    # {uuid4}
    if '{uuid4}' in result:
        result = result.replace('{uuid4}', _get_uuid(full=True), 1)

    # {uuid4_8}
    if '{uuid4_8}' in result:
        result = result.replace('{uuid4_8}', _get_uuid(full=False), 1)

    return result
