from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field, replace
from functools import lru_cache
from typing import Any

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.ai_proxy.holone_inspector import (
    Finding,
    Severity,
    default_engine,
    redact_secrets,
)
from stitch_backend.domains.ai_proxy.holone_stream import (
    ProtectionResult,
    SecurityMode,
    protect_anthropic_response,
    protect_anthropic_sse,
    protect_openai_response,
    protect_openai_sse,
)

logger = logging.getLogger(__name__)


def _extract_file_path(args: str) -> str | None:
    """Extract file path from command arguments."""
    patterns = [
        r'"(?:path|file_path|filePath|filename|file|target|destination|outfile)"\s*:\s*"([^"]+)"',  # JSON tool args
        r'>>?\s*([^\s|]+)',                              # shell redirect
        r'(?:Out-File|Set-Content|Add-Content)\s+(?:-[\w]+\s+)*([^\s]+)',
        r'tee(?:-Object)?\s+(?:-[\w]+\s+)*([^\s]+)',
        r'writeFileSync\(\s*["\']([^"\']+)["\']',
        r'writeFile\(\s*["\']([^"\']+)["\']',
        r'open\(\s*["\']([^"\']+)["\']\s*,\s*["\'][wa]',
        r'(?:cp|copy|Copy-Item|mv|Move-Item)\s+(?:-[\w]+\s+)*[^\s|]+\s+([^\s|]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, args, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


_DOWNLOAD_TARGET_PATTERNS = [
    r'\bcurl\b[^\n|]*?(?-i:\s-O)\s+\S+/([^/\s"\']+)',  # curl -O: remote-name, track the basename
    r'\bcurl\b[^\n|]*?\s--remote-name\s+\S+/([^/\s"\']+)',
    r'\bcurl\b[^\n|]*?(?-i:\s-o)\s+(\S+)',  # curl -o <file>: explicit target
    r'\bwget\b[^\n|]*?(?-i:\s-O)\s+(\S+)',  # wget -O <file>
    r'\bwget\b[^\n|]*?--output-document=(\S+)',
    r'\binvoke-webrequest\b[^\n|]*?-outfile\s+(\S+)',
    r'\bstart-bitstransfer\b[^\n|]*?-destination\s+(\S+)',
    r'\burlretrieve\s*\([^)]*,\s*["\']([^"\']+)["\']',
]


def _extract_download_target(args: str) -> str | None:
    for pattern in _DOWNLOAD_TARGET_PATTERNS:
        match = re.search(pattern, args, re.IGNORECASE)
        if match:
            return match.group(1).strip("\"'")
    return None


_EXECUTE_HINTS = (
    "powershell", "pwsh", "bash", "sh", "python", "node", "ruby", "perl",
    "chmod", "start-process", "cmd", "./", "invoke-item", "ii ",
)

_AUTOEXEC_HINTS = (
    "startup", "tasks.json", "folderopen", "postcreatecommand", "poststartcommand",
    "postattachcommand", "devcontainer", "kernel.json", "launchagents", "launchdaemons",
    "autostart", "authorized_keys", "sitecustomize", "usercustomize", "crontab",
    ".bashrc", ".zshrc", ".zprofile", ".profile", "/hooks/", "core.hookspath",
)


def _content_parts(content: Any) -> list[str]:
    """Text fragments from string / multipart / Anthropic-block content shapes."""
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    parts: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        part_type = part.get("type")
        if part_type in ("text", "output_text"):
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)
        elif part_type == "tool_result":
            parts.extend(_content_parts(part.get("content")))
    return parts


