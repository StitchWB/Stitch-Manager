from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import re


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
    # None = unconditional (pattern has no extractable required literal)
    gate: tuple[tuple[tuple[frozenset[str], bool, int | None, int | None], ...], tuple[int, ...]] | None
    gate_ci: bool
    max_span: int | None  # None = unbounded match length


@dataclass(frozen=True, slots=True)
class _BlockTerm:
    value: str
    kind: str
    pattern: re.Pattern[str] | None
