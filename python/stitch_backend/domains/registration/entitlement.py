"""Run-gate entitlement check for registration submission."""

from __future__ import annotations


async def _check_entitlement(provider_name: str, config: dict) -> None:
    """Run-gate: reject the submission when the caller's role is not
    entitled to the plugin that backs *provider_name*.

    The canonical entitlement key is the plugin package id (manifest
    ``id``, e.g. "kiro-autoreg").  ``provider_name`` is the service id
    (e.g. "kiro") and is resolved to the package id via
    :func:`resolve_provider_plugin_id`.  When the plugin is not
    installed (``None``) the gate is skipped — the existing
    "provider not installed" error path in :func:`_build_provider`
    handles it.

    Caller context is read from *config*:
      - ``owner_id`` (threaded from ``_caller_user_id``) → caller_user_id
      - ``_caller_role`` → caller_role

    Desktop / no-auth (both ``None``) →
    :func:`get_effective_entitlements` returns ``{"*"}`` → passes.

    Raises ``ValueError`` with a clear message when the caller is not
    entitled.  The command dispatcher maps ``ValueError`` to HTTP 400
    with ``str(exc)`` as the detail — matching the codebase error style
    for expected rejections.
    """
    # Lazy import — sibling module in plugin_distribution domain.
    from stitch_backend.domains.plugin_distribution.entitlements import (
        get_effective_entitlements,
        is_entitled_to,
        resolve_provider_plugin_id,
    )

    plugin_id = await resolve_provider_plugin_id(provider_name)
    if plugin_id is None:
        # Plugin not installed → let _build_provider's "provider not installed" error path handle it.
        return

    # Caller identity must come from dispatcher-injected keys, never from a spoofable config.
    caller_user_id = config.get("owner_id") or config.get("_caller_user_id")
    caller_role = config.get("_caller_role")
    entitlements = await get_effective_entitlements(caller_user_id, caller_role)
    if not is_entitled_to(plugin_id, entitlements):
        raise ValueError(
            f"plugin '{plugin_id}' is not entitled for your role — contact admin"
        )
