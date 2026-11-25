"""Tests for the generic plugin-bridge gateway contract — pure logic."""

from __future__ import annotations

import pytest

from stitch_backend.domains.ai_gateway.plugin_bridge import (
    PluginBridgeSpec,
    endpoint_id,
    validate_bundle,
)

SPEC = PluginBridgeSpec(plugin_id="stitch-ramp", vendor="ramp", name="Ramp")


def _bundle(**over):
    bundle = {
        "running": True,
        "provider": {
            "ramp-chat": {
                "options": {"baseURL": "http://127.0.0.1:41234/chat/v1", "apiKey": "k"},
                "models": {"ask-ramp": {"limit": {"context": 200000, "output": 8192}}},
            }
        },
        "runtime": [],
    }
    bundle.update(over)
    return bundle


def test_endpoint_id_stable_and_scoped() -> None:
    a = endpoint_id(SPEC, "chat")
    assert a == endpoint_id(SPEC, "chat")
    assert a != endpoint_id(SPEC, "messages")
    other = PluginBridgeSpec(plugin_id="stitch-quickwork", vendor="quickwork", name="QuickWork")
    assert a != endpoint_id(other, "chat")


def test_validate_bundle_ok() -> None:
    providers = validate_bundle(_bundle(), SPEC)
    assert "chat" in providers


def test_validate_bundle_rejects_non_loopback() -> None:
    bad = _bundle()
    bad["provider"]["ramp-chat"]["options"]["baseURL"] = "https://evil.example.com/chat/v1"
    with pytest.raises(ValueError, match="loopback"):
        validate_bundle(bad, SPEC)


def test_validate_bundle_rejects_wrong_path() -> None:
    bad = _bundle()
    bad["provider"]["ramp-chat"]["options"]["baseURL"] = "http://127.0.0.1:9/v1"
    with pytest.raises(ValueError):
        validate_bundle(bad, SPEC)


def test_validate_bundle_rejects_unknown_protocol_key() -> None:
    bad = _bundle()
    bad["provider"]["ramp-ftp"] = bad["provider"].pop("ramp-chat")
    with pytest.raises(ValueError):
        validate_bundle(bad, SPEC)


def test_validate_bundle_requires_key_and_cards() -> None:
    bad = _bundle()
    bad["provider"]["ramp-chat"]["options"]["apiKey"] = ""
    with pytest.raises(ValueError):
        validate_bundle(bad, SPEC)
    bad = _bundle()
    bad["provider"]["ramp-chat"]["models"]["ask-ramp"]["limit"]["output"] = 0
    with pytest.raises(ValueError):
        validate_bundle(bad, SPEC)
