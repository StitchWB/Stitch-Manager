from __future__ import annotations

import base64
import json
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Final

try:
    from re import _parser as _re_parser
except ImportError:  # Python < 3.11
    import sre_parse as _re_parser  # type: ignore[no-redef]


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
    gate: tuple[tuple[tuple[frozenset[str], bool, int | None], ...], tuple[int, ...]] | None
    gate_ci: bool
    max_span: int | None  # None = unbounded match length


@dataclass(frozen=True, slots=True)
class _BlockTerm:
    value: str
    kind: str
    pattern: re.Pattern[str] | None


_RULES_DIR: Final = Path(__file__).resolve().parent / "holone_rules"
_RULES_PATH: Final = _RULES_DIR / "rules.json"
_RULES_ATR_PATH: Final = _RULES_DIR / "rules_atr.json"
_RULES_ATR_EXTENDED_PATH: Final = _RULES_DIR / "rules_atr_extended.json"
_RULES_EXTENDED_PATH: Final = _RULES_DIR / "rules_extended.json"
_BLOCKLIST_PATH: Final = _RULES_DIR / "blocklist.json"

ZERO_WIDTH_CHARS: Final = frozenset({
    '\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
    '\uFEFF', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
    '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
    '\u2066', '\u2067', '\u2068', '\u2069', '\u00AD',
})

# Lookalike glyphs (Cyrillic/Greek) mapped to their ASCII lookalikes.
_HOMOGLYPHS: Final = {
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
    '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i',
    '\u043D': 'h', '\u0455': 's', '\u0458': 'j', '\u0501': 'd',
    '\u04C5': 'u', '\u04CF': 'i', '\u03B1': 'a', '\u03B5': 'e',
    '\u03B7': 'n', '\u03B9': 'i', '\u03BA': 'k', '\u03BD': 'v',
    '\u03C1': 'p', '\u03BF': 'o', '\u03C9': 'w', '\u03F2': 'c',
}

_ESCAPE_RE: Final = re.compile(r"\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(/)")

_WHITESPACE_RE: Final = re.compile(r"\s+")
# Matches iff _WHITESPACE_RE.sub(" ", text) != text, i.e. some whitespace run
# is not exactly one plain space.
_FOLDABLE_RE: Final = re.compile(r"[^\S ]| {2,}")


# Chars whose casefold lands on a homoglyph key (Greek polytonic letters with
# ypogegrammeni, symbol variants): the legacy pipeline casefolded before
# mapping, so these explicit entries keep normalize_unicode output identical.
_LEGACY_FOLD_MAP: Final = {
    0x0345: "i",
    0x0390: "i\u0308\u0301",
    0x03F0: "k",
    0x03F1: "p",
    0x03F5: "e",
    0x1C82: "o",
    0x1C83: "c",
    0x1F80: "\u1F00i",
    0x1F81: "\u1F01i",
    0x1F82: "\u1F02i",
    0x1F83: "\u1F03i",
    0x1F84: "\u1F04i",
    0x1F85: "\u1F05i",
    0x1F86: "\u1F06i",
    0x1F87: "\u1F07i",
    0x1F88: "\u1F00i",
    0x1F89: "\u1F01i",
    0x1F8A: "\u1F02i",
    0x1F8B: "\u1F03i",
    0x1F8C: "\u1F04i",
    0x1F8D: "\u1F05i",
    0x1F8E: "\u1F06i",
    0x1F8F: "\u1F07i",
    0x1F90: "\u1F20i",
    0x1F91: "\u1F21i",
    0x1F92: "\u1F22i",
    0x1F93: "\u1F23i",
    0x1F94: "\u1F24i",
    0x1F95: "\u1F25i",
    0x1F96: "\u1F26i",
    0x1F97: "\u1F27i",
    0x1F98: "\u1F20i",
    0x1F99: "\u1F21i",
    0x1F9A: "\u1F22i",
    0x1F9B: "\u1F23i",
    0x1F9C: "\u1F24i",
    0x1F9D: "\u1F25i",
    0x1F9E: "\u1F26i",
    0x1F9F: "\u1F27i",
    0x1FA0: "\u1F60i",
    0x1FA1: "\u1F61i",
    0x1FA2: "\u1F62i",
    0x1FA3: "\u1F63i",
    0x1FA4: "\u1F64i",
    0x1FA5: "\u1F65i",
    0x1FA6: "\u1F66i",
    0x1FA7: "\u1F67i",
    0x1FA8: "\u1F60i",
    0x1FA9: "\u1F61i",
    0x1FAA: "\u1F62i",
    0x1FAB: "\u1F63i",
    0x1FAC: "\u1F64i",
    0x1FAD: "\u1F65i",
    0x1FAE: "\u1F66i",
    0x1FAF: "\u1F67i",
    0x1FB2: "\u1F70i",
    0x1FB3: "ai",
    0x1FB4: "\u03ACi",
    0x1FB6: "a\u0342",
    0x1FB7: "a\u0342i",
    0x1FBC: "ai",
    0x1FBE: "i",
    0x1FC2: "\u1F74i",
    0x1FC3: "ni",
    0x1FC4: "\u03AEi",
    0x1FC6: "n\u0342",
    0x1FC7: "n\u0342i",
    0x1FCC: "ni",
    0x1FD2: "i\u0308\u0300",
    0x1FD3: "i\u0308\u0301",
    0x1FD6: "i\u0342",
    0x1FD7: "i\u0308\u0342",
    0x1FE4: "p\u0313",
    0x1FF2: "\u1F7Ci",
    0x1FF3: "wi",
    0x1FF4: "\u03CEi",
    0x1FF6: "w\u0342",
    0x1FF7: "w\u0342i",
    0x1FFC: "wi",
    0x2126: "w",
}


