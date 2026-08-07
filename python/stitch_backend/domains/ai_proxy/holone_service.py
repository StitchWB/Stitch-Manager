from __future__ import annotations

import logging
import math
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.ai_proxy.holone_inspector import Finding, Severity, default_engine
from stitch_backend.domains.ai_proxy.holone_stream import (
    ProtectionResult,
    SecurityMode,
    protect_anthropic_response,
    protect_anthropic_sse,
    protect_openai_response,
    protect_openai_sse,
)

logger = logging.getLogger(__name__)

# Invisible characters used for steganography
ZERO_WIDTH_CHARS = {
    '\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
    '\uFEFF', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
}


def _entropy(s: str) -> float:
    """Calculate Shannon entropy (bits per character).

    Base64: ~6 bits/char, hex: ~4 bits/char, plain text: ~3-4 bits/char
    """
    if not s or len(s) < 20:
        return 0.0
    counts = Counter(s)
    total = len(s)
    return -sum((c / total) * math.log2(c / total) for c in counts.values())


def _extract_file_path(args: str) -> str | None:
    """Extract file path from command arguments."""
    patterns = [
        r'>\s*([^\s]+)',              # shell redirect
        r'Out-File\s+([^\s]+)',       # PowerShell
        r'Set-Content\s+([^\s]+)',    # PowerShell
        r'writeFileSync\([^,]+,\s*["\']([^"\']+)["\']',  # Node.js
    ]
    for pattern in patterns:
        match = re.search(pattern, args, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _analyze_content(text: str, source: str) -> list[Finding]:
    """Analyze text for encoded/hidden content."""
    findings = []

    # 1. High entropy (encoded content)
    entropy = _entropy(text)
    if entropy > 4.5 and len(text) > 50:
        findings.append(Finding(
            rule_id="encoded-content",
            category="security",
            severity=Severity.HIGH,
            match=f"entropy={entropy:.2f}",
            excerpt=text[:100],
            source=source,
            description="High-entropy content detected (potential encoded instructions)"
        ))

    # 2. Invisible characters (steganography)
    invisible_count = sum(1 for c in text if c in ZERO_WIDTH_CHARS)
    if invisible_count > 5:
        findings.append(Finding(
            rule_id="invisible-characters",
            category="security",
            severity=Severity.HIGH,
            match=f"count={invisible_count}",
            excerpt="",
            source=source,
            description="Invisible characters detected (potential steganography)"
        ))

    # 3. Non-printable characters (control codes)
    non_printable = sum(
        1 for c in text
        if unicodedata.category(c).startswith('C')
    )
    if non_printable > 10:
        findings.append(Finding(
            rule_id="non-printable-characters",
            category="security",
            severity=Severity.MEDIUM,
            match=f"count={non_printable}",
            excerpt="",
            source=source,
            description="Non-printable characters detected"
        ))

    return findings


def _analyze_tool_call(name: str, args: str) -> list[Finding]:
    """Analyze tool call for suspicious behavior."""
    findings = []
    text = f"{name} {args}"

    # 1. Network access (any URL)
    if "://" in text or "Invoke-Web" in text.lower():
        findings.append(Finding(
            rule_id="network-access",
            category="security",
            severity=Severity.HIGH,
            match="://",
            excerpt=args[:100],
            source=f"tool_call:{name}",
            description="Network access detected in tool call"
        ))

    # 2. High entropy (encoded content in arguments)
    entropy = _entropy(args)
    if entropy > 4.5 and len(args) > 50:
        findings.append(Finding(
            rule_id="encoded-arguments",
            category="security",
            severity=Severity.HIGH,
            match=f"entropy={entropy:.2f}",
            excerpt=args[:100],
            source=f"tool_call:{name}",
            description="High-entropy arguments detected (potential encoded payload)"
        ))

    return findings


@dataclass
class HoloneConfig:
    enabled: bool = False
    mode: str = "monitor"  # "monitor" or "block"

    @property
    def security_mode(self) -> SecurityMode:
        return SecurityMode.BLOCK if self.mode == "block" else SecurityMode.MONITOR


@dataclass
class _FindingEntry:
    timestamp: float
    finding: Finding


@dataclass
class HoloneService:
    """Config-aware wrapper around HoloneInspector and stream protection."""

    config: HoloneConfig = field(default_factory=HoloneConfig)
    _findings: list[_FindingEntry] = field(default_factory=list)
    _max_findings: int = 100
    _session_file_writes: set[str] = field(default_factory=set)

    # ── Request inspection ─────────────────────────────────────────────────

    def inspect_request(self, messages: list[dict[str, Any]]) -> list[Finding]:
        """Inspect incoming message content for rule matches."""
        if not self.config.enabled:
            return []
        text = " ".join(
            msg.get("content", "")
            for msg in messages
            if isinstance(msg.get("content"), str)
        )
        findings = default_engine().inspect(text, source="request")
        if findings:
            self._record(findings)
        return findings

    # ── Response inspection (non-stream) ───────────────────────────────────

    def inspect_response_openai(
        self, response: dict[str, Any], *, client_has_tools: bool = False
    ) -> tuple[dict[str, Any], list[Finding], bool]:
        if not self.config.enabled:
            return response, [], False

        # Heuristic analysis first
        findings: list[Finding] = []
        for choice in response.get("choices", []):
            message = choice.get("message", {})

            # Analyze response content
            content = message.get("content", "")
            if isinstance(content, str):
                findings.extend(_analyze_content(content, source="response"))

            # Analyze tool calls
            tool_calls = message.get("tool_calls", [])
            for call in tool_calls:
                func = call.get("function", {})
                name = func.get("name", "")
                args = func.get("arguments", "")

                # Heuristic tool call analysis
                findings.extend(_analyze_tool_call(name, args))

                # File write tracking
                path = _extract_file_path(args)
                if path:
                    self._session_file_writes.add(path)

                # File write + execute chain detection
                for written_path in self._session_file_writes:
                    if written_path in f"{name} {args}":
                        execute_keywords = ["powershell", "bash", "sh", "python", "node", "ruby", "perl"]
                        if any(kw in f"{name} {args}".lower() for kw in execute_keywords):
                            findings.append(Finding(
                                rule_id="file-write-execute",
                                category="security",
                                severity=Severity.HIGH,
                                match=written_path,
                                excerpt=args[:100],
                                source=f"tool_call:{name}",
                                description=f"Executing previously written file: {written_path}"
                            ))

        # Existing rule-based protection
        result, findings_tuple, blocked = protect_openai_response(
            response, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        findings.extend(findings_tuple)

        if findings:
            self._record(findings)

        # Block if HIGH severity findings in block mode
        has_high = any(f.severity == Severity.HIGH for f in findings)
        if has_high and self.config.mode == "block":
            for choice in result.get("choices", []):
                message = choice.get("message", {})
                message.pop("tool_calls", None)
                message["content"] = "[HoloNe blocked suspicious content]"
            return result, findings, True

        return result, findings, blocked

    def inspect_response_anthropic(
        self, response: dict[str, Any], *, client_has_tools: bool = False
    ) -> tuple[dict[str, Any], list[Finding], bool]:
        if not self.config.enabled:
            return response, [], False

        # Heuristic analysis first
        findings: list[Finding] = []
        content_blocks = response.get("content", [])
        if isinstance(content_blocks, list):
            for block in content_blocks:
                if not isinstance(block, dict):
                    continue

                # Analyze text blocks
                if block.get("type") == "text":
                    text = block.get("text", "")
                    if isinstance(text, str):
                        findings.extend(_analyze_content(text, source="response"))

                # Analyze tool_use blocks
                elif block.get("type") == "tool_use":
                    name = block.get("name", "")
                    input_data = block.get("input", {})
                    args_str = str(input_data) if input_data else ""

                    # Heuristic tool call analysis
                    findings.extend(_analyze_tool_call(name, args_str))

                    # File write tracking
                    path = _extract_file_path(args_str)
                    if path:
                        self._session_file_writes.add(path)

                    # File write + execute chain detection
                    for written_path in self._session_file_writes:
                        if written_path in f"{name} {args_str}":
                            execute_keywords = ["powershell", "bash", "sh", "python", "node", "ruby", "perl"]
                            if any(kw in f"{name} {args_str}".lower() for kw in execute_keywords):
                                findings.append(Finding(
                                    rule_id="file-write-execute",
                                    category="security",
                                    severity=Severity.HIGH,
                                    match=written_path,
                                    excerpt=args_str[:100],
                                    source=f"tool_use:{name}",
                                    description=f"Executing previously written file: {written_path}"
                                ))

        # Existing rule-based protection
        result, findings_tuple, blocked = protect_anthropic_response(
            response, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        findings.extend(findings_tuple)

        if findings:
            self._record(findings)

        # Block if HIGH severity findings in block mode
        has_high = any(f.severity == Severity.HIGH for f in findings)
        if has_high and self.config.mode == "block":
            # Strip tool_use blocks
            new_content = [
                block for block in result.get("content", [])
                if not (isinstance(block, dict) and block.get("type") == "tool_use")
            ]
            new_content.append({
                "type": "text",
                "text": "[HoloNe blocked suspicious content]"
            })
            result["content"] = new_content
            if result.get("stop_reason") == "tool_use":
                result["stop_reason"] = "end_turn"
            return result, findings, True

        return result, findings, blocked

    # ── Stream inspection ──────────────────────────────────────────────────

    def inspect_stream_openai(
        self, body: str, *, client_has_tools: bool = False
    ) -> ProtectionResult:
        if not self.config.enabled:
            return ProtectionResult(body, (), False)
        result = protect_openai_sse(
            body, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        if result.findings:
            self._record(list(result.findings))
        return result

    def inspect_stream_anthropic(
        self, body: str, *, client_has_tools: bool = False
    ) -> ProtectionResult:
        if not self.config.enabled:
            return ProtectionResult(body, (), False)
        result = protect_anthropic_sse(
            body, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        if result.findings:
            self._record(list(result.findings))
        return result

    # ── Findings history ───────────────────────────────────────────────────

    def _record(self, findings: list[Finding]) -> None:
        now = time.time()
        for f in findings:
            self._findings.append(_FindingEntry(timestamp=now, finding=f))
        # Trim to max
        if len(self._findings) > self._max_findings:
            self._findings = self._findings[-self._max_findings :]
        event_bus.emit_sync("holone.findings_changed", {"findings": self.findings})

    @property
    def findings(self) -> list[dict[str, Any]]:
        """Return findings as serializable dicts."""
        return [
            {
                "timestamp": entry.timestamp,
                "rule_id": entry.finding.rule_id,
                "category": entry.finding.category,
                "severity": entry.finding.severity.name,
                "match": entry.finding.match,
                "excerpt": entry.finding.excerpt,
                "source": entry.finding.source,
                "description": entry.finding.description,
            }
            for entry in self._findings
        ]

    @property
    def rule_count(self) -> int:
        return default_engine().rule_count

    def reset_session(self) -> None:
        """Reset session state (call between conversations)."""
        self._session_file_writes.clear()


@lru_cache(maxsize=1)
def get_holone_service() -> HoloneService:
    return HoloneService()
