"""Command & provider registry.

Two registries live here:

1. **Command registry** — maps command names (strings) to async handler
   functions.  The ``POST /api/cmd/{name}`` dispatcher looks handlers up here.

2. **Provider registry** — maps provider IDs (e.g. ``"kiro"``, ``"windsurf"``)
   to provider plugin classes.  Provider classes self-register via the
   ``@register_provider`` decorator and are auto-discovered by scanning the
   ``providers/`` package.

Usage
-----
    from stitch_backend.core.command_registry import (
        register_command,
        get_command_handler,
        register_provider,
        get_provider,
        scan_providers,
    )

    # ── Commands ──────────────────────────────────────────────────────────────

    @register_command("get_accounts")
    async def handle_get_accounts(params: dict) -> list[dict]:
        ...

    # ── Providers ─────────────────────────────────────────────────────────────

    @register_provider("kiro")
    class KiroProvider:
        display_name = "Kiro IDE"
        is_llm_account = True
        ...
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from pathlib import Path
from typing import Any, Callable, Coroutine, Type

logger = logging.getLogger(__name__)

# ── Command registry ──────────────────────────────────────────────────────────

CommandHandler = Callable[..., Coroutine[Any, Any, Any]]

_COMMAND_REGISTRY: dict[str, CommandHandler] = {}


def register_command(name: str) -> Callable[[CommandHandler], CommandHandler]:
    """Decorator: register *handler* as the handler for command *name*.

    The handler signature should be ``async def handler(params: dict) -> Any``.
    """

    def decorator(handler: CommandHandler) -> CommandHandler:
        if name in _COMMAND_REGISTRY:
            logger.warning("Command '%s' already registered — overwriting", name)
        _COMMAND_REGISTRY[name] = handler
        return handler

    return decorator


def get_command_handler(name: str) -> CommandHandler:
    """Look up a command handler by name; raise if not found."""
    try:
        return _COMMAND_REGISTRY[name]
    except KeyError:
        raise CommandNotFoundError(name) from None


def list_commands() -> list[str]:
    """Return all registered command names (sorted)."""
    return sorted(_COMMAND_REGISTRY.keys())


# ── Provider registry ─────────────────────────────────────────────────────────

_PROVIDER_REGISTRY: dict[str, Type] = {}


def register_provider(provider_id: str) -> Callable[[Type], Type]:
    """Decorator: register a class as the provider plugin for *provider_id*.

    The decorated class is expected to expose:
      - ``display_name: str``
      - ``is_llm_account: bool``
      - ``requires_machine_id: bool``
      - strategy attributes (email, browser, captcha, ...)
      - ``async execute_flow(session, ctx) -> TokenData``
    """

    def decorator(cls: Type) -> Type:
        cls.provider_id = provider_id  # type: ignore[attr-defined]
        if provider_id in _PROVIDER_REGISTRY:
            logger.warning("Provider '%s' already registered — overwriting", provider_id)
        _PROVIDER_REGISTRY[provider_id] = cls
        return cls

    return decorator


def get_provider(provider_id: str) -> Type:
    """Look up a provider class by ID; raise if not found."""
    try:
        return _PROVIDER_REGISTRY[provider_id]
    except KeyError:
        raise ProviderNotFoundError(provider_id) from None


def list_providers() -> dict[str, Type]:
    """Return a copy of the full provider registry."""
    return dict(_PROVIDER_REGISTRY)


def scan_providers() -> dict[str, Type]:
    """Import every non-private module inside ``domains/registration/providers/``
    so that ``@register_provider`` decorators fire.  Idempotent.

    Returns the populated registry.
    """
    providers_path = (
        Path(__file__).resolve().parent.parent / "domains" / "registration" / "providers"
    )
    if not providers_path.is_dir():
        logger.debug("providers/ directory not found at %s — skipping scan", providers_path)
        return _PROVIDER_REGISTRY

    for module_info in pkgutil.iter_modules([str(providers_path)]):
        if module_info.name.startswith("_"):
            continue
        fqn = f"stitch_backend.domains.registration.providers.{module_info.name}"
        try:
            importlib.import_module(fqn)
            logger.debug("Loaded provider module: %s", fqn)
        except Exception:
            logger.exception("Failed to import provider module: %s", fqn)

    return _PROVIDER_REGISTRY


# ── Exceptions ────────────────────────────────────────────────────────────────

class RegistryError(Exception):
    """Base for registry-related errors."""


class CommandNotFoundError(RegistryError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Unknown command: '{name}'")
        self.command_name = name


class ProviderNotFoundError(RegistryError):
    def __init__(self, provider_id: str) -> None:
        super().__init__(f"Unknown provider: '{provider_id}'")
        self.provider_id = provider_id
