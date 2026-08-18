"""CompressionService — unified facade for RTK + Caveman.

Pattern follows HoloneService (config + stats + singleton).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from .caveman import CompressionLevel, compress_messages, compress_text
from .rtk import apply_rtk_filter

logger = logging.getLogger(__name__)


@dataclass
class CompressionConfig:
    """Configuration for compression layer."""

    enabled: bool = False
    rtk_enabled: bool = True
    caveman_enabled: bool = True
    caveman_level: str = "full"  # "lite", "full", "ultra"
    input_compression_enabled: bool = True
    output_compression_enabled: bool = True
    preserve_system_prompt: bool = True
    auto_trigger_threshold: int = 500  # tokens

    @property
    def level(self) -> CompressionLevel:
        return CompressionLevel(self.caveman_level)


@dataclass
class _StatsEntry:
    timestamp: float
    request_tokens: int
    response_tokens: int
    saved_tokens: int


@dataclass
class CompressionService:
    """Stateful wrapper for RTK + Caveman compression."""

    config: CompressionConfig = field(default_factory=CompressionConfig)
    _stats: list[_StatsEntry] = field(default_factory=list)
    _max_stats: int = 100

    # ── Input compression (messages → compressed messages) ────────────────

    def compress_input(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Compress input messages using Caveman rules."""
        if not self.config.enabled or not self.config.caveman_enabled:
            return messages
        if not self.config.input_compression_enabled:
            return messages

        # Check threshold — skip compression for small prompts
        estimated_tokens = _estimate_tokens(messages)
        if estimated_tokens < self.config.auto_trigger_threshold:
            logger.debug(
                "Skipping compression: %d tokens < threshold %d",
                estimated_tokens, self.config.auto_trigger_threshold,
            )
            return messages

        # Preserve system messages if configured
        if self.config.preserve_system_prompt:
            system_msgs = [m for m in messages if m.get("role") == "system"]
            non_system_msgs = [m for m in messages if m.get("role") != "system"]
            compressed_non_system = compress_messages(non_system_msgs, level=self.config.level)
            compressed = system_msgs + compressed_non_system
        else:
            compressed = compress_messages(messages, level=self.config.level)

        original_tokens = _estimate_tokens(messages)
        compressed_tokens = _estimate_tokens(compressed)
        saved = original_tokens - compressed_tokens

        self._record_stats(request_tokens=saved, response_tokens=0, saved_tokens=saved)
        logger.info(
            "Caveman input: %d → %d tokens (saved %d)",
            original_tokens, compressed_tokens, saved,
        )
        return compressed

    # ── Output compression (response → compressed response) ───────────────

    def compress_output(self, response: dict[str, Any]) -> dict[str, Any]:
        """Compress output response using Caveman rules."""
        if not self.config.enabled or not self.config.caveman_enabled:
            return response
        if not self.config.output_compression_enabled:
            return response

        original_tokens = _estimate_tokens(response)
        compressed = _compress_response(response, level=self.config.level)
        compressed_tokens = _estimate_tokens(compressed)
        saved = original_tokens - compressed_tokens

        self._record_stats(request_tokens=0, response_tokens=saved, saved_tokens=saved)
        logger.info(
            "Caveman output: %d → %d tokens (saved %d)",
            original_tokens, compressed_tokens, saved,
        )
        return compressed

    # ── RTK stdout compression (command stdout → filtered stdout) ─────────

    def compress_stdout(self, command: str, stdout: str) -> str:
        """Compress stdout using RTK filters."""
        if not self.config.enabled or not self.config.rtk_enabled:
            return stdout

        original_tokens = len(stdout) // 4  # rough estimate
        filtered = apply_rtk_filter(command, stdout)
        filtered_tokens = len(filtered) // 4
        saved = original_tokens - filtered_tokens

        self._record_stats(request_tokens=saved, response_tokens=0, saved_tokens=saved)
        logger.info(
            "RTK %s: %d → %d tokens (saved %d)",
            command, original_tokens, filtered_tokens, saved,
        )
        return filtered

    # ── Stats history ─────────────────────────────────────────────────────

    def _record_stats(self, request_tokens: int, response_tokens: int, saved_tokens: int) -> None:
        now = time.time()
        self._stats.append(
            _StatsEntry(
                timestamp=now,
                request_tokens=request_tokens,
                response_tokens=response_tokens,
                saved_tokens=saved_tokens,
            )
        )
        if len(self._stats) > self._max_stats:
            self._stats = self._stats[-self._max_stats :]

    @property
    def stats(self) -> dict[str, Any]:
        """Return aggregated stats."""
        total_saved = sum(s.saved_tokens for s in self._stats)
        total_requests = sum(s.request_tokens for s in self._stats)
        total_responses = sum(s.response_tokens for s in self._stats)
        return {
            "requests": len(self._stats),
            "tokens_saved": total_saved,
            "input_tokens_saved": total_requests,
            "output_tokens_saved": total_responses,
            "avg_savings_pct": (
                total_saved / (total_requests + total_responses + total_saved) * 100
            )
            if (total_requests + total_responses + total_saved) > 0
            else 0,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _estimate_tokens(obj: Any) -> int:
    """Rough token estimate: bytes / 4."""
    import json
    try:
        text = json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(obj)
    return len(text.encode("utf-8")) // 4


def _compress_response(response: dict[str, Any], level: CompressionLevel) -> dict[str, Any]:
    """Compress response content (OpenAI/Anthropic format)."""
    result = dict(response)

    # OpenAI format: choices[].message.content
    choices = response.get("choices")
    if isinstance(choices, list):
        new_choices = []
        for choice in choices:
            new_choice = dict(choice)
            message = choice.get("message")
            if isinstance(message, dict):
                new_message = dict(message)
                content = message.get("content")
                if isinstance(content, str):
                    new_message["content"] = compress_text(content, level=level)
                new_choice["message"] = new_message
            new_choices.append(new_choice)
        result["choices"] = new_choices

    # Anthropic format: content[]
    content = response.get("content")
    if isinstance(content, list):
        new_content = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                new_block = dict(block)
                text = block.get("text")
                if isinstance(text, str):
                    new_block["text"] = compress_text(text, level=level)
                new_content.append(new_block)
            else:
                new_content.append(block)
        result["content"] = new_content

    return result


# ── Singleton ─────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_compression_service() -> CompressionService:
    return CompressionService()
