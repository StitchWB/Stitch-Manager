"""Command metadata extraction for MCP tools and CLI commands.

Extracts Pydantic request models, categories, and descriptions from command handlers
using AST analysis. Provides a unified CommandMeta registry that drives both MCP tool
generation and CLI command generation.

Usage:
    from stitch_backend.core.command_meta import build_command_meta, get_command_meta
    
    # After bootstrap() imports all command modules:
    build_command_meta()
    
    # Get metadata for a specific command:
    meta = get_command_meta("add_account")
    # meta.request_model → AddAccountRequest (Pydantic model)
    # meta.category → "accounts"
    # meta.description → "Add a new account"
"""

from __future__ import annotations

import ast
import inspect
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Type

from pydantic import BaseModel

from stitch_backend.core.command_registry import (
    get_command_handler,
    list_commands,
)
from stitch_backend.core.invoke import WRITE_COMMANDS

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CommandMeta:
    """Metadata for a single command.
    
    Attributes:
        name: Command name (e.g., "add_account")
        handler: The async handler function
        request_model: Pydantic model for request validation (None if no-arg command)
        category: Domain category (e.g., "accounts", "registration")
        description: One-line description from handler docstring
        is_write: True if command mutates state (in WRITE_COMMANDS)
    """
    
    name: str
    handler: Callable[..., Any]
    request_model: Type[BaseModel] | None
    category: str
    description: str
    is_write: bool


# Global registry populated by build_command_meta()
_META_REGISTRY: dict[str, CommandMeta] = {}


def _extract_request_model(handler: Callable[..., Any]) -> Type[BaseModel] | None:
    """Extract Pydantic request model from handler source via AST analysis.
    
    Checks in order:
    0. Explicit ``handler._request_model`` attribute (set by dynamic generators)
    1. ``_parse(ModelClass, params)`` — most common
    2. ``ModelClass.model_validate(params)`` — alternative
    3. ``ModelClass(**params)`` — rare fallback
    
    Returns None if no model found (no-arg command).
    """
    # 0. Explicit model set on handler (for dynamically generated closures)
    explicit = getattr(handler, "_request_model", None)
    if explicit is not None:
        return explicit

    try:
        source = inspect.getsource(handler)
        tree = ast.parse(source)
    except (OSError, TypeError, SyntaxError) as e:
        logger.debug(f"Could not get source for {handler.__name__}: {e}")
        return None
    
    # Pattern 1: _parse(ModelClass, params)
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_parse"
            and len(node.args) >= 2
            and isinstance(node.args[0], ast.Name)
        ):
            model_name = node.args[0].id
            model = _resolve_name(handler, model_name)
            if model:
                return model
    
    # Pattern 2: ModelClass.model_validate(params)
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "model_validate"
            and isinstance(node.func.value, ast.Name)
        ):
            model_name = node.func.value.id
            model = _resolve_name(handler, model_name)
            if model:
                return model
    
    # Pattern 3: ModelClass(**params)
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and any(isinstance(kw, ast.keyword) and kw.arg is None for kw in node.keywords)
        ):
            model_name = node.func.id
            model = _resolve_name(handler, model_name)
            if model:
                return model
    
    return None


def _resolve_name(handler: Callable[..., Any], name: str) -> Type[BaseModel] | None:
    """Resolve a class name from the handler's module globals.
    
    Looks up the name in the handler's module and checks if it's a Pydantic BaseModel.
    """
    module = inspect.getmodule(handler)
    if not module:
        return None
    
    cls = getattr(module, name, None)
    if cls and isinstance(cls, type) and issubclass(cls, BaseModel):
        return cls
    
    return None


def _infer_category(handler: Callable[..., Any]) -> str:
    """Infer command category from module path.
    
    Extracts category from paths like:
    - stitch_backend.domains.accounts.commands → "accounts"
    - stitch_backend.domains.ai_proxy.commands → "ai_proxy"
    
    Returns "general" if category cannot be inferred.
    """
    module = inspect.getmodule(handler)
    if not module:
        return "general"
    
    # Match: stitch_backend.domains.{category}.commands
    match = re.search(r"domains\.([a-z_]+)\.commands", module.__name__)
    if match:
        return match.group(1)
    
    return "general"


def _extract_description(handler: Callable[..., Any]) -> str:
    """Extract one-line description from handler docstring.
    
    Takes the first line of the docstring, stripped of whitespace.
    Falls back to a formatted command name if no docstring.
    """
    doc = inspect.getdoc(handler)
    if doc:
        # Take first line, strip whitespace
        first_line = doc.strip().split("\n")[0].strip()
        if first_line:
            return first_line
    
    # Fallback: format command name
    name = handler.__name__
    if name.startswith("cmd_"):
        name = name[4:]  # Remove "cmd_" prefix
    return name.replace("_", " ").title()


def build_command_meta() -> dict[str, CommandMeta]:
    """Build metadata registry for all registered commands.
    
    Must be called after bootstrap() imports all command modules.
    Populates the global _META_REGISTRY.
    
    Returns:
        The populated registry (also stored in _META_REGISTRY)
    """
    global _META_REGISTRY
    
    commands = list_commands()
    logger.info(f"Building metadata for {len(commands)} commands...")
    
    for name in commands:
        try:
            handler = get_command_handler(name)
            
            request_model = _extract_request_model(handler)
            category = _infer_category(handler)
            description = _extract_description(handler)
            is_write = name in WRITE_COMMANDS
            
            _META_REGISTRY[name] = CommandMeta(
                name=name,
                handler=handler,
                request_model=request_model,
                category=category,
                description=description,
                is_write=is_write,
            )
            
            if request_model:
                logger.debug(f"  {name}: {request_model.__name__} ({category})")
            else:
                logger.debug(f"  {name}: no-arg ({category})")
        
        except Exception as e:
            logger.warning(f"Failed to extract metadata for '{name}': {e}")
    
    logger.info(f"Built metadata for {len(_META_REGISTRY)} commands")
    return _META_REGISTRY


def get_command_meta(name: str) -> CommandMeta | None:
    """Get metadata for a specific command.
    
    Returns None if command not found or metadata not built yet.
    """
    return _META_REGISTRY.get(name)


def get_all_command_meta() -> dict[str, CommandMeta]:
    """Get the full metadata registry.
    
    Returns empty dict if build_command_meta() not called yet.
    """
    return _META_REGISTRY.copy()


def get_commands_by_category() -> dict[str, list[CommandMeta]]:
    """Get commands grouped by category.
    
    Returns:
        Dict mapping category name to list of CommandMeta objects
    """
    by_category: dict[str, list[CommandMeta]] = {}
    
    for meta in _META_REGISTRY.values():
        if meta.category not in by_category:
            by_category[meta.category] = []
        by_category[meta.category].append(meta)
    
    # Sort commands within each category
    for category in by_category:
        by_category[category].sort(key=lambda m: m.name)
    
    return by_category
