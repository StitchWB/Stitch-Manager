"""Prompts command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("list_available_prompts")
async def cmd_list_available_prompts(params: dict) -> list:
    """Return list of available prompt names."""
    from stitch_backend.domains.prompts.service import PromptsService
    return PromptsService.list_available_prompts()


@register_command("save_prompt_content")
async def cmd_save_prompt_content(params: dict) -> dict:
    """Save a prompt's content to disk."""
    from stitch_backend.domains.prompts.service import PromptsService

    prompt_name = (params.get("promptName") or params.get("prompt_name") or "").strip()
    content = params.get("content", "")
    if not prompt_name:
        raise ValueError("promptName is required")

    PromptsService.save_prompt_content(prompt_name, content)
    return {"success": True}


@register_command("reset_prompt_to_default")
async def cmd_reset_prompt_to_default(params: dict) -> dict:
    """Reset a prompt to its default content."""
    from stitch_backend.domains.prompts.service import PromptsService

    prompt_name = (params.get("promptName") or params.get("prompt_name") or "").strip()
    if not prompt_name:
        raise ValueError("promptName is required")

    PromptsService.reset_prompt_to_default(prompt_name)
    return {"success": True}


@register_command("copy_default_prompts")
async def cmd_copy_default_prompts(params: dict) -> str:
    """Copy all default prompts to the user prompts directory."""
    from stitch_backend.domains.prompts.service import PromptsService
    return PromptsService.copy_default_prompts()


@register_command("get_prompt_content")
async def cmd_get_prompt_content(params: dict) -> str:
    """Read a prompt file's content. Mirrors Rust ``get_prompt_content``."""
    from stitch_backend.domains.prompts.service import PromptsService

    prompt_name = (params.get("promptName") or params.get("prompt_name") or "").strip()
    if not prompt_name:
        raise ValueError("promptName is required")

    content = PromptsService.get_prompt_content(prompt_name)
    if content is None:
        raise FileNotFoundError("Prompt file not found")
    return content


@register_command("get_default_prompt_content")
async def cmd_get_default_prompt_content(params: dict) -> str:
    """Read a default prompt's content. Mirrors Rust ``get_default_prompt_content``."""
    from stitch_backend.domains.prompts.service import _default_prompt_file_path

    prompt_name = (params.get("promptName") or params.get("prompt_name") or "").strip()
    if not prompt_name:
        raise ValueError("promptName is required")

    path = _default_prompt_file_path(prompt_name)
    if not path.exists():
        raise FileNotFoundError("Default prompt file not found")
    return path.read_text(encoding="utf-8")
