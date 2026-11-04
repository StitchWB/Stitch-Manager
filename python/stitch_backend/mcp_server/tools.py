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
    register_all_tools(mcp, core_only=True)  # core commands only
    # or
    register_all_tools(mcp, core_only=False)  # every registered command
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import re
from typing import TYPE_CHECKING, Any, cast

from fastmcp.tools import Tool
from mcp.types import ToolAnnotations

from stitch_backend.core.command_meta import (
    CommandMeta,
    get_all_command_meta,
)
from stitch_backend.core.command_registry import (
    get_command_meta as _get_registry_meta,
)
from stitch_backend.core.invoke import (
    invoke_command_safe,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastmcp import FastMCP

logger = logging.getLogger(__name__)


def _as_structured(data: Any) -> dict[str, Any]:
    """Keep FastMCP structured output an object; wrap lists, scalars and None."""
    return data if isinstance(data, dict) else {"result": data}


def _mcp_caller() -> dict[str, Any]:
    """Caller identity injected into every tool call.

    The MCP server is a local stdio process with no request session, so it acts
    with admin trust by default (same posture as the HTTP dispatcher in desktop
    mode).  Override with ``STITCH_MCP_ROLE`` / ``STITCH_MCP_USER_ID``.
    """
    caller: dict[str, Any] = {
        "_caller_role": os.getenv("STITCH_MCP_ROLE", "admin"),
    }
    user_id = os.getenv("STITCH_MCP_USER_ID")
    if user_id:
        caller["_caller_user_id"] = int(user_id) if user_id.isdigit() else user_id
    return caller


# Bounded, secret-free defaults for MCP listings (HTTP/UI keeps full rows).
_MCP_PARAM_DEFAULTS: dict[str, dict[str, Any]] = {
    "list_accounts": {"limit": 100, "includeSecrets": False},
    "get_accounts": {"limit": 100, "includeSecrets": False},
}

# Must match api/cmd_dispatcher.DEFAULT_COMMAND_TIMEOUT for HTTP/MCP parity.
_DEFAULT_COMMAND_TIMEOUT: float = 25.0


async def _invoke_with_policy(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Run a command under the same policy the HTTP dispatcher enforces.

    The MCP server calls handlers directly, bypassing ``cmd_dispatcher`` — which
    is the only place that applies ``CommandMeta.admin_only`` and per-command
    ``timeout``.  Mirroring them here keeps the two surfaces equivalent.
    """
    policy = _get_registry_meta(name)

    if policy.admin_only and args.get("_caller_role") != "admin":
        return {
            "ok": False,
            "error": {
                "code": "permission_denied",
                "message": f"Command '{name}' requires admin role",
                "details": {},
            },
        }

    if policy.timeout == -1:
        return await invoke_command_safe(name, args)

    timeout = _DEFAULT_COMMAND_TIMEOUT if policy.timeout is None else policy.timeout
    try:
        return await asyncio.wait_for(invoke_command_safe(name, args), timeout=timeout)
    except TimeoutError:
        return {
            "ok": False,
            "error": {
                "code": "timeout",
                "message": f"Command '{name}' timed out after {timeout}s",
                "details": {},
            },
        }


# ── Result shaping ──────────────────────────────────────────────────────────────

_MASK = "********"

# Masking is by field name only (never by inspecting the value).
_SECRET_LAST_WORDS = frozenset({
    "password", "passwd", "secret", "token", "apikey", "apikeys", "key", "keys",
    "cookie", "cookies", "credential", "credentials", "privatekey", "blob",
})
_SECRET_SUBSTRINGS = (
    "serviceaccount", "privatekey", "clientsecret", "sessiondata",
    "registrationpassword", "proxylist",
)
_WORD_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z0-9]+|[A-Z]+")


def _is_secret_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    if any(s in normalized for s in _SECRET_SUBSTRINGS):
        return True
    words: list[str] = []
    for chunk in re.split(r"[^A-Za-z0-9]+", key):
        words.extend(_WORD_RE.findall(chunk))
    return bool(words) and words[-1].lower() in _SECRET_LAST_WORDS


def _redact_secrets(value: Any) -> Any:
    """Recursively replace secret-looking values with a mask (defence in depth)."""
    if isinstance(value, dict):
        return {
            k: (
                _MASK
                if isinstance(k, str) and _is_secret_key(k) and v not in (None, "", {}, [])
                else _redact_secrets(v)
            )
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact_secrets(v) for v in value]
    return value


def _apply_list_policy(
    data: Any, *, limit: int, offset: int, fields: list[str] | None
) -> Any:
    """Bound and project a list result; a non-positive limit means no bound."""
    if not isinstance(data, list):
        return data
    if offset:
        data = data[offset:]
    if limit and limit > 0:
        data = data[:limit]
    if fields:
        data = [
            {k: row.get(k) for k in fields} if isinstance(row, dict) else row
            for row in data
        ]
    return data


def _finalize(data: Any, *, limit: int, offset: int, fields: list[str] | None) -> dict[str, Any]:
    bounded = _apply_list_policy(data, limit=limit, offset=offset, fields=fields)
    return _as_structured(_redact_secrets(bounded))


def _build_tool_function(meta: CommandMeta) -> Callable[..., Any]:
    """Generate a tool function with typed parameters from Pydantic model.

    For commands with a request_model:
    - Each Pydantic field becomes a keyword-only parameter
    - Required fields have no default
    - Optional fields have their Pydantic default
    - Type annotations come from Pydantic field types

    For no-arg commands (request_model=None):
    - Function takes no parameters

    Every list-returning tool also accepts ``limit`` (0 = unbounded), ``offset``
    and ``fields``, unless the command already declares ``limit`` and paginates
    itself.  Secret-looking fields are always masked on the way out.
    """

    model_fields = meta.request_model.model_fields if meta.request_model else {}
    model_param_names = {(fi.alias or name) for name, fi in model_fields.items()}
    self_paged = "limit" in model_param_names

    control = () if self_paged else (
        inspect.Parameter("limit", inspect.Parameter.KEYWORD_ONLY, default=0, annotation=int),
        inspect.Parameter("offset", inspect.Parameter.KEYWORD_ONLY, default=0, annotation=int),
        inspect.Parameter(
            "fields",
            inspect.Parameter.KEYWORD_ONLY,
            default=None,
            annotation=(list[str] | None),
        ),
    )

    if meta.request_model is None and not meta.takes_params:
        async def _no_arg_fn(
            limit: int = 0, offset: int = 0, fields: list[str] | None = None
        ) -> dict[str, Any]:
            result = await _invoke_with_policy(meta.name, _mcp_caller())
            if not result["ok"]:
                raise Exception(result["error"]["message"])
            return _finalize(result["data"], limit=limit, offset=offset, fields=fields)

        _no_arg_fn.__name__ = meta.name
        _no_arg_fn.__doc__ = meta.description
        return _no_arg_fn

    if meta.request_model is None:
        async def tool_fn(
            args: dict[str, Any] | None = None,
            limit: int = 0,
            offset: int = 0,
            fields: list[str] | None = None,
        ) -> dict[str, Any]:
            result = await _invoke_with_policy(meta.name, {**(args or {}), **_mcp_caller()})
            if not result["ok"]:
                raise Exception(result["error"]["message"])
            return _finalize(result["data"], limit=limit, offset=offset, fields=fields)

        tool_fn.__name__ = meta.name
        tool_fn.__doc__ = meta.description
        return tool_fn

    # Build parameter list from Pydantic model fields
    mcp_defaults = _MCP_PARAM_DEFAULTS.get(meta.name, {})

    params = []
    for field_name, field_info in model_fields.items():
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
                default=mcp_defaults.get(param_name, field_info.default),
                annotation=annotation,
            ))

    params.extend(control)
    sig = inspect.Signature(params, return_annotation=dict[str, Any])

    # Build the actual function
    async def _tool_fn(**kwargs) -> dict[str, Any]:
        if self_paged:
            limit, offset, fields = 0, 0, None
        else:
            limit = kwargs.pop("limit", 0)
            offset = kwargs.pop("offset", 0)
            fields = kwargs.pop("fields", None)
        result = await _invoke_with_policy(meta.name, {**kwargs, **_mcp_caller()})
        if not result["ok"]:
            raise Exception(result["error"]["message"])
        return _finalize(result["data"], limit=limit, offset=offset, fields=fields)

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
        core_only: If True, only register CORE_TOOLS; if False, register
                   every registered command.

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
