"""Built-in OAuthProvider SPI implementation + engine.oauth.* reverse-RPC handlers.

Registers a built-in :class:`OAuthProvider` impl that wraps
``domains.oauth.pkce.PKCEFlow`` and ``domains.oauth.device_flow.DeviceFlow``
with lazy imports (so this module has no import-time dependency on
``domains/``).  The impl is registered at import time via
``spi.register_impl(SPI_OAUTH, ..., source="builtin")``.

``register_engine_handlers(client)`` wires the ``engine.oauth.*`` reverse-RPC
handlers on a :class:`RpcPluginClient` so that service-plugins can request
OAuth operations (start_pkce_flow, start_device_flow, exchange_code) from the
host via ``call_host``.  Each handler resolves the SPI (healthy plugin impl
or built-in fallback) and calls the async method via ``asyncio.run`` in a
sync wrapper (reverse-RPC handlers must be sync).

This module is imported from ``plugin_runtime/discovery.py`` so the built-in
OAuth SPI is registered before any service-plugin starts.  It deliberately
does NOT touch ``core/spi.py``, ``bootstrap.py``, ``main.py``, or
``capabilities.py``.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stitch_backend.core.spi import SPI_OAUTH, register_impl


class _BuiltinOAuth:
    """Built-in OAuthProvider — wraps ``domains.oauth.pkce`` and ``device_flow``.

    All domain imports are lazy (inside methods) so this module keeps no
    import-time dependency on ``domains/``.
    """

    async def start_pkce_flow(
        self,
        authorize_url: str,
        token_url: str,
        client_id: str,
        redirect_uri: str = "http://localhost:25584/api/oauth/callback",
        scope: str = "openid profile email",
        state: str | None = None,
    ) -> dict[str, Any]:
        from stitch_backend.domains.oauth.pkce import PKCEFlow

        flow = PKCEFlow(
            authorize_url=authorize_url,
            token_url=token_url,
            client_id=client_id,
            redirect_uri=redirect_uri,
            scope=scope,
        )
        auth_url = flow.get_authorization_url(state=state)
        return {"authorizationUrl": auth_url, "codeVerifier": flow.code_verifier}

    async def start_device_flow(
        self,
        device_auth_url: str,
        token_url: str,
        client_id: str,
        scope: str = "",
    ) -> dict[str, Any]:
        from stitch_backend.domains.oauth.device_flow import DeviceFlow

        flow = DeviceFlow(
            device_auth_url=device_auth_url,
            token_url=token_url,
            client_id=client_id,
            scope=scope,
        )
        return await flow.request_device_code()

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        token_url: str,
        client_id: str,
        redirect_uri: str = "http://localhost:25584/api/oauth/callback",
        proxy: str | None = None,
    ) -> dict[str, Any]:
        from stitch_backend.domains.oauth.pkce import PKCEFlow

        flow = PKCEFlow(
            authorize_url="",
            token_url=token_url,
            client_id=client_id,
            redirect_uri=redirect_uri,
        )
        flow.code_verifier = code_verifier
        return await flow.exchange_code(code, proxy=proxy)


# Register the built-in OAuth impl at import time.
register_impl(SPI_OAUTH, _BuiltinOAuth(), source="builtin")


# ── Engine OAuth reverse-RPC handlers ─────────────────────────────────────────


def register_engine_handlers(client: Any) -> None:
    """Wire ``engine.oauth.*`` reverse-RPC handlers on *client*.

    Called from :meth:`ServicePluginHost.start` after the RPC client is
    attached.  Each handler resolves the SPI (healthy plugin impl or
    built-in fallback) and calls the async method via ``asyncio.run``.
    The handlers are sync (required by ``RpcPluginClient.set_request_handler``);
    they run in a daemon thread so ``asyncio.run`` is safe (no existing
    event loop in that thread).
    """

    def _start_pkce_flow(params: dict[str, Any]) -> dict[str, Any]:
        from stitch_backend.core.spi import resolve

        impl = resolve(SPI_OAUTH)
        return asyncio.run(
            impl.start_pkce_flow(
                authorize_url=str(params.get("authorize_url", "")),
                token_url=str(params.get("token_url", "")),
                client_id=str(params.get("client_id", "")),
                redirect_uri=str(
                    params.get(
                        "redirect_uri",
                        "http://localhost:25584/api/oauth/callback",
                    )
                ),
                scope=str(params.get("scope", "openid profile email")),
                state=params.get("state"),
            )
        )

    def _start_device_flow(params: dict[str, Any]) -> dict[str, Any]:
        from stitch_backend.core.spi import resolve

        impl = resolve(SPI_OAUTH)
        return asyncio.run(
            impl.start_device_flow(
                device_auth_url=str(params.get("device_auth_url", "")),
                token_url=str(params.get("token_url", "")),
                client_id=str(params.get("client_id", "")),
                scope=str(params.get("scope", "")),
            )
        )

    def _exchange_code(params: dict[str, Any]) -> dict[str, Any]:
        from stitch_backend.core.spi import resolve

        impl = resolve(SPI_OAUTH)
        return asyncio.run(
            impl.exchange_code(
                code=str(params.get("code", "")),
                code_verifier=str(params.get("code_verifier", "")),
                token_url=str(params.get("token_url", "")),
                client_id=str(params.get("client_id", "")),
                redirect_uri=str(
                    params.get(
                        "redirect_uri",
                        "http://localhost:25584/api/oauth/callback",
                    )
                ),
                proxy=params.get("proxy"),
            )
        )

    client.set_request_handler("engine.oauth.start_pkce_flow", _start_pkce_flow)
    client.set_request_handler("engine.oauth.start_device_flow", _start_device_flow)
    client.set_request_handler("engine.oauth.exchange_code", _exchange_code)


__all__ = ["register_engine_handlers"]
