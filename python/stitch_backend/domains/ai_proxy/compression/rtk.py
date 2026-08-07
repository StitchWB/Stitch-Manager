"""RTK (Rust Token Killer) — command-aware stdout compression.

Ported from rtk-ai/rtk. Implements TOML filter pipeline + built-in filters
for pytest, vitest, eslint, mypy, ruff.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Constants (from rtk src/core/truncate.rs) ─────────────────────────────────

CAP_ERRORS = 20
CAP_WARNINGS = 10
CAP_LIST = 20
CAP_INVENTORY = 50


# ── TOML Filter Pipeline (8 stages) ──────────────────────────────────────────

@dataclass
class RTKFilter:
    """Compiled filter definition (from TOML schema)."""

    name: str
    match_command: re.Pattern[str]
    description: str = ""
    strip_ansi: bool = False
    replace: list[tuple[re.Pattern[str], str]] = field(default_factory=list)
    match_output: list[tuple[re.Pattern[str], str, re.Pattern[str] | None]] = field(
        default_factory=list
    )
    strip_lines: list[re.Pattern[str]] = field(default_factory=list)
    keep_lines: list[re.Pattern[str]] = field(default_factory=list)
    truncate_lines_at: int | None = None
    head_lines: int | None = None
    tail_lines: int | None = None
    max_lines: int | None = None
    on_empty: str | None = None


class RTKPipeline:
    """8-stage TOML filter pipeline (ported from rtk src/core/toml_filter.rs)."""

    @staticmethod
    def apply(f: RTKFilter, stdout: str) -> str:
        lines = stdout.splitlines()

        # 1. strip_ansi
        if f.strip_ansi:
            lines = [_strip_ansi(line) for line in lines]

        # 2. replace — line-by-line regex substitutions (chainable)
        if f.replace:
            new_lines = []
            for line in lines:
                for pattern, replacement in f.replace:
                    line = pattern.sub(replacement, line)
                new_lines.append(line)
            lines = new_lines

        # 3. match_output — short-circuit if blob matches pattern
        if f.match_output:
            blob = "\n".join(lines)
            for pattern, message, unless in f.match_output:
                if pattern.search(blob):
                    if unless and unless.search(blob):
                        continue  # errors present — skip this rule
                    return message

        # 4. strip OR keep lines (mutually exclusive)
        if f.strip_lines:
            lines = [line for line in lines if not any(p.search(line) for p in f.strip_lines)]
        elif f.keep_lines:
            lines = [line for line in lines if any(p.search(line) for p in f.keep_lines)]

        # 5. truncate_lines_at — truncate each line to N chars
        if f.truncate_lines_at:
            lines = [_truncate(line, f.truncate_lines_at) for line in lines]

        # 6. head + tail lines
        total = len(lines)
        if f.head_lines and f.tail_lines:
            if total > f.head_lines + f.tail_lines:
                lines = (
                    lines[: f.head_lines]
                    + [f"... ({total - f.head_lines - f.tail_lines} lines omitted)"]
                    + lines[-f.tail_lines :]
                )
        elif f.head_lines:
            if total > f.head_lines:
                lines = lines[: f.head_lines] + [f"... ({total - f.head_lines} lines omitted)"]
        elif f.tail_lines:
            if total > f.tail_lines:
                omitted = total - f.tail_lines
                lines = [f"... ({omitted} lines omitted)"] + lines[-f.tail_lines :]

        # 7. max_lines — absolute cap
        if f.max_lines and len(lines) > f.max_lines:
            dropped = len(lines) - f.max_lines
            lines = lines[: f.max_lines] + [f"... ({dropped} lines truncated)"]

        # 8. on_empty
        result = "\n".join(lines)
        if not result.strip() and f.on_empty:
            return f.on_empty

        return result


def apply_rtk_filter(command: str, stdout: str) -> str:
    """Apply RTK filter matching command. Returns filtered stdout."""
    f = _find_filter(command)
    if f is None:
        return stdout  # passthrough
    return RTKPipeline.apply(f, stdout)


# ── Built-in Filters ─────────────────────────────────────────────────────────

_BUILTIN_FILTERS: list[RTKFilter] = []


def _register(f: RTKFilter) -> None:
    _BUILTIN_FILTERS.append(f)


def _find_filter(command: str) -> RTKFilter | None:
    for f in _BUILTIN_FILTERS:
        if f.match_command.search(command):
            return f
    return None


# ── Pytest Filter (state machine parser) ─────────────────────────────────────

_register(
    RTKFilter(
        name="pytest",
        match_command=re.compile(r"^pytest\b|^python\s+-m\s+pytest\b"),
        description="Pytest: failures only, summary line",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^=+\s*test session starts"),
            re.compile(r"^platform\s+"),
            re.compile(r"^collected\s+"),
            re.compile(r"^tests/.*\.py\s+[\.\sF]+$"),  # progress bars
            re.compile(r"^\s*\[\s*\d+%\]"),
        ],
        keep_lines=[
            re.compile(r"^FAILED\s+"),
            re.compile(r"^ERROR\s+"),
            re.compile(r"^=+\s*(FAILURES|short test summary|.*passed.*failed)"),
            re.compile(r"^\s*>\s+"),  # assertion lines
            re.compile(r"^\s*E\s+"),  # error lines
            re.compile(r"\.py:\d+"),  # file locations
        ],
        max_lines=CAP_ERRORS + 5,
        on_empty="Pytest: No tests collected",
    )
)


# ── Vitest Filter (JSON-first with regex fallback) ───────────────────────────

_register(
    RTKFilter(
        name="vitest",
        match_command=re.compile(r"^vitest\b|^npx\s+vitest\b|^pnpm\s+vitest\b"),
        description="Vitest: failures only",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^\s*✓\s+"),  # passing tests
            re.compile(r"^\s*○\s+"),  # skipped tests
            re.compile(r"^Test Files\s+"),
            re.compile(r"^\s*Tests\s+\d+\s+passed"),
            re.compile(r"^Duration\s+"),
        ],
        keep_lines=[
            re.compile(r"^\s*✗\s+"),  # failing tests
            re.compile(r"^\s*×\s+"),  # failing tests (alt)
            re.compile(r"FAIL\s+"),
            re.compile(r"AssertionError"),
            re.compile(r"Error:"),
        ],
        max_lines=CAP_ERRORS + 5,
        on_empty="Vitest: All tests passed",
    )
)


# ── ESLint Filter (JSON grouping by rule/file) ───────────────────────────────

_register(
    RTKFilter(
        name="eslint",
        match_command=re.compile(r"^eslint\b|^npx\s+eslint\b|^pnpm\s+eslint\b"),
        description="ESLint: grouped by rule and file",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^\s*$"),  # empty lines
            re.compile(r"^✖\s+\d+\s+problem"),  # summary
        ],
        keep_lines=[
            re.compile(r"^\s+\d+:\d+\s+"),  # line:col errors
            re.compile(r"error\s+"),
            re.compile(r"warning\s+"),
        ],
        max_lines=CAP_WARNINGS + 5,
        on_empty="ESLint: No issues found",
    )
)


# ── Mypy Filter (regex parsing + grouping by file) ───────────────────────────

_register(
    RTKFilter(
        name="mypy",
        match_command=re.compile(r"^mypy\b|^python\s+-m\s+mypy\b"),
        description="Mypy: errors grouped by file",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^Success:\s+no issues found"),
            re.compile(r"^Found\s+\d+\s+error"),
        ],
        keep_lines=[
            re.compile(r"\.py:\d+:\s+(error|warning|note):"),
        ],
        max_lines=CAP_ERRORS + 5,
        on_empty="mypy: No issues found",
    )
)


# ── Ruff Filter (JSON parsing for check) ─────────────────────────────────────

_register(
    RTKFilter(
        name="ruff",
        match_command=re.compile(r"^ruff\b"),
        description="Ruff: issues grouped by rule and file",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^Found\s+\d+\s+error"),
            re.compile(r"^\s*$"),
        ],
        keep_lines=[
            re.compile(r"\.py:\d+:\d+:\s+\w+"),  # file:line:col: code
            re.compile(r"Would reformat:"),
        ],
        max_lines=CAP_WARNINGS + 5,
        on_empty="Ruff: No issues found",
    )
)


# ── Cargo Test Filter (stream handler + aggregation) ─────────────────────────

_register(
    RTKFilter(
        name="cargo-test",
        match_command=re.compile(r"^cargo\s+test\b"),
        description="Cargo test: failures only, aggregated results",
        strip_ansi=True,
        strip_lines=[
            re.compile(r"^\s*Compiling\s+"),
            re.compile(r"^\s*Downloading\s+"),
            re.compile(r"^\s*Downloaded\s+"),
            re.compile(r"^\s*Finished\s+"),
            re.compile(r"^running\s+\d+\s+test"),
            re.compile(r"^test\s+.*\.\.\.\s+ok$"),
        ],
        keep_lines=[
            re.compile(r"^test\s+.*\.\.\.\s+FAILED"),
            re.compile(r"^failures:"),
            re.compile(r"^----\s+"),
            re.compile(r"^test result:"),
            re.compile(r"^\s*error"),
            re.compile(r"^\s*panicked"),
        ],
        max_lines=CAP_ERRORS + 10,
        on_empty="cargo test: All tests passed",
    )
)


# ── Utilities ─────────────────────────────────────────────────────────────────

_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def _strip_ansi(text: str) -> str:
    return _ANSI_ESCAPE.sub("", text)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."