def _request_text(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        parts.extend(_content_parts(msg.get("content")))
        if msg.get("role") == "assistant":
            calls = msg.get("tool_calls")
            if isinstance(calls, list):
                for call in calls:
                    function = call.get("function") if isinstance(call, dict) else None
                    if not isinstance(function, dict):
                        continue
                    name = function.get("name", "")
                    arguments = function.get("arguments")
                    if isinstance(arguments, str):
                        parts.append(f"{name}\n{arguments}")
    return "\n".join(parts)


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


def _sanitize(f: Finding) -> Finding:
    return replace(f, match=redact_secrets(f.match), excerpt=redact_secrets(f.excerpt))


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
        if not any(
            isinstance(msg, dict) and msg.get("role") in ("assistant", "tool")
            for msg in messages
        ):
            self._session_file_writes.clear()
        findings = default_engine().inspect(_request_text(messages), source="request")
        if findings:
            self._record(findings)
        return findings

    # ── Response inspection (non-stream) ───────────────────────────────────

    def inspect_response_openai(
        self, response: dict[str, Any], *, client_has_tools: bool = False
    ) -> tuple[dict[str, Any], list[Finding], bool]:
        if not self.config.enabled:
            return response, [], False

        chain_findings: list[Finding] = []
        for choice in response.get("choices", []):
            message = choice.get("message", {})
            tool_calls = message.get("tool_calls", [])
            for call in tool_calls:
                func = call.get("function", {})
                name = func.get("name", "")
                args = func.get("arguments", "")
                self._track_file_write(name, args, chain_findings, source_prefix="tool_call")

        result, findings_tuple, blocked = protect_openai_response(
            response, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        findings = chain_findings + list(findings_tuple)
        if findings:
            self._record(findings)

        has_high = any(f.severity == Severity.HIGH for f in findings)
        if has_high and self.config.mode == "block" and not blocked:
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

        chain_findings: list[Finding] = []
        content_blocks = response.get("content", [])
        if isinstance(content_blocks, list):
            for block in content_blocks:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name = block.get("name", "")
                input_data = block.get("input", {})
                args_str = str(input_data) if input_data else ""
                self._track_file_write(name, args_str, chain_findings, source_prefix="tool_use")

        result, findings_tuple, blocked = protect_anthropic_response(
            response, mode=self.config.security_mode, client_has_tools=client_has_tools
        )
        findings = chain_findings + list(findings_tuple)
        if findings:
            self._record(findings)

        has_high = any(f.severity == Severity.HIGH for f in findings)
        if has_high and self.config.mode == "block" and not blocked:
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

    def inspect_response_responses(
        self, response: dict[str, Any], *, client_has_tools: bool = False
    ) -> tuple[dict[str, Any], list[Finding], bool]:
        """Inspect an OpenAI Responses API payload (output[] items)."""
        if not self.config.enabled:
            return response, [], False

        findings: list[Finding] = []
        output = response.get("output")
        if not isinstance(output, list):
            return response, [], False

        saw_tool = False
        for item in output:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "message":
                for part in item.get("content") or []:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") == "output_text":
                        text = part.get("text")
                        if isinstance(text, str):
                            findings.extend(default_engine().inspect(text, source="text"))
            elif item_type == "function_call":
                saw_tool = True
                name = item.get("name", "")
                arguments = item.get("arguments", "")
                if isinstance(arguments, str):
                    findings.extend(
                        default_engine().inspect(
                            f"{name}\n{arguments}",
                            source=f"function_call:{name}",
                        )
                    )
                    self._track_file_write(name, arguments, findings, source_prefix="function_call")

        if saw_tool and not client_has_tools:
            findings.append(Finding(
                rule_id="proto-tooluse-unsolicited",
                category="protocol",
                severity=Severity.HIGH,
                match="tool call without advertised tools",
                excerpt="tool call without advertised tools",
                source="function_call",
                description="Provider returned a tool call although the client advertised no tools",
            ))

        if findings:
            self._record(findings)

        has_high = any(f.severity == Severity.HIGH for f in findings)
        if has_high and self.config.mode == "block":
            new_output = [
                item for item in output
                if not (isinstance(item, dict) and item.get("type") == "function_call")
            ]
            new_output.append({
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "[HoloNe blocked suspicious content]"}],
            })
            response["output"] = new_output
            return response, findings, True

        return response, findings, False

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

    # ── File-write → execute chain tracking ────────────────────────────────

    def _track_file_write(
        self, name: str, args: str, findings: list[Finding], *, source_prefix: str
    ) -> None:
        path = _extract_file_path(args)
        if path:
            self._session_file_writes.add(path)
        download = _extract_download_target(args)
        if download:
            self._session_file_writes.add(download)

        text = f"{name} {args}"
        lowered = text.lower()
        for written_path in self._session_file_writes:
            if written_path not in text:
                continue
            if any(kw in lowered for kw in _EXECUTE_HINTS):
                findings.append(Finding(
                    rule_id="file-write-execute",
                    category="security",
                    severity=Severity.HIGH,
                    match=written_path,
                    excerpt=args[:100],
                    source=f"{source_prefix}:{name}",
                    description=f"Executing previously written or downloaded file: {written_path}"
                ))
            elif any(hint in lowered for hint in _AUTOEXEC_HINTS):
                findings.append(Finding(
                    rule_id="file-write-autoexec-ref",
                    category="security",
                    severity=Severity.HIGH,
                    match=written_path,
                    excerpt=args[:100],
                    source=f"{source_prefix}:{name}",
                    description=f"Previously written file referenced from an auto-exec surface: {written_path}"
                ))

    # ── Findings history ───────────────────────────────────────────────────

    def _record(self, findings: list[Finding]) -> None:
        now = time.time()
        for f in findings:
            self._findings.append(_FindingEntry(timestamp=now, finding=_sanitize(f)))
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
    """Process-wide HoloNe service singleton.

    Config and findings live here; a fresh instance per call would drop
    every config write (the old bug: toggle never stuck).  Persisted via
    settings keys holone_enabled/holone_mode (restored at startup).
    """
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = HoloneService()
    return _SERVICE


_SERVICE: HoloneService | None = None
