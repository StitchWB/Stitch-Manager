"""Command & provider registry.

Two registries live here:

1. **Command registry** — maps command names (strings) to async handler
   functions.  The ``POST /api/cmd/{name}`` dispatcher looks handlers up here.

2. **Provider registry** — maps provider IDs (e.g. ``"kiro"``, ``"windsurf"``)
   to provider plugin classes.  Core is a pure plugin HOST: by default the
   registry is EMPTY — every provider exists only as a plugin.  Provider
   classes self-register via the ``@register_provider`` decorator;
   :func:`scan_providers` merges plugin-registered providers from
   ``autoreg.providers.registry.PLUGIN_PROVIDERS`` (populated by
   ``load_plugin_providers()`` scanning installed ``kind=provider`` plugin
   packages) into ``_PROVIDER_REGISTRY`` so the UI and orchestrator can
   discover them.

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

import logging
from collections.abc import Callable, Coroutine
from typing import Any, NamedTuple

logger = logging.getLogger(__name__)

# ── Command registry ──────────────────────────────────────────────────────────

CommandHandler = Callable[..., Coroutine[Any, Any, Any]]

_COMMAND_REGISTRY: dict[str, CommandHandler] = {}
_COMMAND_META: dict[str, CommandMeta] = {}


class CommandMeta(NamedTuple):
    """Per-command policy metadata.

    Attributes:
        readonly: True if the command performs no writes and is safe to
            run concurrently with write commands.  Defaults to False.
        timeout: Maximum execution time in seconds.

            * ``None`` (default) — use the dispatcher's default timeout
              (25.0s, chosen to be below the SQLAlchemy write pool timeout
              of 30s so stuck commands are killed *before* the pool cascade).
            * ``-1`` — disable the timeout entirely (opt out).  Use for
              long-running commands that legitimately exceed the default.
            * A positive float — per-command timeout in seconds.
        admin_only: True if the command requires the ``admin`` role when
            auth is enabled.  Host-touching / destructive commands (file
            read/write dialogs, DB path, migrations) set this so a regular
            web user can never reach the host through the dispatcher.
            Ignored when auth is disabled (single-trusted-user desktop).
    """

    readonly: bool = False
    timeout: float | None = None
    admin_only: bool = False


def register_command(
    name: str,
    *,
    readonly: bool = False,
    timeout: float | None = None,
    admin_only: bool = False,
) -> Callable[[CommandHandler], CommandHandler]:
    """Decorator: register *handler* as the handler for command *name*.

    The handler signature should be ``async def handler(params: dict) -> Any``.

    Args:
        name: Command name (used in the URL: ``POST /api/{name}``).
        readonly: If True, the command does not modify state.  Defaults to
            False.
        timeout: Per-command timeout in seconds.  ``None`` (default) uses
            the dispatcher default (25.0s).  ``-1`` disables the timeout.
        admin_only: If True, the dispatcher rejects non-admin sessions with
            403 when auth is enabled.  Defaults to False.
    """

    def decorator(handler: CommandHandler) -> CommandHandler:
        if name in _COMMAND_REGISTRY:
            logger.warning("Command '%s' already registered — overwriting", name)
        _COMMAND_REGISTRY[name] = handler
        _COMMAND_META[name] = CommandMeta(
            readonly=readonly, timeout=timeout, admin_only=admin_only
        )
        return handler

    return decorator


def get_command_handler(name: str) -> CommandHandler:
    """Look up a command handler by name; raise if not found."""
    try:
        return _COMMAND_REGISTRY[name]
    except KeyError:
        raise CommandNotFoundError(name) from None


def get_command_meta(name: str) -> CommandMeta:
    """Return the policy metadata for command *name*.

    Raises :class:`CommandNotFoundError` if the command is not registered.
    """
    if name not in _COMMAND_REGISTRY:
        raise CommandNotFoundError(name) from None
    return _COMMAND_META.get(name, CommandMeta())


def list_commands() -> list[str]:
    """Return all registered command names (sorted)."""
    return sorted(_COMMAND_REGISTRY.keys())


# ── Provider registry ─────────────────────────────────────────────────────────

_PROVIDER_REGISTRY: dict[str, type] = {}


def register_provider(provider_id: str) -> Callable[[type], type]:
    """Decorator: register a class as the provider plugin for *provider_id*.

    The decorated class is expected to expose:
      - ``display_name: str``
      - ``is_llm_account: bool``
      - ``requires_machine_id: bool``
      - strategy attributes (email, browser, captcha, ...)
      - ``async execute_flow(session, ctx) -> TokenData``
    """

    def decorator(cls: type) -> type:
        cls.provider_id = provider_id  # type: ignore[attr-defined]
        if provider_id in _PROVIDER_REGISTRY:
            logger.warning("Provider '%s' already registered — overwriting", provider_id)
        _PROVIDER_REGISTRY[provider_id] = cls
        return cls

    return decorator


def get_provider(provider_id: str) -> type:
    """Look up a provider class by ID; raise if not found."""
    try:
        return _PROVIDER_REGISTRY[provider_id]
    except KeyError:
        raise ProviderNotFoundError(provider_id) from None


def list_providers() -> dict[str, type]:
    """Return a copy of the full provider registry."""
    return dict(_PROVIDER_REGISTRY)


def scan_providers() -> dict[str, type]:
    """Merge plugin-registered providers into ``_PROVIDER_REGISTRY``.

    Core is a pure plugin HOST: by default the registry is empty.  This
    function merges ``PLUGIN_PROVIDERS`` (populated by
    :func:`autoreg.providers.registry.load_plugin_providers` scanning
    installed ``kind=provider`` plugin packages) into ``_PROVIDER_REGISTRY``
    so :func:`list_providers` and :func:`get_provider` can discover them.

    Idempotent — safe to call multiple times.  Returns the populated registry.
    """
    try:
        from autoreg.providers.registry import PLUGIN_PROVIDERS
    except Exception:  # noqa: BLE001 — autoreg.providers may be absent (open-core)
        logger.debug("autoreg.providers.registry not importable — no plugin providers to merge")
        return _PROVIDER_REGISTRY

    for provider_id, provider_cls in PLUGIN_PROVIDERS.items():
        if provider_id in _PROVIDER_REGISTRY and _PROVIDER_REGISTRY[provider_id] is provider_cls:
            continue
        _PROVIDER_REGISTRY[provider_id] = provider_cls
        logger.debug("Registered plugin provider: %s (%s)", provider_id, provider_cls.__name__)

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