def _build_normalize_table() -> dict[int, str | None]:
    table: dict[int, str | None] = {ord(c): None for c in ZERO_WIDTH_CHARS}
    for src, dst in _HOMOGLYPHS.items():
        table[ord(src)] = dst
        up = src.upper()
        # Only when casefold(up) == src does the legacy pipeline (casefold,
        # then map) equal translate-then-casefold, keeping both identical.
        if len(up) == 1 and up != src and up.casefold() == src:
            table[ord(up)] = dst.upper()
    table.update(_LEGACY_FOLD_MAP)
    return table


_NORMALIZE_TABLE: Final = _build_normalize_table()

_B64_CANDIDATE_RE: Final = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")
_HEX_CANDIDATE_RE: Final = re.compile(r"\b[0-9a-fA-F]{64,}\b")
# Budget on candidate text, not candidate count: a count cap is exhausted by
# padding with benign blobs in front of the malicious one.
_DECODE_BUDGET_CHARS: Final = 262_144
_MAX_DECODE_DEPTH: Final = 2
_PRINTABLE_RATIO: Final = 0.85

# File-format magic bytes in a decoded payload = smuggled binary.
_MAGIC_BYTES: Final = (
    (b"\x4d\x5a", "PE executable"),
    (b"\x7f\x45\x4c\x46", "ELF binary"),
    (b"\x50\x4b\x03\x04", "ZIP archive"),
    (b"%PDF", "PDF document"),
    (b"\x1f\x8b", "gzip archive"),
)

# Credential shapes worth flagging even inside an otherwise clean decoded blob.
# Ported from AegisGate util/base64_detect.py (_HIGH_CONFIDENCE_CREDENTIAL_RE).
_DECODED_CREDENTIAL_RE: Final = re.compile(
    r"-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,16}-----"
    r"|\beyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}"
    r"|\b(?:sk|rk|pk)-[A-Za-z0-9\-_]{10,}"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\bghp_[A-Za-z0-9]{20,}"
    r"|\bxox[baprs]-[A-Za-z0-9-]{10,}"
    r"|\bxprv[1-9A-HJ-NP-Za-km-z]{60,120}"
)

_VARIANT_MIN_LEN: Final = 8


def redact_secrets(text: str) -> str:
    return _DECODED_CREDENTIAL_RE.sub("[redacted-secret]", text)


