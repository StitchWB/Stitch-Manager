"""Non-blocking per-credential in-flight limiter.

Two-level accounting, backward compatible:

* ``_total`` — per-credential in-flight count (the original cap).
* ``_by_model`` — per-credential, per-upstream-model breakdown, used to
  enforce ``distinct_model_cap``: a key may serve at most N *different*
  upstream models concurrently.  Additional concurrency on a model already
  in flight does not consume a new distinct slot.

Callers that never pass ``upstream_model_id`` observe exactly the legacy
behavior: the total cap only.
"""

from __future__ import annotations

import threading

PER_CREDENTIAL_CAP = 6

_total: dict[str, int] = {}
_by_model: dict[str, dict[str, int]] = {}
_lock = threading.Lock()


def try_acquire(
    credential_id: str,
    upstream_model_id: str | None = None,
    *,
    cap: int = PER_CREDENTIAL_CAP,
    distinct_model_cap: int | None = None,
) -> bool:
    """Atomically check both caps and acquire one in-flight slot.

    ``distinct_model_cap`` applies only when ``upstream_model_id`` is given:
    a *new* distinct model is refused once the key already serves
    ``distinct_model_cap`` different models; re-entering a model already in
    flight is governed by the total cap alone.
    """
    with _lock:
        if not _can_acquire_locked(
            credential_id,
            upstream_model_id,
            cap=cap,
            distinct_model_cap=distinct_model_cap,
        ):
            return False
        current = _total.get(credential_id, 0)
        _total[credential_id] = current + 1
        if upstream_model_id is not None:
            models = _by_model.setdefault(credential_id, {})
            models[upstream_model_id] = models.get(upstream_model_id, 0) + 1
        return True


def _can_acquire_locked(
    credential_id: str,
    upstream_model_id: str | None,
    *,
    cap: int,
    distinct_model_cap: int | None,
    total: int | None = None,
    models: dict[str, int] | None = None,
) -> bool:
    """Shared cap predicate.  Caller must hold ``_lock``."""
    current = _total.get(credential_id, 0) if total is None else total
    if current >= cap:
        return False
    if distinct_model_cap is not None and upstream_model_id is not None:
        model_counts = (
            _by_model.get(credential_id, {}) if models is None else models
        )
        if upstream_model_id not in model_counts and len(model_counts) >= distinct_model_cap:
            return False
    return True


def would_acquire_after_release(
    credential_id: str,
    upstream_model_id: str | None = None,
    *,
    cap: int = PER_CREDENTIAL_CAP,
    distinct_model_cap: int | None = None,
    released_slot: tuple[str, str | None] | None = None,
) -> bool:
    """Non-mutating cap check, optionally ignoring one slot that will release.

    The executor uses this for failover lookahead: while candidate N is in
    flight its own slot must not make candidate N+1 look permanently capped —
    if N fails, that slot is released before N+1 can be attempted.  No state
    is changed here, so the check is a point-in-time predicate only.
    """
    with _lock:
        total = _total.get(credential_id, 0)
        models = dict(_by_model.get(credential_id, {}))
        if released_slot is not None and released_slot[0] == credential_id:
            total = max(0, total - 1)
            released_model = released_slot[1]
            if released_model is not None and released_model in models:
                remaining = models[released_model] - 1
                if remaining > 0:
                    models[released_model] = remaining
                else:
                    models.pop(released_model, None)
        return _can_acquire_locked(
            credential_id,
            upstream_model_id,
            cap=cap,
            distinct_model_cap=distinct_model_cap,
            total=total,
            models=models,
        )


def release(credential_id: str, upstream_model_id: str | None = None) -> None:
    with _lock:
        current = _total.get(credential_id, 0) - 1
        if current > 0:
            _total[credential_id] = current
        else:
            _total.pop(credential_id, None)
        if upstream_model_id is not None:
            models = _by_model.get(credential_id)
            if models is not None:
                remaining = models.get(upstream_model_id, 0) - 1
                if remaining > 0:
                    models[upstream_model_id] = remaining
                else:
                    models.pop(upstream_model_id, None)
                if not models:
                    _by_model.pop(credential_id, None)


def in_flight(credential_id: str) -> int:
    with _lock:
        return _total.get(credential_id, 0)


def distinct_models_in_flight(credential_id: str) -> int:
    with _lock:
        return len(_by_model.get(credential_id, {}))


def reset() -> None:
    with _lock:
        _total.clear()
        _by_model.clear()
