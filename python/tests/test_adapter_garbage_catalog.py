"""Regression tests: HTTP 200 with a garbage body is a fetch FAILURE, not an
empty valid catalog.

Production evidence (rotation-76 analysis): a degraded upstream answering 200
with a non-JSON or otherwise unparseable body used to reconcile as "all models
gone", poisoning negative access-row evidence.  Empty parse on a non-empty
body must count as fetch failure so no negative reconciliation happens.
"""

from __future__ import annotations

import httpx
import pytest

from stitch_backend.domains.ai_gateway.adapters import configurable
from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter


def _mock_client(monkeypatch: pytest.MonkeyPatch, body: str, status: int = 200) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=body)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(configurable, "_shared_client", client)


async def test_garbage_200_body_counts_as_fetch_failure(monkeypatch) -> None:
    _mock_client(monkeypatch, "<html>Gateway error</html>")
    adapter = ConfigurableAdapter()

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is False
    assert result.http_status == 200
    assert not result.models


async def test_valid_json_without_model_entries_counts_as_failure(monkeypatch) -> None:
    _mock_client(monkeypatch, '{"unexpected": "shape"}')
    adapter = ConfigurableAdapter()

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is False
    assert result.http_status == 200


async def test_empty_data_list_counts_as_failure(monkeypatch) -> None:
    """A 200 with an empty catalog must not reconcile as 'all models gone'."""
    _mock_client(monkeypatch, '{"data": []}')
    adapter = ConfigurableAdapter()

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is False
    assert result.http_status == 200


async def test_empty_200_body_counts_as_failure(monkeypatch) -> None:
    _mock_client(monkeypatch, "")
    adapter = ConfigurableAdapter()

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is False
    assert result.http_status == 200


async def test_valid_catalog_still_succeeds(monkeypatch) -> None:
    _mock_client(monkeypatch, '{"data": [{"id": "m-1"}, {"id": "m-2"}]}')
    adapter = ConfigurableAdapter()

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is True
    assert result.models == ["m-1", "m-2"]


async def test_gemini_models_key_parsed(monkeypatch) -> None:
    """Gemini's /v1beta/models returns {"models": [{"name": "models/x"}]} — a
    wire shape the parser must read, else every gemini fetch is a false failure."""
    _mock_client(monkeypatch, '{"models": [{"name": "models/gemini-pro"}]}')
    adapter = ConfigurableAdapter(models_path="/v1beta/models", supports_chat=False)

    result = await adapter.probe_credential(base_url="https://x.test/v1", secret="sk")

    assert result.success is True
    assert result.models == ["gemini-pro"]