def entropy(s: str) -> float:
    """Shannon entropy in bits/char. Base64 ~6, hex ~4, plain text ~3-4."""
    if not s or len(s) < 20:
        return 0.0
    counts = Counter(s)
    total = len(s)
    return -sum((c / total) * math.log2(c / total) for c in counts.values())


def decode_escapes(text: str) -> str:
    if "\\" not in text:
        return text
    return _ESCAPE_RE.sub(
        lambda m: chr(int(m.group(1), 16)) if m.group(1)
        else chr(int(m.group(2), 16)) if m.group(2)
        else "/",
        text,
    )


def normalize_unicode(text: str) -> str:
    return unicodedata.normalize("NFKC", text).translate(_NORMALIZE_TABLE).casefold()


def _normalize_preserve_case(text: str) -> str:
    return unicodedata.normalize("NFKC", text).translate(_NORMALIZE_TABLE)


def analyze_content(text: str, source: str) -> list[Finding]:
    findings = []

    value = entropy(text)
    if value > 4.5 and len(text) > 50:
        findings.append(Finding(
            rule_id="encoded-content",
            category="security",
            severity=Severity.MEDIUM,
            match=f"entropy={value:.2f}",
            excerpt=text[:100],
            source=source,
            description="High-entropy content detected (potential encoded instructions)"
        ))

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


def analyze_tool_call(name: str, args: str) -> list[Finding]:
    findings = []
    text = f"{name} {args}"

    if "://" in text or "invoke-web" in text.lower():
        findings.append(Finding(
            rule_id="network-access",
            category="security",
            severity=Severity.MEDIUM,
            match="://",
            excerpt=args[:100],
            source=f"tool_call:{name}",
            description="Network access detected in tool call"
        ))

    value = entropy(args)
    if value > 4.5 and len(args) > 50:
        findings.append(Finding(
            rule_id="encoded-arguments",
            category="security",
            severity=Severity.MEDIUM,
            match=f"entropy={value:.2f}",
            excerpt=args[:100],
            source=f"tool_call:{name}",
            description="High-entropy arguments detected (potential encoded payload)"
        ))

    return findings


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
                # NFKC, zero-width strip and homoglyph map are all identity
                # on ASCII, and casefold is then plain lowercasing, so a
                # case-insensitive rule matches casefold(text) iff it matches
                # text: only case-sensitive rules need the normalized scan.
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
        prev_prefix = 0
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
            # A broken positional chain proves nothing (greedy walk commits to
            # the leftmost alternative); fall back to a full scan.
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


# Required-literal prefilter.
# A rule's gate is a conjunction of parts; a part is a set of alternative
# literal strings. The pattern can match only if every part has at least one
# alternative present in the scanned text. Extraction walks the re parse
# tree; anything not provably required yields "no constraint", so a gate may
# over-approximate (rule runs needlessly) but never skips a rule that would
# match. Branches contribute the union of their alternatives as one part
# (sound: any branch's match contains one of them).

_GATE_MAX_PART_ALTS: Final = 32
_GATE_MAX_BRANCH_ALTS: Final = 512
_GATE_MAX_LIT_LEN: Final = 24

