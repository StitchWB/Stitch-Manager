"""Prompts service — file-based prompt management.

Ported from Rust ``kiro_patch.rs`` prompt commands.
User prompts live in ``~/.stitch-manager/prompts/``.
Default prompts live in ``src-tauri/resources/default-prompts/``.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Default prompt names (same hardcoded list as Rust)
_DEFAULT_PROMPTS = [
    "system-prompt",
    "context-gatherer",
    "spec-task",
    "general-task",
    "tool-descriptions/fsWrite",
    "tool-descriptions/readFile",
    "tool-descriptions/readMultipleFiles",
    "tool-descriptions/grepSearch",
    "tool-descriptions/executePwsh",
    "tool-descriptions/getDiagnostics",
    "tool-descriptions/strReplace",
]


def _prompts_dir() -> Path:
    """User prompts directory: ~/.stitch-manager/prompts/."""
    return Path.home() / ".stitch-manager" / "prompts"


def _default_prompts_dir() -> Path:
    """Default prompts shipped with the app."""
    # Try src-tauri/resources/default-prompts (dev)
    from stitch_backend.config import REPO_ROOT
    dev_path = REPO_ROOT / "src-tauri" / "resources" / "default-prompts"
    if dev_path.is_dir():
        return dev_path
    # Fallback: resources/default-prompts next to exe (production)
    prod_path = Path(__file__).resolve().parents[4] / "resources" / "default-prompts"
    if prod_path.is_dir():
        return prod_path
    return dev_path  # will be missing but won't crash


def _prompt_file_path(prompt_name: str) -> Path:
    """Resolve a prompt file path inside the user prompts dir.

    Rust appends ``.txt`` for plain prompt names (no ``/``).
    Names containing ``/`` are treated as sub-paths (e.g. ``tool-descriptions/fsWrite``).
    """
    prompts_dir = _prompts_dir()
    # Append .txt for simple names; keep sub-paths as-is
    if "/" in prompt_name:
        file_path = (prompts_dir / prompt_name).resolve()
    else:
        file_path = (prompts_dir / f"{prompt_name}.txt").resolve()
    # Prevent path traversal
    if not str(file_path).startswith(str(prompts_dir.resolve())):
        raise ValueError("Invalid prompt name (path traversal detected)")
    return file_path


def _default_prompt_file_path(prompt_name: str) -> Path:
    """Resolve a prompt in the default prompts dir."""
    default_dir = _default_prompts_dir()
    # Try .txt extension first, then bare name
    txt_path = default_dir / f"{prompt_name}.txt"
    if txt_path.exists():
        return txt_path
    bare_path = default_dir / prompt_name
    if bare_path.exists():
        return bare_path
    # Try with .txt extension for the full path
    return txt_path


class PromptsService:
    """File-based prompt management (no database)."""

    @staticmethod
    def list_available_prompts() -> list[str]:
        """Return list of known prompt names."""
        # Scan user prompts dir for additional prompts
        prompts_dir = _prompts_dir()
        extra: list[str] = []
        if prompts_dir.is_dir():
            known = set(_DEFAULT_PROMPTS)
            for f in prompts_dir.rglob("*.txt"):
                name = str(f.relative_to(prompts_dir)).replace("\\", "/").removesuffix(".txt")
                if name not in known:
                    extra.append(name)
        return _DEFAULT_PROMPTS + sorted(extra)

    @staticmethod
    def get_prompt_content(prompt_name: str) -> str | None:
        """Load a prompt's content. Returns None if not found."""
        path = _prompt_file_path(prompt_name)
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    @staticmethod
    def save_prompt_content(prompt_name: str, content: str) -> None:
        """Save a prompt's content to disk."""
        path = _prompt_file_path(prompt_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        logger.info("[Prompts] Saved prompt: %s", prompt_name)

    @staticmethod
    def reset_prompt_to_default(prompt_name: str) -> None:
        """Reset a prompt to its default content."""
        default_path = _default_prompt_file_path(prompt_name)
        if not default_path.exists():
            raise FileNotFoundError(
                f"Default prompt not found: {prompt_name}"
            )
        content = default_path.read_text(encoding="utf-8")
        PromptsService.save_prompt_content(prompt_name, content)

    @staticmethod
    def copy_default_prompts() -> str:
        """Copy all default prompts to the user prompts directory."""
        default_dir = _default_prompts_dir()
        if not default_dir.is_dir():
            raise FileNotFoundError("Default prompts folder not found")
        prompts_dir = _prompts_dir()
        prompts_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(default_dir, prompts_dir, dirs_exist_ok=True)
        return f"Default prompts copied to: {prompts_dir}"

    @staticmethod
    def open_prompts_folder() -> str:
        """Open the prompts folder in the system file explorer."""
        prompts_dir = _prompts_dir()
        prompts_dir.mkdir(parents=True, exist_ok=True)
        path_str = str(prompts_dir)
        system = platform.system()
        if system == "Windows":
            os.startfile(path_str)
        elif system == "Darwin":
            os.system(f'open "{path_str}"')
        else:
            os.system(f'xdg-open "{path_str}"')
        return path_str
