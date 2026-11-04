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
import importlib
import inspect
import logging
import re
import textwrap
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from pydantic import BaseModel, create_model

from stitch_backend.core.command_registry import (
    get_command_handler,
    list_commands,
)
from stitch_backend.core.invoke import WRITE_COMMANDS

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CommandMeta:
    """Metadata for a single command.

    Attributes:
        name: Command name (e.g., "add_account")
        handler: The async handler function
        request_model: Pydantic model for request validation; for handlers that
            read ``params`` by hand it is synthesized from those reads, so callers
            still get a typed schema (None only for open/no-arg commands)
        category: Domain category (e.g., "accounts", "registration")
        description: One-line description from handler docstring
        is_write: True if command mutates state (in WRITE_COMMANDS)
        schema_source: How the input schema was obtained — "model" (real model),
            "derived" (synthesized from params reads), "open" (free-form args
            payload), "none" (no parameters), "unparsed" (source unavailable)
    """

    name: str
    handler: Callable[..., Any]
    request_model: type[BaseModel] | None
    category: str
    description: str
    is_write: bool
    schema_source: str


# Global registry populated by build_command_meta()
_META_REGISTRY: dict[str, CommandMeta] = {}


def _parse_handler_source(handler: Callable[..., Any]) -> ast.Module | None:
    """Parse a handler's source once for every AST-based extraction pass."""
    try:
        return ast.parse(textwrap.dedent(inspect.getsource(handler)))
    except (OSError, TypeError, SyntaxError) as e:
        logger.debug(f"Could not parse source for {getattr(handler, '__name__', handler)}: {e}")
        return None


def _extract_request_model(
    handler: Callable[..., Any], tree: ast.Module | None = None
) -> type[BaseModel] | None:
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
        return cast("type[BaseModel] | None", explicit)

    if tree is None:
        tree = _parse_handler_source(handler)
    if tree is None:
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
            model = _resolve_name(handler, model_name, tree)
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
            model = _resolve_name(handler, model_name, tree)
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
            model = _resolve_name(handler, model_name, tree)
            if model:
                return model

    return None


@dataclass(frozen=True)
class _ParamSpec:
    """One input parameter derived from a handler's direct ``params`` reads."""

    name: str
    annotation: Any
    required: bool
    default: Any


_PYDANTIC_RESERVED = frozenset({"copy", "dict", "json", "schema", "validate", "construct"})


def _is_exposable_key(key: str) -> bool:
    """False for keys that must not become params: caller identity and pydantic internals."""
    return (
        key.isidentifier()
        and not key.startswith("_")
        and not key.startswith("model_")
        and key not in _PYDANTIC_RESERVED
    )


def _literal_type(node: ast.AST) -> Any:
    """Map a literal AST node to a type (bool before int — bool subclasses int)."""
    if isinstance(node, ast.Constant):
        value = node.value
        if isinstance(value, bool):
            return bool
        if isinstance(value, int):
            return int
        if isinstance(value, float):
            return float
        if isinstance(value, str):
            return str
    if isinstance(node, ast.List):
        return list[Any]
    if isinstance(node, ast.Dict):
        return dict[str, Any]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        value = node.operand.value
        if isinstance(value, int):
            return int
        if isinstance(value, float):
            return float
    return Any


