"""Single source of per-provider built-in defaults.

A ``None`` field means that domain has no default for the provider — callers
keep their own fallback for unknown ids.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderDefaults:
    base_url: str | None = None
    litellm_model_prefix: str | None = None
    browser_url: str | None = None


PROVIDER_DEFAULTS: dict[str, ProviderDefaults] = {
    "anthropic": ProviderDefaults(litellm_model_prefix="anthropic/*"),
    "antigravity": ProviderDefaults(
        base_url="https://api.openai.com",
        litellm_model_prefix="openai/*",
    ),
    "aws": ProviderDefaults(browser_url="https://account.aws.com/"),
    "aws_builder_id": ProviderDefaults(browser_url="https://account.aws.com/"),
    "bitbucket": ProviderDefaults(browser_url="https://bitbucket.org/"),
    "cursor": ProviderDefaults(browser_url="https://cursor.sh/"),
    "dashscope": ProviderDefaults(
        base_url="https://dashscope.aliyuncs.com/compatible-mode",
        litellm_model_prefix="openai/*",
    ),
    "fireworks": ProviderDefaults(
        base_url="https://api.fireworks.ai/inference",
        litellm_model_prefix="fireworks_ai/*",
        browser_url="https://app.fireworks.ai/",
    ),
    "gemini": ProviderDefaults(litellm_model_prefix="gemini/*"),
    "github": ProviderDefaults(browser_url="https://github.com/settings/profile"),
    "kiro": ProviderDefaults(browser_url="https://app.kiro.dev/home"),
    "kiro_v2": ProviderDefaults(browser_url="https://app.kiro.dev/home"),
    "openai": ProviderDefaults(
        base_url="https://api.openai.com",
        litellm_model_prefix="openai/*",
        browser_url="https://platform.openai.com/",
    ),
    "trae": ProviderDefaults(browser_url="https://trae.sh/"),
    "windsurf": ProviderDefaults(browser_url="https://codeium.com/profile"),
}
