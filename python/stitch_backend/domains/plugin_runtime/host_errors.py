"""Plugin-host exceptions — public error surface of ServicePluginHost."""

from __future__ import annotations


class PluginCallTimeout(Exception):
    """Plugin command timed out (504-friendly)."""

    def __init__(self, plugin_id: str, command: str, timeout: float) -> None:
        self.plugin_id = plugin_id
        self.command = command
        self.timeout = timeout
        super().__init__(
            f"plugin {plugin_id} command {command!r} timed out after {timeout}s"
        )


class PluginNotRunning(Exception):
    """Plugin host is not running (crashed, not started, or stopping)."""

    def __init__(self, plugin_id: str) -> None:
        self.plugin_id = plugin_id
        super().__init__(f"plugin {plugin_id} is not running")
