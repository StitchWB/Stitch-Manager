"""Registration orchestrator — coordinates the full registration pipeline.

The orchestrator drives a provider through the standard steps:
  1. Acquire email
  2. Generate password
  3. Launch browser
  4. Execute provider-specific flow (captcha, verification, token extraction)
  5. Store credentials in the database
  6. Emit events for progress tracking
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from stitch_backend.core.event_bus import event_bus
from stitch_backend.core.types import RegContext, TokenData

logger = logging.getLogger(__name__)


class RegistrationOrchestrator:
    """Coordinates a single registration flow for a provider plugin."""

    async def run(
        self,
        provider: Any,
        ctx: RegContext,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        """Execute the full registration pipeline.

        Args:
            provider: A provider plugin instance (has ``email``, ``browser``,
                      ``captcha``, ``verification``, ``token_extractor``,
                      ``execute_flow`` attributes).
            ctx: Mutable registration context.
            job_id: Optional job ID for progress tracking.

        Returns:
            Dict with registration result (account_id, email, token, etc).
        """
        _jid = job_id or str(uuid.uuid4())

        async def _progress(step: str, pct: float, msg: str):
            await event_bus.emit("registration.progress", {
                "job_id": _jid, "step": step, "progress": pct, "message": msg,
            })

        try:
            # Step 1: Email
            await _progress("email", 0.1, "Acquiring email...")
            if hasattr(provider, "email"):
                ctx.email = await provider.email.acquire_email(ctx)
            elif not ctx.email:
                from stitch_backend.domains.registration.strategies import generate_password
                ctx.email = f"user{_jid[:8]}@example.com"
            logger.info("Registration %s: email=%s", _jid, ctx.email)

            # Step 2: Password
            await _progress("password", 0.15, "Generating password...")
            if not ctx.password:
                from stitch_backend.domains.registration.strategies import generate_password
                ctx.password = generate_password()

            # Step 3: Browser
            await _progress("browser", 0.2, "Launching browser...")
            session = None
            if hasattr(provider, "browser"):
                from stitch_backend.core.types import BrowserProfile
                profile = BrowserProfile(headless=getattr(provider, "headless", False))
                session = await provider.browser.launch(profile)

            # Step 4: Provider-specific flow
            await _progress("registration", 0.4, f"Registering with {ctx.provider_id}...")
            if session is not None and hasattr(provider, "execute_flow"):
                token_data = await provider.execute_flow(session, ctx)
            else:
                # Stub: simulate successful registration
                token_data = TokenData(
                    access_token=f"stub-token-{_jid[:8]}",
                    refresh_token=f"stub-refresh-{_jid[:8]}",
                )

            # Step 5: Store in DB
            await _progress("store", 0.7, "Saving account...")
            account_id = await self._store_account(ctx, token_data, provider)

            # Step 6: Complete
            await _progress("complete", 1.0, "Registration complete!")
            await event_bus.emit("registration.completed", {
                "account_id": account_id,
                "email": ctx.email,
                "provider_id": ctx.provider_id,
            })

            return {
                "success": True,
                "account_id": account_id,
                "email": ctx.email,
                "provider": ctx.provider_id,
            }

        except Exception as exc:
            logger.exception("Registration %s failed at some step", _jid)
            await _progress("error", 0.0, f"Failed: {exc}")

            # Cleanup email if acquired
            if ctx.email and hasattr(provider, "email"):
                try:
                    await provider.email.cleanup(ctx.email)
                except Exception:
                    pass

            return {
                "success": False,
                "error": str(exc),
                "email": ctx.email,
                "provider": ctx.provider_id,
            }

        finally:
            # Close browser session
            if session is not None and hasattr(provider, "browser"):
                try:
                    await provider.browser.close(session)
                except Exception:
                    pass

    async def _store_account(
        self, ctx: RegContext, token_data: TokenData, provider: Any
    ) -> str:
        """Persist the new account to the database."""
        from stitch_backend.database import run_in_session
        from stitch_backend.domains.accounts.schemas import AddAccountRequest
        from stitch_backend.domains.accounts.service import AccountService

        req = AddAccountRequest(
            provider=ctx.provider_id,
            email=ctx.email,
            password=ctx.password,
            token=token_data.access_token,
            refresh_token=token_data.refresh_token,
            api_key=token_data.api_key,
            display_name=ctx.display_name or f"{ctx.provider_id}:{ctx.email}",
        )

        async def _op(session):
            svc = AccountService(session)
            result = await svc.add_account(req)
            return result

        result = await run_in_session(_op)
        return result.get("id") if isinstance(result, dict) else result.id
