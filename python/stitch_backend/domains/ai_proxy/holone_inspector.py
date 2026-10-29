from __future__ import annotations

import base64
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Final

from stitch_backend.domains.ai_proxy.holone_gates import (
    _ci_haystack,
    _extract_gate,
    _gate_hits,
    _make_presence,
    _re_parser,
    _token_max_span,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    _B64_CANDIDATE_RE,
    _DECODE_BUDGET_CHARS,
    _DECODED_CREDENTIAL_RE,
    _FOLDABLE_RE,
    _HEX_CANDIDATE_RE,
    _MAGIC_BYTES,
    _MAX_DECODE_DEPTH,
    _PRINTABLE_RATIO,
    _VARIANT_MIN_LEN,
    _WHITESPACE_RE,
    _normalize_preserve_case,
    decode_escapes,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    ZERO_WIDTH_CHARS as ZERO_WIDTH_CHARS,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    analyze_content as analyze_content,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    analyze_tool_call as analyze_tool_call,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    entropy as entropy,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    normalize_unicode as normalize_unicode,
)
from stitch_backend.domains.ai_proxy.holone_text import (
    redact_secrets as redact_secrets,
)
from stitch_backend.domains.ai_proxy.holone_types import (
    Finding,
    FindingCategory,
    Severity,
    _BlockTerm,
    _Rule,
)

_RULES_DIR: Final = Path(__file__).resolve().parent / "holone_rules"
_RULES_PATH: Final = _RULES_DIR / "rules.json"
_RULES_ATR_PATH: Final = _RULES_DIR / "rules_atr.json"
_RULES_ATR_EXTENDED_PATH: Final = _RULES_DIR / "rules_atr_extended.json"
_RULES_EXTENDED_PATH: Final = _RULES_DIR / "rules_extended.json"
_BLOCKLIST_PATH: Final = _RULES_DIR / "blocklist.json"


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
        self._scan(text, source, findings, seen)
        if len(text) > _VARIANT_MIN_LEN:
            if "\\" in text:
                decoded = decode_escapes(text)
                if decoded != text:
                    self._scan(decoded, f"{source}:decoded", findings, seen)
            if text.isascii():
                # ASCII: NFKC/homoglyph maps are identity; casefold = plain lower.
                casefolded = text.casefold()
                if casefolded != text:
                    self._scan(
                        casefolded,
                        f"{source}:normalized",
                        findings,
                        seen,
                        cs_only=True,
                    )
            else:
                normalized = _normalize_preserve_case(text)
                casefolded = normalized.casefold()
                if normalized != text:
                    self._scan(normalized, f"{source}:normalized", findings, seen)
                if casefolded != text and casefolded != normalized:
                    self._scan(
                        casefolded,
                        f"{source}:normalized",
                        findings,
                        seen,
                        text_cf=_ci_haystack(casefolded),
                    )
            if _FOLDABLE_RE.search(text):
                folded = _WHITESPACE_RE.sub(" ", text)
                if folded != text:
                    self._scan(folded, f"{source}:folded", findings, seen)
        depth = source.count(":b64") + source.count(":hex")
        if depth < _MAX_DECODE_DEPTH and len(text) > 40:
            self._scan_encoded(text, source, findings, seen, depth)
        return findings

    def _scan_encoded(
        self,
        text: str,
        source: str,
        findings: list[Finding],
        seen: set[tuple[str, str]],
        depth: int,
    ) -> None:
        for pattern, tag in ((_B64_CANDIDATE_RE, ":b64"), (_HEX_CANDIDATE_RE, ":hex")):
            budget = _DECODE_BUDGET_CHARS
            for match in pattern.finditer(text):
                raw = match.group(0)
                budget -= len(raw)
                if budget < 0:
                    break
                try:
                    decoded = (
                        base64.b64decode(raw + "=" * (-len(raw) % 4), validate=False)
                        if tag == ":b64"
                        else bytes.fromhex(raw)
                    )
                except ValueError:
                    continue
                if not decoded:
                    continue
                for magic, label in _MAGIC_BYTES:
                    if decoded[: len(magic)] == magic:
                        self._add(findings, seen, Finding(
                            rule_id="encoded-executable",
                            category="obfuscation",
                            severity=Severity.HIGH,
                            match=f"{tag[1:]}:{label}",
                            excerpt=raw[:80],
                            source=f"{source}{tag}",
                            description=f"Encoded payload decodes to a {label}",
                        ))
                        break
                printable = sum(1 for b in decoded if 32 <= b <= 126 or b in (9, 10, 13))
                if printable / len(decoded) < _PRINTABLE_RATIO:
                    continue
                decoded_text = decoded.decode("utf-8", errors="ignore")
                cred = _DECODED_CREDENTIAL_RE.search(decoded_text)
                if cred:
                    self._add(findings, seen, Finding(
                        rule_id="encoded-credential",
                        category="credential-theft",
                        severity=Severity.HIGH,
                        match=_truncate(cred.group(0), 40),
                        excerpt=decoded_text[:100],
                        source=f"{source}{tag}",
                        description="Encoded payload decodes to a credential-shaped value",
                    ))
                nested_source = f"{source}{tag}"
                nested = self.inspect(decoded_text, source=nested_source)
                for finding in nested:
                    self._add(findings, seen, finding)

    @staticmethod
    def _scan_start(
        rule: _Rule,
        gate: tuple[tuple[frozenset[str], bool, int | None, int | None], ...],
        hay: str,
        present,
        text: str,
    ) -> int | None:
        """Leftmost position where a match can start; None if the gate hits
        prove no match is possible.

        The positional parts come from sequential pattern elements, so a
        match must contain one hit of each, in pattern order, with consecutive
        hits no farther apart than the pattern's max width between those
        elements. A greedy earliest-first walk answers whether such a chain
        exists; its extent plus each part's prefix bound the match start."""
        if rule.gate_ci and len(hay) != len(text):
            return 0  # casefold shifted offsets; positions would misalign
        pos_bounds: list[int] = []
        cursor = 0
        last_end = 0
        prev_prefix: int | None = 0
        prev_span: int | None = 0
        first = True
        for part, positional, prefix, span in gate:
            if not positional:
                continue
            if prefix is None or (not first and prev_span is None) or prev_prefix is None:
                limit = None  # unbounded gap before this part
            elif first:
                limit = None  # the match may start anywhere up to the hit
            else:
                assert prefix is not None and prev_prefix is not None and prev_span is not None
                limit = cursor + max(0, prefix - prev_prefix - prev_span)
            best_start = -1
            best_end = 0
            for lit in part:
                if not present(lit):
                    continue
                start = hay.find(lit, cursor)
                if start >= 0 and (limit is None or start <= limit):
                    if best_start < 0 or start < best_start:
                        best_start = start
                        best_end = start + len(lit)
            if best_start < 0:
                return None  # chain broken: no ordered in-gap hit
            if prefix is not None:
                pos_bounds.append(best_start - prefix)
            cursor = best_end
            last_end = best_end
            prev_prefix = prefix
            prev_span = span
            first = False
        if rule.max_span is not None:
            pos_bounds.append(last_end - rule.max_span)
        if not pos_bounds:
            return 0
        return max(0, max(pos_bounds))

    def _scan(
        self,
        text: str,
        source: str,
        findings: list[Finding],
        seen: set[tuple[str, str]],
        text_cf: str | None = None,
        cs_only: bool = False,
    ) -> None:
        ci_cache: dict[str, bool] = {}
        raw_cache: dict[str, bool] = {}
        ci_present = raw_present = None
        for rule in self._rules:
            if cs_only and rule.gate_ci:
                continue
            gate = rule.gate
            hay = text
            present = None
            if gate is not None:
                if rule.gate_ci:
                    if text_cf is None:
                        text_cf = _ci_haystack(text)
                    hay = text_cf
                    if ci_present is None:
                        ci_present = _make_presence(hay, ci_cache)
                    present = ci_present
                else:
                    if raw_present is None:
                        raw_present = _make_presence(hay, raw_cache)
                    present = raw_present
                if not _gate_hits(gate, present):
                    continue
            pos = self._scan_start(rule, gate[0], hay, present, text) if gate is not None else 0
            # Greedy walk commits to leftmost alt — fall back to full scan.
            match = rule.pattern.search(text, pos) if pos else rule.pattern.search(text)
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
            if term.pattern is not None:
                boundary_match = term.pattern.search(lowered)
                index = boundary_match.start() if boundary_match else -1
            else:
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

    @staticmethod
    def _add(findings: list[Finding], seen: set[tuple[str, str]], finding: Finding) -> None:
        identity = (finding.rule_id, finding.match)
        if identity not in seen:
            seen.add(identity)
            findings.append(finding)


