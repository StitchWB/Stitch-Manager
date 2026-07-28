"""Grouped CLI command generation from command metadata.

Generates Typer commands organized by category with named flags from Pydantic
request models extracted by core/command_meta.py. Each command has:
- Named flags (not opaque `--args JSON`)
- Type annotations from Pydantic fields
- Descriptions from handler docstrings
- Grouped by category (accounts, registration, proxy, etc.)

Usage:
    from stitch_backend.cli.groups import register_all_commands
    
    app = typer.Typer()
    register_all_commands(app)
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Any, Type

import typer
from pydantic import BaseModel

from stitch_backend.core.command_meta import (
    CommandMeta,
    get_all_command_meta,
    get_commands_by_category,
)
from stitch_backend.core.invoke import invoke_command_safe, serialise

logger = logging.getLogger(__name__)


def _pydantic_type_to_cli_type(annotation: Any) -> type:
    """Map Pydantic field types to CLI-friendly types.
    
    Handles:
    - int, float, bool, str → pass through
    - Optional[X] → extract X
    - list, dict, complex types → str (JSON input)
    """
    origin = getattr(annotation, "__origin__", None)
    
    if origin is not None:
        # Union types (Optional[X] = Union[X, None])
        import types
        if origin is types.UnionType:
            args = [a for a in annotation.__args__ if a is not type(None)]
            return args[0] if args else str
        # list, dict → str (JSON input)
        return str
    
    if annotation in (int, float, bool, str):
        return annotation
    
    return str  # fallback: complex types as string


def _build_cli_command(meta: CommandMeta, ensure_bootstrapped: callable):
    """Generate a Typer command with named flags from Pydantic model.
    
    For commands with a request_model:
    - Required fields become typer.Argument
    - Optional fields become typer.Option with defaults
    - Field descriptions become help text
    
    For no-arg commands (request_model=None):
    - Command takes no arguments
    """
    
    if meta.request_model is None:
        # No-arg command
        def cmd() -> None:
            ensure_bootstrapped()
            result = asyncio.run(invoke_command_safe(meta.name, {}))
            if not result["ok"]:
                print(json.dumps(result["error"], indent=2), file=sys.stderr)
                raise typer.Exit(result["error"]["code"])
            print(json.dumps(serialise(result["data"]), indent=2, default=str))
        
        return cmd
    
    # Build command with named flags
    model_cls = meta.request_model
    fields = model_cls.model_fields
    
    # Generate function source to satisfy Typer's signature inspection
    param_lines = []
    body_lines = [
        "    ensure_bootstrapped()",
        "    args = {}",
    ]
    
    for field_name, field_info in fields.items():
        cli_name = field_name.replace("_", "-")
        py_name = field_name
        cli_type = _pydantic_type_to_cli_type(field_info.annotation)
        help_text = field_info.description or field_name.replace("_", " ").title()
        
        if field_info.is_required():
            # Required → typer.Argument
            param_lines.append(
                f"    {py_name}: {cli_type.__name__} = typer.Argument(..., help='{help_text}')"
            )
        else:
            # Optional → typer.Option with default
            default = repr(field_info.default)
            param_lines.append(
                f"    {py_name}: {cli_type.__name__} = typer.Option({default}, "
                f"'--{cli_name}', help='{help_text}')"
            )
        
        # Build args dict from captured parameters
        if field_info.alias:
            body_lines.append(f"    args['{field_info.alias}'] = {py_name}")
        else:
            body_lines.append(f"    args['{field_name}'] = {py_name}")
    
    body_lines.extend([
        "    result = asyncio.run(invoke_command_safe(__cmd_name, args))",
        "    if not result['ok']:",
        "        print(json.dumps(result['error'], indent=2), file=sys.stderr)",
        "        raise typer.Exit(result['error']['code'])",
        "    print(json.dumps(serialise(result['data']), indent=2, default=str))",
    ])
    
    func_src = (
        f"def {meta.name}(\n"
        + ",\n".join(param_lines)
        + "\n) -> None:\n"
        + "\n".join(body_lines)
    )
    
    # Execute in a namespace with required imports
    ns = {
        "typer": typer,
        "asyncio": asyncio,
        "json": json,
        "sys": sys,
        "invoke_command_safe": invoke_command_safe,
        "serialise": serialise,
        "ensure_bootstrapped": ensure_bootstrapped,
        "__cmd_name": meta.name,
    }
    exec(func_src, ns)
    fn = ns[meta.name]
    fn.__doc__ = meta.description
    fn.__generated__ = func_src  # For debugging
    return fn


def register_all_commands(app: typer.Typer, ensure_bootstrapped: callable) -> int:
    """Register grouped CLI commands from metadata.
    
    Args:
        app: Main Typer app
        ensure_bootstrapped: Function to call before command execution
    
    Returns:
        Number of commands registered
    """
    by_category = get_commands_by_category()
    registered = 0
    
    for category, commands in sorted(by_category.items()):
        # Create sub-app for this category
        sub_app = typer.Typer(
            name=category,
            help=f"{category.replace('_', ' ').title()} commands",
        )
        
        for meta in commands:
            try:
                cmd_fn = _build_cli_command(meta, ensure_bootstrapped)
                sub_app.command(name=meta.name, help=meta.description)(cmd_fn)
                registered += 1
                logger.debug(f"Registered CLI command '{category} {meta.name}'")
            except Exception as e:
                logger.warning(f"Failed to register CLI command '{meta.name}': {e}")
        
        # Mount sub-app on main app
        app.add_typer(sub_app, name=category)
    
    logger.info(f"Registered {registered} CLI commands in {len(by_category)} categories")
    return registered
