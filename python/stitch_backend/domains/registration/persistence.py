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
            # Provider-generated credentials (e.g. dahl fingerprint) have no
            # config-side password; email-less providers identify by username.
            reg_username = str(result.get("username") or "")
            account = await svc.add_registered_account(
                provider=provider_name,
                email=reg_email or reg_username,
                password=config.get("password") or result.get("password"),
                token=result.get("token"),
                refresh_token=result.get("refresh_token")
                or result.get("refreshToken"),
                api_key=result.get("api_key") or result.get("apiKey"),
                display_name=reg_email or reg_username,
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

        # non-fatal by design: gateway wiring must never lose the account row
        _token_data = result.get("token_data")
        _gw_base_url = (
            str(_token_data.get("base_url") or "")
            if isinstance(_token_data, dict) else ""
        )
        _gw_secret = (
            result.get("api_key") or result.get("apiKey") or result.get("token")
        )
        if account_id and _gw_base_url and _gw_secret:
            try:
                from autoreg.providers.registry import get_provider_meta

                _meta = None
                try:
                    _meta = get_provider_meta(provider_name)
                except KeyError:
                    _meta = None
                if _meta is not None and _meta.is_ai_proxy:
                    _owner_uid = (
                        config.get("owner_id")
                        or config.get("_caller_user_id")
                    )
                    _gw_label = f"autoreg {provider_name}: {reg_email}"

                    async def _gw_wire(session):
                        from stitch_backend.domains.ai_gateway.service import (
                            CredentialService,
                        )
                        from stitch_backend.domains.ai_proxy.legacy_convert import (
                            _get_or_create_endpoint,
                        )

                        endpoint = await _get_or_create_endpoint(
                            session,
                            provider=provider_name,
                            base_url=_gw_base_url,
                            owner_id=_owner_uid,
                        )
                        cred = await CredentialService(session).create_credential(
                            endpoint.id,
                            _gw_label,
                            "api_key",
                            str(_gw_secret),
                            owner_id=_owner_uid,
                        )
                        return endpoint.id, cred.id

                    _gw_endpoint_id, _gw_cred_id = await run_in_session(_gw_wire)

                    _gw_models: list[str] = []
                    try:
                        from stitch_backend.domains.ai_gateway.adapters.base import (
                            get_adapter,
                        )

                        _gw_models = await get_adapter(
                            "openai_compatible",
                        ).list_models(
                            base_url=_gw_base_url, secret=str(_gw_secret),
                        )
                    except Exception as _disc_exc:
                        log_callback(
                            f"[db] AI gateway model discovery failed (non-fatal, "
                            f"DiscoveryWorker will fill models later): {_disc_exc}"
                        )

                    if _gw_models:
                        async def _gw_routes(session):
                            from sqlalchemy import select

                            from stitch_backend.domains.ai_gateway.models import (
                                RouteTarget,
                            )
                            from stitch_backend.domains.ai_gateway.service import (
                                CredentialModelAccessService,
                                PublicModelService,
                                RouteTargetService,
                                UpstreamModelService,
                            )

                            access_svc = CredentialModelAccessService(session)
                            pub_svc = PublicModelService(session)
                            target_svc = RouteTargetService(session)
                            for _model_id in _gw_models:
                                upstream = await UpstreamModelService(
                                    session,
                                ).upsert_model(
                                    _gw_endpoint_id, _model_id,
                                    display_name=_model_id,
                                    discovery_source="autoreg_hook",
                                )
                                await access_svc.upsert_access(
                                    _gw_cred_id, upstream.id,
                                    status="available",
                                )
                                pub = await pub_svc.get_by_pk(_model_id)
                                if pub is None:
                                    pub = await pub_svc.create_public_model(
                                        _model_id,
                                        display_name=_model_id,
                                        enabled=True,
                                        owner_id=None,
                                    )
                                _existing_target = (
                                    await session.execute(
                                        select(RouteTarget).where(
                                            RouteTarget.public_model_id == pub.id,
                                            RouteTarget.upstream_model_id
                                            == upstream.id,
                                        )
                                    )
                                ).scalar_one_or_none()
                                if _existing_target is None:
                                    await target_svc.create_target(
                                        pub.id, upstream.id, priority=10,
                                    )

                        await run_in_session(_gw_routes)

                    log_callback(
                        f"[db] AI gateway wired: endpoint={_gw_endpoint_id} "
                        f"credential={_gw_cred_id} models={len(_gw_models)}"
                    )
            except Exception as _gw_exc:
                log_callback(
                    f"[db] AI gateway wiring failed (non-fatal): {_gw_exc}"
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
