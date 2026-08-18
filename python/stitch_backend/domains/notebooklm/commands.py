"""NotebookLM command handlers (Phase 2b).

NotebookLM is its own surface (not the AI proxy hub). Commands load the
``web-notebooklm`` account's Google cookie jar, materialise a Playwright
storage-state file, and run the requested operation through
:class:`NotebookLMService`.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import select

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

from .service import (
    NotebookLMService,
    NotebookLMUnavailableError,
    write_storage_state_file,
)

logger = logging.getLogger(__name__)


async def _load_notebooklm_account() -> dict[str, Any] | None:
    from stitch_backend.domains.accounts.models import Account

    async def _op(session):
        result = await session.execute(
            select(Account)
            .where(Account.provider == "web-notebooklm")
            .where(Account.status != "archived")
            .order_by(Account.created_at.desc())
        )
        acc = result.scalars().first()
        if acc is None:
            return None
        return {"id": str(acc.id), "cookies": str(acc.cookies or "")}

    return await run_in_session(_op)


async def _run_with_storage(account_cookies: str, operation: Any) -> Any:
    """Write a storage-state file, run ``operation(service)``, clean up."""
    path = write_storage_state_file(account_cookies)
    try:
        service = NotebookLMService()
        return await operation(service, path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            logger.debug("notebooklm: failed to remove temp storage file")


def _require_account(account: dict[str, Any] | None) -> str:
    if account is None:
        raise RuntimeError(
            "No web-notebooklm account configured. Add one and capture its "
            "Google cookies first."
        )
    return account["cookies"]


@register_command("notebooklm_list_notebooks", readonly=True)
async def cmd_notebooklm_list_notebooks(params: dict) -> list:
    account = await _load_notebooklm_account()
    cookies = _require_account(account)
    try:
        return await _run_with_storage(cookies, lambda svc, p: svc.list_notebooks(p))
    except NotebookLMUnavailableError as exc:
        raise RuntimeError(str(exc)) from None


@register_command("notebooklm_create_notebook")
async def cmd_notebooklm_create_notebook(params: dict) -> dict:
    title = str(params.get("title", "Untitled"))
    account = await _load_notebooklm_account()
    cookies = _require_account(account)
    try:
        return await _run_with_storage(
            cookies, lambda svc, p: svc.create_notebook(p, title)
        )
    except NotebookLMUnavailableError as exc:
        raise RuntimeError(str(exc)) from None


@register_command("notebooklm_ask")
async def cmd_notebooklm_ask(params: dict) -> dict:
    notebook_id = str(params.get("notebookId", params.get("notebook_id", "")))
    question = str(params.get("question", ""))
    if not notebook_id or not question:
        raise RuntimeError("notebookId and question are required")
    account = await _load_notebooklm_account()
    cookies = _require_account(account)
    try:
        text = await _run_with_storage(
            cookies, lambda svc, p: svc.ask(p, notebook_id, question)
        )
    except NotebookLMUnavailableError as exc:
        raise RuntimeError(str(exc)) from None
    return {"answer": text}


@register_command("notebooklm_generate_audio")
async def cmd_notebooklm_generate_audio(params: dict) -> dict:
    notebook_id = str(params.get("notebookId", params.get("notebook_id", "")))
    instructions = str(params.get("instructions", ""))
    if not notebook_id:
        raise RuntimeError("notebookId is required")
    account = await _load_notebooklm_account()
    cookies = _require_account(account)
    try:
        return await _run_with_storage(
            cookies,
            lambda svc, p: svc.generate_audio(p, notebook_id, instructions),
        )
    except NotebookLMUnavailableError as exc:
        raise RuntimeError(str(exc)) from None
