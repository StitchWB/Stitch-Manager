"""Activation service — exchange codes for HWID-bound tokens (plan §3.1 item 3).

The activation file (``.activation``) stores the client's credential:
``{token, pubkey, entitlements, server_url, last_server_time, degraded}``.
It is written with chmod 0600 (best-effort on POSIX).  The token is NEVER
logged.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import stat
import uuid
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING

import httpx

from .config import activation_file_path, server_url

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ActivationState:
    """Persisted activation state — the client's credential + sync metadata."""

    token: str
    pubkey: str
    entitlements: list[str] = field(default_factory=list)
    server_url: str = ""
    last_server_time: str = ""
    degraded: bool = False

    @classmethod
    def from_dict(cls, raw: Mapping[str, object]) -> ActivationState:
        raw_ents = raw.get("entitlements")
        entitlements = (
            [str(e) for e in raw_ents] if isinstance(raw_ents, list) else []
        )
        return cls(
            token=str(raw["token"]),
            pubkey=str(raw["pubkey"]),
            entitlements=entitlements,
            server_url=str(raw.get("server_url", "")),
            last_server_time=str(raw.get("last_server_time", "")),
            degraded=bool(raw.get("degraded", False)),
        )

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def derive_hwid() -> str:
    """Stable hardware id — sha256 of platform.node() + uuid.getnode()."""
    raw = f"{platform.node()}\0{uuid.getnode()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ActivationService:
    """Activate devices against the distribution server."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self._path = activation_file_path()

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def activate(self, activation_code: str, hwid: str) -> ActivationState:
        """Exchange a one-time activation code for a token bound to ``hwid``."""
        url = f"{server_url()}/activate"
        client = self._ensure_client()
        resp = await client.post(url, json={"activation_code": activation_code, "hwid": hwid})
        resp.raise_for_status()
        body = resp.json()
        state = ActivationState(
            token=body["token"],
            pubkey=body["pubkey"],
            entitlements=list(body.get("entitlements", [])),
            server_url=server_url(),
        )
        self._save(state)
        logger.info("Activation successful — pubkey=%s…", state.pubkey[:12])
        return state

    async def register_device(self, token: str, hwid: str) -> ActivationState:
        """Register an additional device for an existing token."""
        url = f"{server_url()}/activate"
        client = self._ensure_client()
        resp = await client.post(url, json={"token": token, "hwid": hwid})
        resp.raise_for_status()
        body = resp.json()
        state = ActivationState(
            token=body["token"],
            pubkey=body["pubkey"],
            entitlements=list(body.get("entitlements", [])),
            server_url=server_url(),
        )
        self._save(state)
        return state

    def load(self) -> ActivationState | None:
        """Load persisted state, or None if not activated / standalone."""
        if not self._path.is_file():
            return None
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return ActivationState.from_dict(raw)
        except (OSError, ValueError, KeyError) as exc:
            logger.warning("Failed to load activation state: %s", exc)
            return None

    def clear(self) -> None:
        """Remove the activation file (deactivate)."""
        if self._path.is_file():
            self._path.unlink()

    def set_degraded(self, degraded: bool) -> None:
        """Update the degraded flag in the persisted state."""
        state = self.load()
        if state is None:
            return
        state.degraded = degraded
        self._save(state)

    def set_last_server_time(self, server_time: str) -> None:
        """Update last_server_time for anti-replay (plan §3.2 item 6)."""
        state = self.load()
        if state is None:
            return
        state.last_server_time = server_time
        self._save(state)

    def _save(self, state: ActivationState) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(state.to_dict(), indent=2) + "\n",
            encoding="utf-8",
        )
        _restrict_permissions(self._path)


def _restrict_permissions(path: Path) -> None:
    """Best-effort chmod 0600 on POSIX; no-op on Windows."""
    if os.name == "posix":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
