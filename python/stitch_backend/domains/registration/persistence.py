"""Persist a successful registration result — account row, group share, session artifacts."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

# Logger name pinned to the pre-split service module — must not change.
logger = logging.getLogger("stitch_backend.domains.registration.service")


async def _save_registration_account(
    job_id: str,
    provider_name: str,
    config: dict,
    result: dict,
    reg_email: str,
    _donor_id: str | None,
    log_callback: Callable[[str], None],
) -> str | None:
    """Save the account + side artifacts; returns account_id (None on failure)."""
    account_id: str | None = None
    try:
        from stitch_backend.database import run_in_session
        from stitch_backend.domains.accounts.service import AccountService

        _donor_id_for_increment = _donor_id  # capture for closure

        async def _save(session):
            svc = AccountService(session)
            account = await svc.add_registered_account(
                provider=provider_name,
                email=reg_email,
                password=config.get("password"),
                token=result.get("token"),
                refresh_token=result.get("refresh_token")
                or result.get("refreshToken"),
                api_key=result.get("api_key") or result.get("apiKey"),
                display_name=reg_email,
                account_type=result.get("plan")
                or result.get("accountType")
                or "free",
                ref_code=result.get("ref_code"),
                ref_url=result.get("ref_url"),
                referred_by_id=_donor_id_for_increment,
            )
            # Increment donor counter inside the same session
            if _donor_id_for_increment is not None:
                from stitch_backend.domains.registration.referral_pool import (
                    ReferralPoolService,
                )
                await ReferralPoolService.increment_donor(
                    session, _donor_id_for_increment
                )
            return account.id

        account_id = await run_in_session(_save)
        logger.info(
            "Registration %s: account saved to DB id=%s email=%s",
            job_id, account_id, reg_email,
        )
        log_callback(
            f"[db] Account saved: id={account_id} email={reg_email}"
        )

        # Auto-share to group when groupId was provided and the caller is a member; silent no-op otherwise.
        _group_id = config.get("group_id") or config.get("groupId")
        if _group_id and account_id:
            try:
                from stitch_backend.domains.groups.service import (
                    is_member as _is_group_member,
                )
                from stitch_backend.domains.groups.service import (
                    share_resource as _share_resource,
                )

                _caller_uid = (
                    config.get("owner_id")
                    or config.get("_caller_user_id")
                )

                async def _auto_share(session):
                    if await _is_group_member(
                        session, _group_id, _caller_uid
                    ):
                        await _share_resource(
                            session,
                            group_id=_group_id,
                            resource_type="account",
                            resource_id=str(account_id),
                            shared_by=_caller_uid,
                        )
                        return True
                    return False

                _shared = await run_in_session(_auto_share)
                if _shared:
                    log_callback(
                        f"[db] Account auto-shared to group {_group_id}"
                    )
                else:
                    log_callback(
                        f"[db] Group auto-share skipped: "
                        f"caller is not a member of group {_group_id}"
                    )
            except Exception as _share_exc:
                log_callback(
                    f"[db] Group auto-share failed (non-fatal): "
                    f"{_share_exc}"
                )

        # Link TOTP key to the account if MFA was registered
        totp_key_id = result.get("totp_key_id")
        if totp_key_id and account_id:
            try:
                import sqlite3 as _sqlite3

                from stitch_backend.config import get_settings as _get_settings
                _db_path = _get_settings().database_url.split("///", 1)[-1]
                with _sqlite3.connect(_db_path) as _conn:
                    _conn.execute(
                        "UPDATE totp_keys SET account_id = ? WHERE id = ?",
                        (str(account_id), totp_key_id),
                    )
                    _conn.commit()
                log_callback(f"[db] TOTP key {totp_key_id} linked to account {account_id}")
            except Exception as _totp_exc:
                log_callback(f"[db] TOTP link failed (non-fatal): {_totp_exc}")

        # Persist browser profile path + cookies so "Open browser" restores the authenticated session.
        _kiro_account = result.get("kiro_account") or {}
        _profile_path = _kiro_account.get("browser_profile_path") or ""
        _cookies = _kiro_account.get("cookies") or "[]"
        _session_data = (_kiro_account.get("session_data")
                         or result.get("session_data", {}).get("session_data")
                         or "{}")
        if _profile_path and account_id:
            try:
                import sqlite3 as _sqlite3

                from stitch_backend.config import get_settings as _get_settings
                _db_path = _get_settings().database_url.split("///", 1)[-1]
                with _sqlite3.connect(_db_path) as _conn:
                    _conn.execute(
                        "UPDATE accounts SET browser_profile_path=?, cookies=?, "
                        "session_data=? WHERE id=?",
                        (_profile_path, _cookies, _session_data, str(account_id)),
                    )
                    _conn.commit()
                log_callback(
                    f"[db] Browser profile saved: {_profile_path}"
                )
            except Exception as _bp_exc:
                log_callback(f"[db] Browser profile save failed (non-fatal): {_bp_exc}")

        # Persist engine + shard profile id via ORM (works on both Rust-created and ORM-created schemas).
        _engine = _kiro_account.get("browser_engine") or "cloakbrowser"
        _shard_id = _kiro_account.get("shard_profile_id")
        if account_id:
            try:
                from stitch_backend.database import run_in_session
                from stitch_backend.domains.accounts.models import Account

                async def _set_engine(session):
                    acc = await session.get(Account, str(account_id))
                    if acc is not None:
                        acc.browser_engine = _engine
                        acc.shard_profile_id = _shard_id

                await run_in_session(_set_engine)
                log_callback(f"[db] Browser engine saved: {_engine}")
            except Exception as _eng_exc:
                log_callback(
                    f"[db] Browser engine save failed (non-fatal): {_eng_exc}"
                )

        # kiro_v2 also registers an AWS Builder ID — persist a companion account reusing the same browser session.
        if provider_name == "kiro_v2":
            try:
                async def _save_aws(session):
                    svc = AccountService(session)
                    aws_acc = await svc.add_registered_account(
                        provider="aws_builder_id",
                        email=reg_email,
                        password=config.get("password"),
                        display_name=reg_email,
                        account_type="free",
                    )
                    return aws_acc.id

                aws_account_id = await run_in_session(_save_aws)
                log_callback(
                    f"[db] AWS Builder ID account saved: "
                    f"id={aws_account_id} email={reg_email}"
                )

                # Attach the same browser session to the AWS account.
                if _profile_path and aws_account_id:
                    try:
                        import sqlite3 as _sqlite3

                        from stitch_backend.config import get_settings as _get_settings
                        _db_path = _get_settings().database_url.split("///", 1)[-1]
                        with _sqlite3.connect(_db_path) as _conn:
                            _conn.execute(
                                "UPDATE accounts SET browser_profile_path=?, "
                                "cookies=?, session_data=? WHERE id=?",
                                (_profile_path, _cookies, _session_data,
                                 str(aws_account_id)),
                            )
                            _conn.commit()
                    except Exception as _aws_bp_exc:
                        log_callback(
                            f"[db] AWS browser profile save failed "
                            f"(non-fatal): {_aws_bp_exc}"
                        )

                if aws_account_id:
                    try:
                        from stitch_backend.domains.accounts.models import Account

                        async def _set_aws_engine(session):
                            acc = await session.get(Account, str(aws_account_id))
                            if acc is not None:
                                acc.browser_engine = _engine
                                acc.shard_profile_id = _shard_id

                        await run_in_session(_set_aws_engine)
                    except Exception as _aws_eng_exc:
                        log_callback(
                            f"[db] AWS browser engine save failed "
                            f"(non-fatal): {_aws_eng_exc}"
                        )
            except Exception as _aws_exc:
                log_callback(
                    f"[db] AWS account save failed (non-fatal): {_aws_exc}"
                )
    except Exception as db_exc:
        import traceback as _tb
        logger.warning(
            "Registration %s: DB account save failed (non-critical): %s",
            job_id, db_exc,
        )
        # Surface the real error — a silent skip means the account never appears in the UI list.
        log_callback(
            f"[db] ACCOUNT SAVE FAILED — the account will NOT "
            f"appear in the list! Error: {db_exc!r}"
        )
        for _line in _tb.format_exc().strip().splitlines()[-4:]:
            log_callback(f"[db]   {_line}")
    return account_id
