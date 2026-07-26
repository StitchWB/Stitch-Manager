from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from functools import lru_cache
from typing import Final


class Severity(IntEnum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2


class FindingCategory(StrEnum):
    IOC = "ioc"


@dataclass(frozen=True, slots=True)
class Finding:
    rule_id: str
    category: str
    severity: Severity
    match: str
    excerpt: str
    source: str
    description: str


@dataclass(frozen=True, slots=True)
class _Rule:
    rule_id: str
    category: str
    severity: Severity
    pattern: re.Pattern[str]
    description: str


@dataclass(frozen=True, slots=True)
class _BlockTerm:
    value: str
    kind: str


from stitch_backend.config import REPO_ROOT

_RULES_PATH: Final = REPO_ROOT / "_references" / "HoloNe" / "rules" / "rules.json"
_BLOCKLIST_PATH: Final = REPO_ROOT / "_references" / "HoloNe" / "rules" / "blocklist.json"


class HoloneInspector:
    """Stateless HoloNe-compatible rules and IOC detector."""

    def __init__(self, rules: tuple[_Rule, ...], terms: tuple[_BlockTerm, ...]) -> None:
        self._rules = rules
        self._terms = terms

    @property
    def rule_count(self) -> int:
        return len(self._rules)

    def inspect(self, text: str, *, source: str) -> list[Finding]:
        if not text:
            return []
        findings: list[Finding] = []
        seen: set[tuple[str, str]] = set()

        for rule in self._rules:
            match = rule.pattern.search(text)
            if match:
                self._add(
                    findings,
                    seen,
                    Finding(
                        rule_id=rule.rule_id,
                        category=rule.category,
                        severity=rule.severity,
                        match=_truncate(match.group(0), 160),
                        excerpt=_excerpt(text, match.start(), match.end()),
                        source=source,
                        description=rule.description,
                    ),
                )

        lowered = text.lower()
        for term in self._terms:
            index = lowered.find(term.value.lower())
            if index >= 0:
                self._add(
                    findings,
                    seen,
                    Finding(
                        rule_id=f"ioc-{term.kind}",
                        category=FindingCategory.IOC,
                        severity=Severity.HIGH,
                        match=term.value,
                        excerpt=_excerpt(text, index, index + len(term.value)),
                        source=source,
                        description=f"Known indicator of compromise ({term.kind})",
                    ),
                )
        return findings

    @staticmethod
    def _add(findings: list[Finding], seen: set[tuple[str, str]], finding: Finding) -> None:
        identity = (finding.rule_id, finding.match)
        if identity not in seen:
            seen.add(identity)
            findings.append(finding)


@lru_cache(maxsize=1)
def default_engine() -> HoloneInspector:
    rules_data = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
    blocklist_data = json.loads(_BLOCKLIST_PATH.read_text(encoding="utf-8"))
    rules = tuple(
        _Rule(
            rule_id=rule["id"],
            category=rule["category"],
            severity=_severity(rule["severity"]),
            pattern=re.compile(rule["pattern"]),
            description=rule["description"],
        )
        for rule in rules_data["rules"]
    )
    terms = tuple(
        _BlockTerm(value=value.strip(), kind=kind)
        for kind, field in (
            ("domain", "domains"),
            ("ip", "ips"),
            ("path", "paths"),
            ("task", "task_names"),
            ("process", "process_names"),
            ("hash", "hashes"),
        )
        for value in blocklist_data.get(field, [])
        if value.strip()
    )
    return HoloneInspector(rules, terms)


def _severity(value: str) -> Severity:
    match value.strip().lower():
        case "high":
            return Severity.HIGH
        case "medium":
            return Severity.MEDIUM
        case "low":
            return Severity.LOW
        case unreachable:
            raise ValueError(f"Unsupported HoloNe severity: {unreachable}")


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else f"{value[:limit]}…"


def _excerpt(text: str, start: int, end: int) -> str:
    return _truncate(" ".join(text[max(0, start - 48) : end + 48].split()), 200)