def _boundary_pattern(value: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![\w.]){re.escape(value.lower())}(?![\w.])")


def _load_rules(path: Path) -> list[_Rule]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rules = []
    for rule in data["rules"]:
        pattern = re.compile(rule["pattern"])
        rules.append(
            _Rule(
                rule_id=rule["id"],
                category=rule["category"],
                severity=_severity(rule["severity"]),
                pattern=pattern,
                description=rule["description"],
                gate=_extract_gate(rule["pattern"], pattern.flags),
                gate_ci=bool(pattern.flags & re.IGNORECASE),
                max_span=_token_max_span(_re_parser.parse(rule["pattern"], pattern.flags)),
            )
        )
    return rules


def build_engine(rule_paths: list[Path], blocklist_path: Path) -> HoloneInspector:
    rules: list[_Rule] = []
    for path in rule_paths:
        rules.extend(_load_rules(path))
    blocklist_data = json.loads(blocklist_path.read_text(encoding="utf-8"))
    terms = tuple(
        _BlockTerm(
            value=value.strip(),
            kind=kind,
            pattern=_boundary_pattern(value.strip()) if kind in ("task", "process") else None,
        )
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
    return HoloneInspector(tuple(rules), terms)


@lru_cache(maxsize=1)
def default_engine() -> HoloneInspector:
    paths = [_RULES_PATH] + [
        p for p in (_RULES_ATR_PATH, _RULES_ATR_EXTENDED_PATH, _RULES_EXTENDED_PATH) if p.exists()
    ]
    return build_engine(paths, _BLOCKLIST_PATH)


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
