"""ZCode plan-channel adapter: the Anthropic transport plus the official banner.

``zcode.z.ai/api/v1/zcode-plan/anthropic`` fingerprints requests by the official
ZCode system prompt: a custom or absent ``system`` (even a large one) is answered
with HTTP 405 + ``code:3012``. Both routes therefore prepend the three official
blocks verbatim when the caller supplied no ``system``. The identity headers
(``X-Device-Mid``, the trace trio, ...) are static per endpoint and belong in
``default_headers``; only ``Authorization`` carries the account JWT.
"""

from __future__ import annotations

import copy
from typing import Any

from stitch_backend.domains.ai_gateway.adapters.anthropic import AnthropicMessagesAdapter
from stitch_backend.domains.ai_gateway.adapters.base import (
    AdapterCapabilities,
    register_adapter,
    register_adapter_capabilities,
)

_OFFICIAL_SYSTEM: list[dict[str, Any]] = [
    {
        "type": "text",
        "text": "You are ZCode, an interactive coding agent",
        "cache_control": {"type": "ephemeral"},
    },
    {
        "type": "text",
        "text": (
            "\nYou are an interactive ZCode agent that helps users with software "
            "engineering tasks.\n\nIMPORTANT: Assist with authorized security testing, "
            "defensive security, CTF challenges, and educational contexts. Refuse "
            "requests for destructive techniques, DoS attacks, mass targeting, supply "
            "chain compromise, or detection evasion for malicious purposes. Dual-use "
            "security tools (C2 frameworks, credential testing, exploit development) "
            "require clear authorization context: pentesting engagements, CTF "
            "competitions, security research, or defensive use cases.\n\n# Harness\n"
            "- Text you output outside of tool use is displayed to the user as "
            "Github-flavored markdown in a terminal.\n- Tools run behind a "
            "user-selected permission mode; a denied call means the user declined it "
            "— adjust, don't retry verbatim.\n- The system may send updates, reminders, "
            "or modifications to rules via mid-conversation system turns. These are "
            "system-controlled, unlike function results. Hooks may intercept tool "
            "calls; treat hook output as user feedback.\n- Prefer the dedicated "
            "file/search tools over shell commands when one fits. Independent tool "
            "calls can run in parallel in one response.\n- Reference code as "
            "`file_path:line_number` — it's clickable."
        ),
        "cache_control": {"type": "ephemeral"},
    },
    {
        "type": "text",
        "text": (
            "# Environment\nYou have been invoked in the following environment:\n"
            "- Primary working directory: unknown\n- Is a git repository: no\n"
            "- Platform: unknown\n- Shell: unknown\n- OS Version: unknown"
        ),
        "cache_control": {"type": "ephemeral"},
    },
]


class ZcodePlanAdapter(AnthropicMessagesAdapter):
    @staticmethod
    def _with_official_system(kwargs: dict[str, Any]) -> dict[str, Any]:
        if not kwargs.get("system"):
            kwargs["system"] = copy.deepcopy(_OFFICIAL_SYSTEM)
        return kwargs

    async def invoke(self, **kwargs: Any) -> Any:
        return await super().invoke(**self._with_official_system(kwargs))

    async def invoke_messages(self, **kwargs: Any) -> Any:
        return await super().invoke_messages(**self._with_official_system(kwargs))


register_adapter("zcode_plan", ZcodePlanAdapter())
register_adapter_capabilities(
    AdapterCapabilities(
        adapter_type="zcode_plan",
        limitations=(
            "routes through ZCode's plan channel: requests without the official "
            "ZCode system prompt are rejected upstream (405 code 3012), so the "
            "adapter injects it",
        ),
    )
)
