"""Datetime helpers shared by stitch_server routers.

SQLite does not store tz info for ``DateTime(timezone=True)`` columns;
SQLAlchemy returns naive datetimes on read.  All stored times are written
with ``datetime.now(UTC)`` (aware), so a naive readback is implicitly UTC.
Centralized here so every router normalizes identically before comparing
or serializing (an aware ``isoformat()`` keeps the frontend's ``Date.parse``
timezone-correct).
"""

from __future__ import annotations

from datetime import UTC, datetime


def as_utc(dt: datetime) -> datetime:
    """Return ``dt`` as timezone-aware, assuming UTC when naive."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt
