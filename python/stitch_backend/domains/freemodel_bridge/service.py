"""Freemodel Bridge service — manages the bridge Python subprocess.

Ported from Rust ``freemodel_bridge.rs`` and ``services/freemodel_bridge/``.
The bridge is a Python script that proxies AI model requests.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import TYPE_CHECKING, Any

import httpx

from stitch_backend.config import REPO_ROOT

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

# Singleton process state
_process: asyncio.subprocess.Process | None = None
_config: dict[str, Any] = {"port": 0, "api_key": "", "enabled": False}
_start_time: float | None = None
_error: str | None = None


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


async def _wait_for_ready(port: int, timeout: float = 15.0) -> bool:
    """Poll the bridge health endpoint until it responds or timeout."""
    url = f"http://127.0.0.1:{port}/v1/models"
    deadline = time.time() + timeout
    async with httpx.AsyncClient(timeout=2) as client:
        while time.time() < deadline:
            # Check if process died
            if _process is not None and _process.returncode is not None:
                return False
            try:
                resp = await client.get(url)
                if resp.status_code < 500:
                    return True
            except (httpx.ConnectError, httpx.TimeoutException, OSError):
                pass
            await asyncio.sleep(0.5)
    return False


class FreemodelBridgeService:
    """Manages the FreeModel bridge subprocess lifecycle."""

    @staticmethod
    async def start(settings: dict[str, Any]) -> dict[str, Any]:
        """Start the bridge subprocess."""
        global _process, _config, _start_time, _error

        # Stop existing process if running (prevents orphan processes)
        if _process is not None and _process.returncode is None:
            await FreemodelBridgeService.stop()
            await asyncio.sleep(0.5)

        port = int(settings.get("port", 8320))
        api_key = (settings.get("apiKey") or settings.get("api_key") or "").strip()

        script = _resolve_bridge_script()
        if not script:
            _error = "Bridge script not found"
            return FreemodelBridgeService.status()

        _config = {"port": port, "api_key": api_key, "enabled": True}

        try:
            env = {
                "FREEMODEL_PORT": str(port),
                "FREEMODEL_API_KEY": api_key,
                "FREEMODEL_HOST": "127.0.0.1",
            }
            _process = await asyncio.create_subprocess_exec(
                "python", str(script),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env={**os.environ, **env},
            )
            _start_time = time.time()
            _error = None
            logger.info("[FreeBridge] Started on port %d (pid=%d)", port, _process.pid)

            # Wait for the bridge to become ready (health-check gate)
            ready = await _wait_for_ready(port, timeout=15.0)
            if not ready:
                logger.warning("[FreeBridge] Process started but not ready within 15s")
        except Exception as exc:
            _error = str(exc)
            logger.error("[FreeBridge] Failed to start: %s", exc)

        return FreemodelBridgeService.status()

    @staticmethod
    async def stop() -> dict[str, Any]:
        """Stop the bridge subprocess."""
        global _process, _start_time, _error

        if _process and _process.returncode is None:
            _process.terminate()
            try:
                await asyncio.wait_for(_process.wait(), timeout=5)
            except TimeoutError:
                _process.kill()
            logger.info("[FreeBridge] Stopped (pid=%d)", _process.pid)

        _process = None
        _start_time = None
        _config["enabled"] = False
        return FreemodelBridgeService.status()

    @staticmethod
    def status() -> dict[str, Any]:
        """Return current bridge status."""
        if _error and not _process:
            return {
                "status": "error", "port": None, "pid": None,
                "uptimeSeconds": None, "error": _error,
            }
        if _process is None:
            return {
                "status": "stopped", "port": None, "pid": None,
                "uptimeSeconds": None, "error": None,
            }
        if _process.returncode is not None:
            rc = _process.returncode
            # SIGTERM (-15) is a normal stop; anything else is an error
            if rc != 0 and rc != -15:
                return {
                    "status": "error", "port": None, "pid": None,
                    "uptimeSeconds": None,
                    "error": f"Bridge process exited with code {rc}",
                }
            return {
                "status": "stopped", "port": None, "pid": None,
                "uptimeSeconds": None, "error": None,
            }
        uptime = int(time.time() - _start_time) if _start_time else 0
        return {
            "status": "running",
            "port": _config.get("port"),
            "pid": _process.pid,
            "uptimeSeconds": uptime,
            "error": None,
        }

    @staticmethod
    async def update_settings(settings: dict[str, Any]) -> dict[str, Any]:
        """Update bridge settings; restart if running."""
        is_running = _process is not None and _process.returncode is None
        if is_running:
            await FreemodelBridgeService.stop()
        return await FreemodelBridgeService.start(settings)

    @staticmethod
    async def test_connection(model: str | None = None) -> dict[str, Any]:
        """Test bridge with a simple chat completion request."""
        port = _config.get("port", 0)
        api_key = _config.get("api_key", "")

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
