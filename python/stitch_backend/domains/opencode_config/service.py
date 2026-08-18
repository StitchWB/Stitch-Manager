"""OpenCode config service — read/write opencode.json and oh-my-openagent.json."""

from __future__ import annotations

import json
from pathlib import Path

import aiofiles


class OpenCodeConfigService:
    """Async read/write for OpenCode JSON config files."""

    def __init__(self, config_dir: Path | None = None) -> None:
        if config_dir is not None:
            self._config_dir = config_dir
        else:
            # OpenCode stores configs in ~/.config/opencode on all platforms
            self._config_dir = Path.home() / ".config" / "opencode"

    # ── opencode.json ────────────────────────────────────────────────

    async def read_opencode_config(self) -> dict:
        """Read ``opencode.json``. Returns ``{}`` if not found."""
        return await self._read_json("opencode.json")

    async def write_opencode_config(self, config: dict) -> None:
        """Write ``opencode.json`` with indent=2."""
        await self._write_json("opencode.json", config)

    # ── oh-my-openagent.json ─────────────────────────────────────────

    async def read_oh_my_openagent_config(self) -> dict:
        """Read ``oh-my-openagent.json``. Returns ``{}`` if not found."""
        return await self._read_json("oh-my-openagent.json")

    async def write_oh_my_openagent_config(self, config: dict) -> None:
        """Write ``oh-my-openagent.json`` with indent=2."""
        await self._write_json("oh-my-openagent.json", config)

    # ── internal helpers ─────────────────────────────────────────────

    async def _read_json(self, filename: str) -> dict:
        path = self._config_dir / filename
        try:
            async with aiofiles.open(path, encoding="utf-8") as f:
                raw = await f.read()
            return json.loads(raw)  # type: ignore[no-any-return]
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError:
            return {}

    async def _write_json(self, filename: str, config: dict) -> None:
        # ponytail: validate config is JSON-serializable via roundtrip
        raw = json.dumps(config, indent=2, ensure_ascii=False)
        json.loads(raw)  # raises ValueError/JSONDecodeError on corrupt data
        self._config_dir.mkdir(parents=True, exist_ok=True)
        path = self._config_dir / filename
        async with aiofiles.open(path, "w", encoding="utf-8") as f:
            await f.write(raw)