# Every char matched by \s on str patterns (29 code points, verified vs re).
_UNICODE_SPACES: Final = (
    " \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_ASCII_SPACES: Final = " \t\n\r\x0b\x0c"
_ASCII_DIGITS: Final = "0123456789"

# re.IGNORECASE matches İ/ı against i/I, but casefold(İ)="i̇" (which no
# longer contains the substring "i") and casefold(ı)="ı". The ci haystack
# therefore maps both spellings back to plain "i"; gate literals containing
# these chars (or a combining dot, which the merge could swallow) are dropped
# instead, which only ever weakens a gate.
_CI_UNSAFE_CHARS: Final = ("İ", "ı", "\u0307")


def _ci_haystack(text: str) -> str:
    return text.casefold().replace("ı", "i").replace("i\u0307", "i")


def _category_chars(cat, ascii_only: bool) -> frozenset[str] | None:
    rp = _re_parser
    if cat is rp.CATEGORY_DIGIT:
        return frozenset(_ASCII_DIGITS) if ascii_only else None
    if cat is rp.CATEGORY_SPACE:
        return frozenset(_ASCII_SPACES if ascii_only else _UNICODE_SPACES)
    return None  # word classes and negated categories are too wide


def _in_node_chars(items, ascii_only: bool) -> frozenset[str] | None:
    chars: set[str] = set()
    for op, arg in items:
        if op is _re_parser.NEGATE:
            return None
        if op is _re_parser.LITERAL:
            chars.add(chr(arg))
        elif op is _re_parser.RANGE:
            lo, hi = arg
            if hi - lo > 64:
                return None
            chars.update(chr(c) for c in range(lo, hi + 1))
        elif op is _re_parser.CATEGORY:
            expansion = _category_chars(arg, ascii_only)
            if expansion is None:
                return None
            chars.update(expansion)
        else:
            return None
    if len(chars) > _GATE_MAX_PART_ALTS:
        return None
    return frozenset(chars)


def _truncate_part(strings) -> frozenset[str]:
    return frozenset(s[:_GATE_MAX_LIT_LEN] for s in strings)


def _token_max_span(tokens) -> int | None:
    """Longest possible match length in chars; None when unbounded."""
    rp = _re_parser
    total = 0
    for op, arg in tokens:
        if op in (rp.LITERAL, rp.IN, rp.CATEGORY, rp.ANY, rp.NOT_LITERAL):
            width: int | None = 1
        elif op is rp.AT or op is rp.ASSERT or op is rp.ASSERT_NOT:
            width = 0  # zero-width; asserted text is not part of the span
        elif op is rp.SUBPATTERN:
            width = _token_max_span(arg[3])
        elif op is rp.BRANCH:
            widths = [_token_max_span(b) for b in arg[1]]
            width = None if any(w is None for w in widths) else max(widths)
        elif op in (rp.MAX_REPEAT, rp.MIN_REPEAT, rp.POSSESSIVE_REPEAT):
            lo, hi, sub = arg
            sub_max = _token_max_span(sub)
            if hi is rp.MAXREPEAT:
                width = 0 if sub_max == 0 else None
            else:
                width = None if sub_max is None else hi * sub_max
        else:
            width = None  # grouprefs and anything unknown: unbounded
        if width is None:
            return None
        total += width
    return total


_Part = tuple[frozenset[str], bool, int | None, int | None]
# (literals, positional, prefix, elem_span): prefix/elem_span = max chars
# before / covered by the part's pattern element within a match; None =
# unbounded


def _branch_zip_parts(branches, ascii_only: bool) -> list[_Part] | None:
    """Merge branch alternatives position-wise: part j of the result is the
    union of every branch's j-th part.

    A match via any branch hits every merged part, so the conjunction stays
    sound; unlike a flat union, conjunctions shared by all branches (e.g.
    (A..B)|(B..A)) survive. Prefixes/spans merge by max (a looser bound is
    always sound). None when some branch imposes no literal constraint.
    """
    per_branch = []
    for branch in branches:
        parts = _node_parts(branch, ascii_only, 0)
        if parts is None:
            return None
        if not parts:
            return None  # a branch that can match literal-free
        per_branch.append(parts)
    merged: list[_Part] = []
    for j in range(min(len(p) for p in per_branch)):
        lits: set[str] = set()
        positional = True
        prefix: int | None = 0
        span: int | None = 0
        for bp in per_branch:
            part, pos, pre, sp = bp[j]
            lits.update(part)
            positional = positional and pos
            prefix = None if prefix is None or pre is None else max(prefix, pre)
            span = None if span is None or sp is None else max(span, sp)
        if len(lits) > _GATE_MAX_BRANCH_ALTS:
            return None  # too many alternatives to be a useful part
        merged.append((_truncate_part(lits), positional, prefix, span))
    return merged


def _node_parts(tokens, ascii_only: bool, base: int | None) -> list[_Part] | None:
    """Conjunctive (literals, positional, prefix) triples for a token list.

    prefix = max chars before the part within a match (None = unbounded).
    positional=False marks literals from lookaheads: required somewhere in
    the text but not necessarily inside the match span.

    None means a scoped flag change was found (case semantics of extracted
    literals would be unreliable) - caller must treat the rule as
    unconditional. An empty list imposes no constraint.
    """
    rp = _re_parser
    parts: list[_Part] = []
    width = base  # max chars consumable before the current position
    run: set[str] | None = None
    run_prefix: int | None = None  # width value at run start
    run_span: int | None = 0  # max chars covered by the run's alternatives

    def flush() -> None:
        nonlocal run, run_span
        if run:
            parts.append((_truncate_part(run), True, run_prefix, run_span))
            run = None
            run_span = 0

    def extend(strings: set[str], elem_span: int | None) -> None:
        nonlocal run, run_prefix, run_span
        if len(strings) > 8 and all(len(s) == 1 for s in strings):
            # wide char classes (digits, whitespace, ...) make near-useless
            # parts and explode adjacency runs into junk alternatives
            flush()
            return
        if len(strings) > _GATE_MAX_PART_ALTS:
            # too big to cross-multiply; it stands alone as its own part
            flush()
            parts.append((_truncate_part(strings), True, width, elem_span))
            return
        if run is None:
            run = set(strings)
            run_prefix = width
            run_span = elem_span
        elif len(run) * len(strings) > _GATE_MAX_PART_ALTS:
            flush()
            run = set(strings)
            run_prefix = width
            run_span = elem_span
        else:
            run = {a + b for a in run for b in strings}
            run_span = None if run_span is None or elem_span is None else run_span + elem_span

    def hoist(sub_parts: list[_Part]) -> None:
        nonlocal run
        if (
            len(sub_parts) == 1
            and len(sub_parts[0][0]) <= _GATE_MAX_PART_ALTS
            and sub_parts[0][1]
            and sub_parts[0][2] == 0
            and sub_parts[0][3] is not None
            and all(len(lit) == sub_parts[0][3] for lit in sub_parts[0][0])
        ):
            # prefix == 0 AND exact fixed width (span == every literal's
            # length): only then is the sub's literal provably adjacent to
            # the run. A variable-width sub (optionals/branches of differing
            # length) merged here would assert concatenations a real match
            # never contains.
            part, _pos, _pre, span = sub_parts[0]
            extend(set(part), span)
            return
        flush()
        for part, positional, prefix, span in sub_parts:
            parts.append(
                (
                    part,
                    positional,
                    None if prefix is None or width is None else width + prefix,
                    span,
                )
            )

    for op, arg in tokens:
        tok_w: int | None
        if op is rp.LITERAL:
            extend({chr(arg)}, 1)
            tok_w = 1
        elif op is rp.IN:
            chars = _in_node_chars(arg, ascii_only)
            if chars is None:
                flush()
            else:
                extend(set(chars), 1)
            tok_w = 1
        elif op is rp.CATEGORY:
            chars = _category_chars(arg, ascii_only)
            if chars is None:
                flush()
            else:
                extend(set(chars), 1)
            tok_w = 1
        elif op is rp.AT:
            tok_w = 0  # zero-width anchor: adjacency preserved
        elif op in (rp.ANY, rp.NOT_LITERAL):
            flush()
            tok_w = 1
        elif op is rp.BRANCH:
            _, branches = arg
            widths = [_token_max_span(b) for b in branches]
            tok_w = None if any(w is None for w in widths) else max(widths)
            d = _branch_zip_parts(branches, ascii_only)
            if d is None:
                flush()
            else:
                hoist(d)
        elif op is rp.SUBPATTERN:
            _, add_flags, del_flags, sub = arg
            if add_flags or del_flags:
                return None
            d = _node_parts(sub, ascii_only, 0)
            if d is None:
                return None
            hoist(d)
            tok_w = _token_max_span(sub)
        elif op in (rp.MAX_REPEAT, rp.MIN_REPEAT, rp.POSSESSIVE_REPEAT):
            lo, hi, sub = arg
            sub_max = _token_max_span(sub)
            if hi is rp.MAXREPEAT:
                tok_w = 0 if sub_max == 0 else None
            else:
                tok_w = None if sub_max is None else hi * sub_max
            if lo == 0:
                flush()  # optional: no constraint, breaks adjacency
            else:
                d = _node_parts(sub, ascii_only, 0)
                if d is None:
                    return None
                if (
                    len(d) == 1 and len(d[0][0]) == 1 and d[0][1]
                    and sub_max is not None and sub_max == len(next(iter(d[0][0])))
                ):
                    # one occurrence matches exactly this literal, nothing
                    # else — only then is repeating it lo times a required
                    # substring of every match
                    only = next(iter(d[0][0]))
                    extend({only * min(lo, _GATE_MAX_LIT_LEN)}, sub_max)
                else:
                    hoist(d)
                if hi != lo:
                    # variable count: content after the repeat is not adjacent
                    # to the lo-variant the run absorbed
                    flush()
        elif op is rp.ASSERT:
            _, sub = arg
            d = _node_parts(sub, ascii_only, 0)
            if d is None:
                return None
            flush()
            parts.extend((part, False, None, None) for part, _, _, _ in d)
            tok_w = 0
        elif op is rp.ASSERT_NOT:
            tok_w = 0  # zero-width, content is forbidden rather than required
        else:
            flush()  # unknown node: no constraint, breaks adjacency
            tok_w = None
        if width is not None:
            width = None if tok_w is None else width + tok_w
    flush()
    return parts


def _ci_part_variants(part: frozenset[str]) -> frozenset[str] | None:
    out: set[str] = set()
    for lit in part:
        if any(c in lit for c in _CI_UNSAFE_CHARS):
            return None
        out.add(lit.casefold())
    return frozenset(out)


def _extract_gate(
    pattern: str, flags: int
) -> tuple[tuple[tuple[frozenset[str], bool, int | None, int | None], ...], tuple[int, ...]] | None:
    ci = bool(flags & re.IGNORECASE)
    parts = _node_parts(_re_parser.parse(pattern, flags), bool(flags & re.ASCII), 0)
    if parts is None:
        return None
    out = []
    for part, positional, prefix, span in parts:
        if ci:
            part = _ci_part_variants(part)
            if part is None:
                continue
        out.append((part, positional, prefix, span))
    if not out:
        return None
    # parts stay in pattern order (the narrowing chain needs it); evaluation
    # probes the most selective part first
    eval_order = tuple(
        sorted(
            range(len(out)),
            key=lambda i: (len(out[i][0]), -min(len(lit) for lit in out[i][0])),
        )
    )
    return (tuple(out), eval_order)


def _gate_hits(
    gate: tuple[tuple[tuple[frozenset[str], bool, int | None], ...], tuple[int, ...]],
    present,
) -> bool:
    parts, eval_order = gate
    for idx in eval_order:
        part = parts[idx][0]
        hit = False
        for lit in part:
            if present(lit):
                hit = True
                break
        if not hit:
            return False
    return True


_HARVEST_MIN_LEN: Final = 512


def _make_presence(hay: str, cache: dict[str, bool]):
    """Literal-presence predicate over hay with a per-scan memo cache.

    For texts over 512 chars, first harvest the charset and the bigram and
    trigram sets (one O(n) pass each): a literal cannot be present unless all
    its trigrams are, which eliminates ~95% of misses at set-lookup cost
    instead of an O(n) str scan per literal.
    """
    if len(hay) <= _HARVEST_MIN_LEN:

        def present(lit: str) -> bool:
            result = cache.get(lit)
            if result is None:
                result = lit in hay
                cache[lit] = result
            return result

        return present

    charset = frozenset(hay)
    bigrams = frozenset(zip(hay, hay[1:], strict=False))
    trigrams = frozenset(zip(hay, hay[1:], hay[2:], strict=False))

    def present(lit: str) -> bool:
        result = cache.get(lit)
        if result is None:
            n = len(lit)
            if n == 1:
                result = lit in charset
            elif n == 2:
                result = (lit[0], lit[1]) in bigrams
            else:
                result = False
                for i in range(n - 2):
                    if (lit[i], lit[i + 1], lit[i + 2]) not in trigrams:
                        break
                else:
                    result = lit in hay
            cache[lit] = result
        return result

    return present


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
