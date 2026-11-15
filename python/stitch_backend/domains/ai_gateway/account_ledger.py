"""Per-account usage ledger, learned daily caps, and cache-affinity routing state."""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.ai_gateway.adapters.error_vocab import local_tz
from stitch_backend.domains.ai_gateway.models import (
    AIGatewayAccountCap,
    AIGatewayAccountUsage,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

SOFT_CAP_RATIO = 0.9
UNGROUPED = "-"
RESET_TIMEZONE = "Europe/Moscow"

AFFINITY_TTL_SECONDS = 45 * 60
_AFFINITY_MAX_ENTRIES = 4096
_MESSAGE_TRUNCATE = 512

_affinity: dict[str, tuple[str, str | None, float]] = {}


def day_local_now(now: datetime | None = None) -> str:
    tz = local_tz(RESET_TIMEZONE)
    reference = now.astimezone(tz) if now is not None else datetime.now(tz)
    return reference.strftime("%Y-%m-%d")


def soft_cap(observed_requests: int | None) -> float:
    if not observed_requests or observed_requests <= 0:
        return 0.0
    return observed_requests * SOFT_CAP_RATIO


def _group_key(account_group: str | None) -> str:
    return account_group or UNGROUPED


async def record_usage(
    session: AsyncSession,
    *,
    endpoint_id: str,
    account_group: str | None,
    requests: int = 1,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cached_tokens: int = 0,
    spend_cents: int = 0,
    now: datetime | None = None,
) -> None:
    values: dict[str, Any] = {
        "endpoint_id": endpoint_id,
        "account_group": _group_key(account_group),
        "day_local": day_local_now(now),
        "requests": requests,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cached_tokens": cached_tokens,
        "spend_cents": spend_cents,
        "updated_at": _utcnow(),
    }
    stmt = (
        sqlite_insert(AIGatewayAccountUsage)
        .values(**values)
        .on_conflict_do_update(
            index_elements=["endpoint_id", "account_group", "day_local"],
            set_={
                "requests": AIGatewayAccountUsage.requests + requests,
                "tokens_in": AIGatewayAccountUsage.tokens_in + tokens_in,
                "tokens_out": AIGatewayAccountUsage.tokens_out + tokens_out,
                "cached_tokens": AIGatewayAccountUsage.cached_tokens + cached_tokens,
                "spend_cents": AIGatewayAccountUsage.spend_cents + spend_cents,
                "updated_at": values["updated_at"],
            },
        )
    )
    await session.execute(stmt)
    await session.flush()


async def learn_cap(
    session: AsyncSession,
    endpoint_id: str,
    account_group: str | None,
    now: datetime | None = None,
) -> int | None:
    group = _group_key(account_group)
    usage = await session.get(
        AIGatewayAccountUsage, (endpoint_id, group, day_local_now(now)),
    )
    requests_today = usage.requests if usage is not None else 0
    cap = await session.get(AIGatewayAccountCap, (endpoint_id, group))
    current = cap.observed_requests if cap is not None else None
    if requests_today <= 0 and not current:
        return None
    observed = max(current or 0, requests_today)
    if cap is None:
        session.add(
            AIGatewayAccountCap(
                endpoint_id=endpoint_id,
                account_group=group,
                observed_requests=observed,
                updated_at=_utcnow(),
            ),
        )
    else:
        cap.observed_requests = observed
        cap.updated_at = _utcnow()
    await session.flush()
    return observed


async def headroom_ratio(
    session: AsyncSession,
    endpoint_id: str,
    account_group: str | None,
    model_or_none: str | None = None,
    now: datetime | None = None,
) -> float:
    del model_or_none
    group = _group_key(account_group)
    try:
        cap = await session.get(AIGatewayAccountCap, (endpoint_id, group))
        if cap is None or not cap.observed_requests:
            return 1.0
        limit = soft_cap(cap.observed_requests)
        usage = await session.get(
            AIGatewayAccountUsage, (endpoint_id, group, day_local_now(now)),
        )
    except Exception:
        logger.debug("Account ledger unavailable; assuming full headroom", exc_info=True)
        return 1.0
    used = usage.requests if usage is not None else 0
    if limit <= 0:
        return 1.0
    return max(0.0, min(1.0, (limit - used) / limit))


def _first_user_content(messages: list[dict[str, Any]] | None) -> str | None:
    for message in messages or ():
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                part.get("text")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            return "".join(parts) if parts else None
        return None
    return None


def _affinity_key(
    model: str,
    messages: list[dict[str, Any]] | None,
    user: str | None,
) -> str | None:
    if isinstance(user, str) and user.strip():
        seed = f"user\x00{user.strip()}"
    else:
        content = _first_user_content(messages)
        if not content:
            return None
        seed = f"{model}\x00{content[:_MESSAGE_TRUNCATE]}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def get_affinity(
    model: str,
    messages: list[dict[str, Any]] | None,
    user: str | None = None,
    *,
    now: float | None = None,
) -> tuple[str, str | None] | None:
    key = _affinity_key(model, messages, user)
    if key is None:
        return None
    entry = _affinity.get(key)
    if entry is None:
        return None
    endpoint_id, account_group, expires_at = entry
    current = time.monotonic() if now is None else now
    if current >= expires_at:
        _affinity.pop(key, None)
        return None
    return (endpoint_id, account_group)


def put_affinity(
    model: str,
    messages: list[dict[str, Any]] | None,
    user: str | None,
    endpoint_id: str,
    account_group: str | None,
    *,
    ttl_seconds: float = AFFINITY_TTL_SECONDS,
    now: float | None = None,
) -> None:
    key = _affinity_key(model, messages, user)
    if key is None:
        return
    current = time.monotonic() if now is None else now
    if len(_affinity) >= _AFFINITY_MAX_ENTRIES:
        _prune_affinity(current)
        if len(_affinity) >= _AFFINITY_MAX_ENTRIES:
            _affinity.clear()
    _affinity[key] = (endpoint_id, account_group, current + ttl_seconds)


def clear_affinity(endpoint_id: str, account_group: str | None) -> None:
    stale = [
        key for key, value in _affinity.items()
        if value[0] == endpoint_id and value[1] == account_group
    ]
    for key in stale:
        _affinity.pop(key, None)


def _prune_affinity(now: float) -> None:
    stale = [key for key, value in _affinity.items() if value[2] <= now]
    for key in stale:
        _affinity.pop(key, None)


def reset_affinity() -> None:
    _affinity.clear()