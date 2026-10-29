"""``@command`` — register_command + session lifecycle in one decorator.

Handlers written for :func:`~stitch_backend.core.command_registry.register_command`
repeat the same boilerplate: parse params into a Pydantic request model,
define an inner ``_op(session)``, and run it in ``run_in_read_session`` /
``run_in_session``.  ``@command`` folds all of that into the decorator.

Usage
-----
    @command("list_x", readonly=True, request=ListXRequest)
    async def cmd_list_x(db: AsyncSession, req: ListXRequest) -> list:
        return await XService(db).list_x(...)

    @command("raw_cmd")
    async def cmd_raw(db: AsyncSession, params: dict) -> dict:
        ...

Metadata (``readonly`` / ``timeout`` / ``admin_only``) is forwarded to
:func:`register_command` unchanged; the decorated name is bound to the
wrapper, so direct calls ``await cmd_list_x(params)`` keep working.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import wraps
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from pydantic import BaseModel

from stitch_backend.core.command_registry import CommandHandler, register_command
from stitch_backend.database import run_in_read_session, run_in_session

CommandBody = Callable[[AsyncSession, Any], Awaitable[Any]]


def command(
    name: str,
    *,
    readonly: bool = False,
    timeout: float | None = None,
    admin_only: bool = False,
    request: type[BaseModel] | None = None,
) -> Callable[[CommandBody], CommandHandler]:
    """Register *handler* under *name* with the same metadata as
    :func:`~stitch_backend.core.command_registry.register_command`.

    Args:
        name: Command name (``POST /api/{name}``).
        readonly: Run in a read session (no commit); write session when False.
        timeout: Forwarded to register_command (None = dispatcher default,
            -1 = disabled).
        admin_only: Forwarded to register_command.
        request: Pydantic model class.  When given, the raw params dict is
            validated into it (same semantics as the per-domain ``_parse``
            helpers: ``model_validate(params)``) and passed as *req*; when
            omitted, the raw params dict is passed.

    The handler signature is ``async def handler(db: AsyncSession, req)``.
    Validation errors surface as ``ValidationError`` before any session is
    opened, exactly as in the pre-decorator code.
    """

    def decorator(handler: CommandBody) -> CommandHandler:
        @wraps(handler)
        async def wrapper(params: dict) -> Any:
            req = request.model_validate(params) if request is not None else params

            async def _op(db: AsyncSession) -> Any:
                return await handler(db, req)

            if readonly:
                return await run_in_read_session(_op)
            return await run_in_session(_op)

        if request is not None:
            # command_meta AST-scans handler source, which now lives here.
            cast("Any", wrapper)._request_model = request

        return register_command(
            name, readonly=readonly, timeout=timeout, admin_only=admin_only
        )(wrapper)

    return decorator
