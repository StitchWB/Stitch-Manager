from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from typing import Final

from stitch_backend.domains.ai_proxy.holone_types import Finding, Severity

# codepoints via chr() so no invisible-char literal appears in source
ZERO_WIDTH_CHARS: Final = frozenset(map(chr, (
    0x200B, 0x200C, 0x200D, 0x200E, 0x200F,
    0xFEFF, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2066, 0x2067, 0x2068, 0x2069, 0x00AD,
)))

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
# Matches a whitespace run that is not exactly one plain space.
_FOLDABLE_RE: Final = re.compile(r"[^\S ]| {2,}")


# Explicit fold entries reproduce the casefold-then-map output exactly.
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
        # Fold uppercase only when it casefolds back to src, preserving output.
        if len(up) == 1 and up != src and up.casefold() == src:
            table[ord(up)] = dst.upper()
    table.update(_LEGACY_FOLD_MAP)
    return table


_NORMALIZE_TABLE: Final = _build_normalize_table()

_B64_CANDIDATE_RE: Final = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")
_HEX_CANDIDATE_RE: Final = re.compile(r"\b[0-9a-fA-F]{64,}\b")
# Budget on candidate chars, not count: padding would exhaust a count cap.
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

# Credential shapes to flag even in an otherwise-clean decoded blob.
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
