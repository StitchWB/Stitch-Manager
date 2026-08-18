"""Typed MCP tool generation from command metadata.

Generates FastMCP tools with typed parameters from Pydantic request models
extracted by core/command_meta.py. Each tool has:
- Named parameters (not opaque `args: dict`)
- Type annotations from Pydantic fields
- Descriptions from handler docstrings
- Annotations (readOnlyHint, destructiveHint) from command metadata

Usage:
    from stitch_backend.mcp_server.tools import register_all_tools

    mcp = FastMCP("Stitch Manager")
    register_all_tools(mcp, core_only=True)  # 64 core tools
    # or
    register_all_tools(mcp, core_only=False)  # all 400+ tools
"""

from __future__ import annotations

import inspect
import logging
from typing import TYPE_CHECKING, Any, cast

from fastmcp.tools import Tool
from mcp.types import ToolAnnotations

from stitch_backend.core.command_meta import (
    CommandMeta,
    get_all_command_meta,
)
from stitch_backend.core.invoke import (
    invoke_command_safe,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastmcp import FastMCP

logger = logging.getLogger(__name__)


def _build_tool_function(meta: CommandMeta) -> Callable[..., Any]:
    """Generate a tool function with typed parameters from Pydantic model.

    For commands with a request_model:
    - Each Pydantic field becomes a keyword-only parameter
    - Required fields have no default
    - Optional fields have their Pydantic default
    - Type annotations come from Pydantic field types

    For no-arg commands (request_model=None):
    - Function takes no parameters
    """

    if meta.request_model is None:
        # No-arg command
        async def tool_fn() -> dict[str, Any]:
            result = await invoke_command_safe(meta.name, {})
            if not result["ok"]:
                raise Exception(result["error"]["message"])
            return cast("dict[str, Any]", result["data"])

        tool_fn.__name__ = meta.name
        tool_fn.__doc__ = meta.description
        return tool_fn

    # Build parameter list from Pydantic model fields
    model_cls = meta.request_model
    fields = model_cls.model_fields

    params = []
    for field_name, field_info in fields.items():
        annotation = field_info.annotation or Any

        # Use alias for parameter name (camelCase for MCP agents)
        param_name = field_info.alias or field_name

        if field_info.is_required():
            params.append(inspect.Parameter(
                param_name,
                inspect.Parameter.KEYWORD_ONLY,
                annotation=annotation,
            ))
        else:
            params.append(inspect.Parameter(
                param_name,
                inspect.Parameter.KEYWORD_ONLY,
                default=field_info.default,
                annotation=annotation,
            ))

    sig = inspect.Signature(params, return_annotation=dict[str, Any])

    # Build the actual function
    async def _tool_fn(**kwargs) -> dict[str, Any]:
        result = await invoke_command_safe(meta.name, kwargs)
        if not result["ok"]:
            raise Exception(result["error"]["message"])
        return cast("dict[str, Any]", result["data"])

    _tool_fn.__name__ = meta.name
    _tool_fn.__doc__ = meta.description
    cast("Any", _tool_fn).__signature__ = sig
    _tool_fn.__annotations__ = {p.name: p.annotation for p in params}
    _tool_fn.__annotations__["return"] = dict[str, Any]

    return _tool_fn


def _build_annotations(meta: CommandMeta) -> ToolAnnotations:
    """Auto-generate tool annotations from command metadata.

    Read-only commands: readOnlyHint=True
    Write commands: readOnlyHint=False
    Destructive commands (delete, clear, remove, bulk_delete): destructiveHint=True
    """

    if not meta.is_write:
        return ToolAnnotations(readOnlyHint=True)

    # Check for destructive patterns
    destructive_patterns = ("delete", "clear", "remove", "bulk_delete")
    is_destructive = any(p in meta.name for p in destructive_patterns)

    return ToolAnnotations(
        readOnlyHint=False,
        destructiveHint=is_destructive,
    )


def register_all_tools(mcp: FastMCP, core_only: bool = True) -> int:
    """Register MCP tools from command metadata.

    Args:
        mcp: FastMCP instance
        core_only: If True, only register CORE_TOOLS (64 commands).
                   If False, register all commands (400+).

    Returns:
        Number of tools registered
    """
    from stitch_backend.mcp_server.server import CORE_TOOLS

    all_meta = get_all_command_meta()
    registered = 0

    for name, meta in all_meta.items():
        # Filter by core_only
        if core_only and name not in CORE_TOOLS:
            continue

        try:
            fn = _build_tool_function(meta)
            annotations = _build_annotations(meta)

            tool = Tool.from_function(
                fn,
                name=meta.name,
                description=meta.description,
                annotations=annotations,
            )

            mcp.add_tool(tool)
            registered += 1

            if meta.request_model:
                logger.debug(
                    f"Registered tool '{name}' with {len(meta.request_model.model_fields)} params"
                )
            else:
                logger.debug(f"Registered tool '{name}' (no-arg)")

        except Exception as e:
            logger.warning(f"Failed to register tool '{name}': {e}")

    logger.info(f"Registered {registered} MCP tools (core_only={core_only})")
    return registered
