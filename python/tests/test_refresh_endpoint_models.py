"""Tests for the refresh (persist) helpers and request schema."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from stitch_backend.domains.ai_gateway.commands.probe_models import (
    _access_status,
    _capabilities,
)
from stitch_backend.domains.ai_gateway.schemas.probe_models import (
    RefreshEndpointModelsRequest,
)


def test_access_status_mapping() -> None:
    assert _access_status("ok") == "available"
    assert _access_status("model_not_found") == "denied"
    assert _access_status("model_access_denied") == "denied"
    assert _access_status("rate_limited") == "temporarily_unavailable"
    assert _access_status("quota_exhausted") == "temporarily_unavailable"
    assert _access_status("transport_error") == "temporarily_unavailable"
    assert _access_status("budget_exhausted") == "temporarily_unavailable"


def test_capabilities_records_vision_only_when_known() -> None:
    now = "2026-01-01T00:00:00+00:00"

    seen = _capabilities({"multimodalOk": True}, now)
    assert seen["supports_vision"] is True
    assert seen["source"] == "probe"
    assert seen["verified_at"] == now

    blind = _capabilities({"multimodalOk": False}, now)
    assert blind["supports_vision"] is False

    unknown = _capabilities({"multimodalOk": None}, now)
    assert "supports_vision" not in unknown


def test_capabilities_records_latency_only_for_ok_rows() -> None:
    now = "2026-01-01T00:00:00+00:00"
    assert _capabilities({"ok": True, "latencyMs": 42}, now)["probe_latency_ms"] == 42
    assert "probe_latency_ms" not in _capabilities({"ok": False, "latencyMs": 42}, now)
    assert "probe_latency_ms" not in _capabilities({"ok": True, "latencyMs": None}, now)


def test_refresh_request_inherits_probe_fields() -> None:
    req = RefreshEndpointModelsRequest(credentialId="cred-1", visionModels=["m1"])
    assert req.credential_id == "cred-1"
    assert req.vision_models == ["m1"]


def test_refresh_request_requires_target() -> None:
    with pytest.raises(ValidationError):
        RefreshEndpointModelsRequest()
