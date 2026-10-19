"""Caveman — rule-based token compression (telegraphic style).

Ported from JuliusBrussee/caveman. Implements compression rules as regex passes
with intensity levels (lite/full/ultra).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any


class CompressionLevel(Enum):
    """Compression intensity levels."""

    LITE = "lite"  # No filler/hedging. Keep articles + full sentences
    FULL = "full"  # Drop articles, fragments OK, short synonyms
    ULTRA = "ultra"  # Abbreviate, strip conjunctions, arrows for causality


@dataclass
class CavemanCompressor:
    """Rule-based token compressor (ported from caveman SKILL.md)."""

    level: CompressionLevel = CompressionLevel.FULL

    # ── Protected regions (extract before compression, restore after) ──────

    _CODE_BLOCK = re.compile(r"```[\s\S]*?```", re.MULTILINE)
    _INLINE_CODE = re.compile(r"`[^`]+`")
    _URL = re.compile(r"https?://[^\s)]+")
    _FILE_PATH = re.compile(r"(?:[a-zA-Z]:)?(?:/[^\s/]+)+")

    # ── Removal rules ─────────────────────────────────────────────────────

    # Filler words (all levels)
    _FILLER = re.compile(
        r"\b(just|really|basically|actually|simply|essentially|generally|"
        r"literally|kind of|sort of)\b\s*",
        re.IGNORECASE,
    )

    # Pleasantries (all levels)
    _PLEASANTRIES = re.compile(
        r"\b(sure|certainly|of course|happy to|I'd be happy to|"
        r"I would recommend|I'd recommend)\b[,.]?\s*",
        re.IGNORECASE,
    )

    # Hedging phrases (all levels)
    _HEDGING = re.compile(
        r"\b(it might be worth|you could consider|it would be good to|"
        r"it may be helpful to|you might want to)\b\s*",
        re.IGNORECASE,
    )

    # Articles (full + ultra only)
    _ARTICLES = re.compile(r"\b(a|an|the)\b\s*", re.IGNORECASE)

    # Connectives (full + ultra)
    _CONNECTIVES = re.compile(
        r"\b(however|furthermore|additionally|in addition|moreover)\b[,.]?\s*",
        re.IGNORECASE,
    )

    # ── Substitution rules ────────────────────────────────────────────────

    _REDUNDANT = [
        (re.compile(r"\bin order to\b", re.IGNORECASE), "to"),
        (re.compile(r"\bmake sure to\b", re.IGNORECASE), "ensure"),
        (re.compile(r"\bthe reason is because\b", re.IGNORECASE), "because"),
        (re.compile(r"\bdue to the fact that\b", re.IGNORECASE), "because"),
        (re.compile(r"\bat this point in time\b", re.IGNORECASE), "now"),
        (re.compile(r"\ba large number of\b", re.IGNORECASE), "many"),
    ]

    _SYNONYMS = [
        (re.compile(r"\bextensive\b", re.IGNORECASE), "big"),
        (re.compile(r"\butilize\b", re.IGNORECASE), "use"),
        (re.compile(r"\bimplement a solution for\b", re.IGNORECASE), "fix"),
        (re.compile(r"\bfacilitate\b", re.IGNORECASE), "help"),
        (re.compile(r"\bcommence\b", re.IGNORECASE), "start"),
        (re.compile(r"\bterminate\b", re.IGNORECASE), "end"),
        (re.compile(r"\bendeavor\b", re.IGNORECASE), "try"),
    ]

    # Ultra abbreviations (ultra only)
    _ULTRA_ABBREV = [
        (re.compile(r"\bdatabase\b", re.IGNORECASE), "DB"),
        (re.compile(r"\bauthentication\b", re.IGNORECASE), "auth"),
        (re.compile(r"\bconfiguration\b", re.IGNORECASE), "config"),
        (re.compile(r"\brequest\b", re.IGNORECASE), "req"),
        (re.compile(r"\bresponse\b", re.IGNORECASE), "res"),
        (re.compile(r"\bfunction\b", re.IGNORECASE), "fn"),
        (re.compile(r"\bimplementation\b", re.IGNORECASE), "impl"),
        (re.compile(r"\bconnection\b", re.IGNORECASE), "conn"),
    ]

    # Imperative prefixes to drop (all levels)
    _IMPERATIVE = re.compile(
        r"\b(you should|make sure to|remember to|don't forget to)\b\s*",
        re.IGNORECASE,
    )

    def compress(self, text: str) -> str:
        """Compress text using caveman rules. Preserves code/URLs/paths."""
        if not text or not text.strip():
            return text

        # 1. Extract protected regions
        protected = self._extract_protected(text)
        body = protected["body"]

        # 2. Apply removal passes
        body = self._FILLER.sub("", body)
        body = self._PLEASANTRIES.sub("", body)
        body = self._HEDGING.sub("", body)
        body = self._IMPERATIVE.sub("", body)

        if self.level in (CompressionLevel.FULL, CompressionLevel.ULTRA):
            body = self._ARTICLES.sub("", body)
            body = self._CONNECTIVES.sub("", body)

        # 3. Apply substitutions
        for pattern, replacement in self._REDUNDANT:
            body = pattern.sub(replacement, body)
        for pattern, replacement in self._SYNONYMS:
            body = pattern.sub(replacement, body)

        if self.level == CompressionLevel.ULTRA:
            for pattern, replacement in self._ULTRA_ABBREV:
                body = pattern.sub(replacement, body)

        # 4. Clean up whitespace
        body = re.sub(r"\s+", " ", body).strip()
        body = re.sub(r"\s+([.,;:!?])", r"\1", body)  # space before punctuation
        body = re.sub(r"([.,;:!?])\s*([.,;:!?])", r"\1\2", body)  # double punctuation

        # 5. Restore protected regions
        return self._restore_protected(body, protected)

    def _extract_protected(self, text: str) -> dict:
        """Extract code blocks, inline code, URLs, paths. Replace with placeholders."""
        placeholders: dict[str, str] = {}
        counter = 0

        def _replace(match: re.Match) -> str:
            nonlocal counter
            key = f"__PROTECTED_{counter}__"
            placeholders[key] = match.group(0)
            counter += 1
            return key

        body = text
        body = self._CODE_BLOCK.sub(_replace, body)
        body = self._INLINE_CODE.sub(_replace, body)
        body = self._URL.sub(_replace, body)
        body = self._FILE_PATH.sub(_replace, body)

        return {"body": body, "placeholders": placeholders}

    def _restore_protected(self, body: str, protected: dict) -> str:
        """Restore protected regions from placeholders."""
        for key, value in protected["placeholders"].items():
            body = body.replace(key, value)
        return body


# ── Public API ────────────────────────────────────────────────────────────────

_default_compressor = CavemanCompressor(level=CompressionLevel.FULL)


def compress_text(text: str, level: CompressionLevel = CompressionLevel.FULL) -> str:
    """Compress text using caveman rules."""
    compressor = CavemanCompressor(level=level)
    return compressor.compress(text)


def compress_messages(
    messages: list[dict[str, Any]], level: CompressionLevel = CompressionLevel.FULL
) -> list[dict[str, Any]]:
    """Compress message content (for LLM input)."""
    compressor = CavemanCompressor(level=level)
    result = []
    for msg in messages:
        new_msg = dict(msg)
        content = msg.get("content")
        if isinstance(content, str):
            new_msg["content"] = compressor.compress(content)
        elif isinstance(content, list):
            # Multimodal content — compress text parts only
            new_content = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    new_item = dict(item)
                    new_item["text"] = compressor.compress(item.get("text", ""))
                    new_content.append(new_item)
                else:
                    new_content.append(item)
            new_msg["content"] = new_content
        result.append(new_msg)
    return result
