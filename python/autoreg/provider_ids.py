"""Provider identity boundary (Zone 1).

This module holds the ``ProviderId`` enum — the canonical, data-only identity
for every provider known to the system. It lives at the ``autoreg`` package
root (open-core Zone 1) so that Zone-1 modules can import it without pulling
in ``autoreg.providers`` (Zone 2 registration logic). ``providers/base.py``
re-exports it for backwards compatibility with the provider modules that
still import from there.
"""

from enum import Enum


class ProviderId(Enum):
    # ── IDE providers (have autoreg) ──────────────────────────────────────
    KIRO = "kiro"
    KIRO_V2 = "kiro_v2"
    WINDSURF = "windsurf"
    TRAE = "trae"

    # ── Git / auth providers ──────────────────────────────────────────────
    GITHUB = "github"
    BITBUCKET = "bitbucket"

    # ── Cloud providers ───────────────────────────────────────────────────
    AWS = "aws"
    AWS_BUILDER_ID = "aws_builder_id"

    # ── AI / API providers (no browser autoreg) ───────────────────────────
    OPENAI = "openai"
    COPILOT = "copilot"
    CLAUDE = "claude"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    ANTIGRAVITY = "antigravity"
    ZAI = "zai"
    FIREWORKS = "fireworks"
    QODER = "qoder"
    V0_APP = "v0_app"

    # Web-session (web2api) providers — in-process adapters, cookie auth
    WEB_GEMINI = "web-gemini"

    @classmethod
    def values(cls) -> list[str]:
        """Return all provider id strings."""
        return [m.value for m in cls]

    @classmethod
    def from_string(cls, value: str) -> "ProviderId":
        """Parse a string to ProviderId, raises ValueError if unknown."""
        try:
            return cls(value)
        except ValueError:
            raise ValueError(
                f"Unknown provider id: {value!r}. "
                f"Valid values: {cls.values()}"
            ) from None
