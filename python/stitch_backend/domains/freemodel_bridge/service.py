"""Freemodel Bridge service — manages the bridge sidecar subprocess.

Thin domain wrapper over the :class:`SidecarSupervisor`. Keeps the domain
logic (locating the bridge script, domain operations like ``test_connection``
and ``update_settings``); the subprocess lifecycle itself lives in the
supervisor.

The FreeModel bridge is a *sidecar* (a local helper process) that ALSO backs
an AI inference provider (FreeModel). The AI-provider side lives in
``ai_proxy``; only the process lifecycle lives here.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from stitch_backend.config import REPO_ROOT
from stitch_backend.domains.sidecar import LaunchPlan, SidecarSpec, get_supervisor

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

SIDECAR_NAME = "freemodel_bridge"
DEFAULT_PORT = 8320


def _resolve_bridge_script() -> Path | None:
    """Find the bridge script path."""
    candidates = [
        REPO_ROOT / "python" / "freemodel_bridge" / "bridge.py",
        REPO_ROOT / "freemodel_bridge" / "bridge.py",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _prepare(settings: dict | None) -> LaunchPlan:
    settings = settings or {}
    script = _resolve_bridge_script()
    if script is None:
        raise RuntimeError("Bridge script not found")
    port = int(settings.get("port", DEFAULT_PORT))
    api_key = (settings.get("apiKey") or settings.get("api_key") or "").strip()
    return LaunchPlan(
        command=["python", str(script)],
        env={
            "FREEMODEL_PORT": str(port),
            "FREEMODEL_API_KEY": api_key,
            "FREEMODEL_HOST": "127.0.0.1",
        },
        port=port,
        health_url=f"http://127.0.0.1:{port}/v1/models",
        health_ok=lambda code: code < 500,
        readiness_timeout=15.0,
        config={"port": port, "api_key": api_key, "enabled": True},
    )


def register_sidecar() -> None:
    """Register the freemodel bridge spec with the supervisor (idempotent)."""
    sup = get_supervisor()
    if not sup.is_registered(SIDECAR_NAME):
        sup.register(
            SidecarSpec(
                name=SIDECAR_NAME,
                display_name="FreeModel Bridge",
                prepare=_prepare,
            )
        )


class FreemodelBridgeService:
    """Backward-compatible facade over the :class:`SidecarSupervisor`."""

    @staticmethod
    async def start(settings: dict[str, Any] | None = None) -> dict[str, Any]:
        register_sidecar()
        # Legacy behaviour: starting while running restarts (force=True).
        return await get_supervisor().start(SIDECAR_NAME, settings, force=True)

    @staticmethod
    async def stop() -> dict[str, Any]:
        register_sidecar()
        return await get_supervisor().stop(SIDECAR_NAME)

    @staticmethod
    def status() -> dict[str, Any]:
        register_sidecar()
        return get_supervisor().status(SIDECAR_NAME)

    @staticmethod
    async def update_settings(settings: dict[str, Any]) -> dict[str, Any]:
        """Update bridge settings; restart if running."""
        register_sidecar()
        sup = get_supervisor()
        if sup.is_running(SIDECAR_NAME):
            await sup.stop(SIDECAR_NAME)
        return await sup.start(SIDECAR_NAME, settings, force=True)

    @staticmethod
    async def test_connection(model: str | None = None) -> dict[str, Any]:
        """Test bridge with a simple chat completion request."""
        register_sidecar()
        sup = get_supervisor()
        config = sup.get_config(SIDECAR_NAME)
        port = config.get("port") or sup.status(SIDECAR_NAME).get("port") or 0
        api_key = config.get("api_key", "")

        if not port:
            raise RuntimeError("Bridge is not configured")

        test_model = model or "claude-sonnet-4-6"
        url = f"http://127.0.0.1:{port}/v1/chat/completions"
        body = {
            "model": test_model,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Say 'Bridge is working!' and nothing else."},
            ],
            "max_tokens": 50,
        }
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Request failed with status {resp.status_code}: {resp.text}"
                )
            data = resp.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "No content")
            )
            return {
                "success": True,
                "model": test_model,
                "response": content,
                "raw": data,
            }
