"""Tests for the model-health query shaping helpers (pure, no DB)."""

from __future__ import annotations

from stitch_backend.domains.ai_gateway.commands.model_health import (
    _aggregate,
    _canonical,
    _reason_group,
    _shape,
)
from stitch_backend.domains.ai_gateway.schemas.model_health import (
    ListModelHealthRequest,
)


def _row(**kw):
    base = {
        "endpointId": "ep1",
        "model": "m",
        "canonical": "m",
        "status": "available",
        "alive": True,
        "usable": True,
        "reason": "ok",
        "vision": None,
        "tools": None,
        "latencyMs": None,
        "lastVerifiedAt": None,
        "discoveredAt": None,
    }
    base.update(kw)
    return base


def test_reason_group_mapping() -> None:
    assert _reason_group("quota_exhausted") == "balance"
    assert _reason_group("server_error") == "channel"
    assert _reason_group("auth_failed") == "auth"
    assert _reason_group("model_not_found") == "missing"
    assert _reason_group("transport_error") == "transport"
    assert _reason_group(None) == "unknown"


def test_canonical_strips_prefix_tag_and_case() -> None:
    assert _canonical("zai-org/GLM-5.3") == "glm-5.3"
    assert _canonical("qwen3.8-27b:free") == "qwen3.8-27b"
    assert _canonical("reformboss/deepseek-ai/DeepSeek-V4.1-Flash") == "deepseek-v4.1-flash"


def test_aggregate_marks_alive_and_usable() -> None:
    models = [{
        "id": "m1",
        "endpointId": "ep1",
        "model": "GLM-5.3",
        "capabilities": {"supports_vision": True, "probe_latency_ms": 120},
        "discoveredAt": None,
    }]
    access = [{
        "upstreamId": "m1",
        "credentialId": "c1",
        "status": "available",
        "lastError": None,
        "lastVerifiedAt": "2026-01-02T00:00:00+00:00",
    }]

    row = _aggregate(models, access, {"c1": "active"})[0]

    assert row["alive"] is True
    assert row["usable"] is True
    assert row["status"] == "available"
    assert row["reason"] == "ok"
    assert row["vision"] is True
    assert row["latencyMs"] == 120
    assert row["canonical"] == "glm-5.3"
    assert row["lastVerifiedAt"] == "2026-01-02T00:00:00+00:00"


def test_aggregate_alive_but_not_usable_on_dead_credential() -> None:
    models = [{"id": "m1", "endpointId": "ep1", "model": "m", "capabilities": {}, "discoveredAt": None}]
    access = [{"upstreamId": "m1", "credentialId": "c1", "status": "available", "lastError": None, "lastVerifiedAt": None}]

    row = _aggregate(models, access, {"c1": "disabled"})[0]

    assert row["alive"] is True
    assert row["usable"] is False


def test_aggregate_denied_reason_group() -> None:
    models = [{"id": "m1", "endpointId": "ep1", "model": "m", "capabilities": {}, "discoveredAt": None}]
    access = [{
        "upstreamId": "m1",
        "credentialId": "c1",
        "status": "denied",
        "lastError": "model_access_denied",
        "lastVerifiedAt": None,
    }]

    row = _aggregate(models, access, {"c1": "active"})[0]

    assert row["alive"] is False
    assert row["status"] == "denied"
    assert row["reason"] == "access"


def test_shape_filters_alive_and_vision() -> None:
    rows = [
        _row(model="a", alive=True, vision=True, canonical="a"),
        _row(model="b", alive=False, vision=True, canonical="b"),
        _row(model="c", alive=True, vision=False, canonical="c"),
    ]
    out = _shape(rows, ListModelHealthRequest(alive=True, vision=True))
    assert [r["model"] for r in out] == ["a"]


def test_shape_sort_latency_puts_unknown_last() -> None:
    rows = [
        _row(model="slow", latencyMs=900, canonical="slow"),
        _row(model="none", latencyMs=None, canonical="none"),
        _row(model="fast", latencyMs=50, canonical="fast"),
    ]
    out = _shape(rows, ListModelHealthRequest(sort="latency"))
    assert [r["model"] for r in out] == ["fast", "slow", "none"]


def test_shape_topk_limit_and_offset() -> None:
    rows = [_row(model=f"m{i}", canonical=f"m{i}") for i in range(5)]
    assert [r["model"] for r in _shape(rows, ListModelHealthRequest(topK=2))] == ["m0", "m1"]
    paged = _shape(rows, ListModelHealthRequest(limit=2, offset=3))
    assert [r["model"] for r in paged] == ["m3", "m4"]


def test_shape_projection_respects_fields() -> None:
    rows = [_row(model="a", canonical="a")]
    out = _shape(rows, ListModelHealthRequest(fields=["model", "reason"]))
    assert out == [{"model": "a", "reason": "ok"}]


def test_shape_changed_since_filters_old_rows() -> None:
    rows = [
        _row(model="new", canonical="new", lastVerifiedAt="2026-02-01T00:00:00+00:00"),
        _row(model="old", canonical="old", lastVerifiedAt="2026-01-01T00:00:00+00:00"),
        _row(model="never", canonical="never", lastVerifiedAt=None),
    ]
    out = _shape(rows, ListModelHealthRequest(changedSince="2026-01-15T00:00:00Z"))
    assert [r["model"] for r in out] == ["new"]


def test_shape_prefix_filter() -> None:
    rows = [_row(model="reformboss/a", canonical="a"), _row(model="velly/b", canonical="b")]
    out = _shape(rows, ListModelHealthRequest(prefix="reformboss/"))
    assert [r["model"] for r in out] == ["reformboss/a"]