def _literal_value(node: ast.AST) -> Any:
    """Default value for a derived param, or None when the literal is not representable."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.List):
        return []
    if isinstance(node, ast.Dict):
        return {}
    return None


def _param_get_key(node: ast.AST) -> str | None:
    """The string key of a ``params.get("key", ...)`` call, else None."""
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "get"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "params"
        and node.args
        and isinstance(node.args[0], ast.Constant)
        and isinstance(node.args[0].value, str)
    ):
        return node.args[0].value
    return None


def _alias_keys(tree: ast.Module | None) -> set[str]:
    """Keys that are alternative spellings of an earlier key.

    Covers ``params.get("a") or params.get("b")`` and
    ``params.get("a", params.get("b"))`` — only the primary key is exposed.
    """
    if tree is None:
        return set()

    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            keys = [key for key in (_param_get_key(value) for value in node.values) if key is not None]
            if len(keys) >= 2:
                aliases.update(keys[1:])
        elif isinstance(node, ast.Call) and _param_get_key(node) and len(node.args) >= 2:
            inner = _param_get_key(node.args[1])
            if inner is not None:
                aliases.add(inner)
    return aliases


def _params_forwarded(tree: ast.Module | None) -> bool:
    """True when the handler passes its whole ``params`` to something else.

    Such a handler reads keys we cannot enumerate from the AST, so it must keep the
    open ``args`` payload instead of being mistaken for a no-arg command.
    """
    if tree is None:
        return False

    bases: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "get"
            and isinstance(node.value, ast.Name)
            and node.value.id == "params"
        ):
            bases.add(id(node.value))
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "params":
            bases.add(id(node.value))

    return any(
        isinstance(node, ast.Name) and node.id == "params" and id(node) not in bases
        for node in ast.walk(tree)
    )


def _derive_param_specs(tree: ast.Module | None) -> tuple[list[_ParamSpec], str | None]:
    """Derive input params from a handler's own ``params`` reads.

    Returns ``(specs, open_key)``. ``open_key`` is set when the handler forwards an
    untyped payload (``params.get("request", params)``) whose shape is not closed
    by the AST. ``_caller_*``, alias and other reserved keys are never exposed.
    """
    if tree is None:
        return [], None

    aliases = _alias_keys(tree)
    specs: dict[str, _ParamSpec] = {}
    open_key: str | None = None

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "params"
        ):
            if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                continue
            key = node.args[0].value
            if not _is_exposable_key(key) or key in aliases:
                continue
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Name) and node.args[1].id == "params":
                open_key = key
                continue
            if len(node.args) >= 2:
                specs.setdefault(key, _ParamSpec(key, _literal_type(node.args[1]), False, _literal_value(node.args[1])))
            else:
                specs.setdefault(key, _ParamSpec(key, Any, False, None))
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "params":
            subscript = node.slice
            if (
                isinstance(subscript, ast.Constant)
                and isinstance(subscript.value, str)
                and _is_exposable_key(subscript.value)
                and subscript.value not in aliases
            ):
                specs.setdefault(subscript.value, _ParamSpec(subscript.value, Any, True, None))

    return list(specs.values()), open_key


def _synthesize_model(name: str, specs: list[_ParamSpec]) -> type[BaseModel] | None:
    """Build a Pydantic model from derived specs so the MCP builder keeps one path."""
    fields: dict[str, Any] = {
        spec.name: (spec.annotation, ... if spec.required else spec.default) for spec in specs
    }
    try:
        return create_model(f"{name}_params", **fields)
    except (TypeError, ValueError) as e:
        logger.debug(f"Could not synthesize params model for '{name}': {e}")
        return None


def _resolve_name(
    handler: Callable[..., Any], name: str, tree: ast.Module | None = None
) -> type[BaseModel] | None:
    """Resolve a class name to a Pydantic model from the handler's scope.

    Checks module globals first, then the handler's own ``from X import Name``
    statements — handlers frequently import their request model in the body.
    """
    module = inspect.getmodule(handler)
    cls = getattr(module, name, None) if module else None
    if cls and isinstance(cls, type) and issubclass(cls, BaseModel):
        return cls

    if tree is None:
        tree = _parse_handler_source(handler)
    if tree is None:
        return None

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if any(alias.name == name for alias in node.names):
                try:
                    imported = importlib.import_module(node.module)
                except ImportError:
                    continue
                local = getattr(imported, name, None)
                if local and isinstance(local, type) and issubclass(local, BaseModel):
                    return local

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
            tree = _parse_handler_source(handler)

            request_model = _extract_request_model(handler, tree)
            schema_source = "model"
            if request_model is None:
                specs, open_key = _derive_param_specs(tree)
                if open_key is not None:
                    schema_source = "open"
                elif specs:
                    request_model = _synthesize_model(name, specs)
                    schema_source = "derived" if request_model is not None else "open"
                elif _params_forwarded(tree):
                    schema_source = "open"
                elif tree is None:
                    schema_source = "unparsed"
                else:
                    schema_source = "none"

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
                schema_source=schema_source,
            )

            logger.debug(f"  {name}: {schema_source} ({category})")

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
