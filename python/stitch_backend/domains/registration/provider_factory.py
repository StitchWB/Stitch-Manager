"""Provider factory — frontend config parsing and plugin-backed provider instantiation."""

from __future__ import annotations

import logging
from typing import Any, cast

from stitch_backend.config import REPO_ROOT

# Logger name pinned to the pre-split service module — must not change.
logger = logging.getLogger("stitch_backend.domains.registration.service")


def _resolve_imap_password_from_db(
    host: str, owner_id: int | None = None
) -> str:
    """Synchronously resolve the real IMAP/Gmail password from the settings DB.

    When ``owner_id`` is given, the user-scoped key ``u<uid>:<key>`` is tried
    first, falling back to the global key.  When ``owner_id`` is ``None``
    (desktop), only the global key is read — byte-identical to the
    pre-multi-user behaviour.
    """
    import sqlite3 as _sqlite3
    from pathlib import Path

    from stitch_backend.config import PYTHON_DIR, _app_data_dir, get_settings
    # Derive the sqlite path from settings.database_url so tests setting DATABASE_URL steer both resolvers.
    db_path: Path | None = None
    db_url = get_settings().database_url or ""
    if db_url.startswith("sqlite") and "///" in db_url:
        db_path = Path(db_url.split("///", 1)[1])
    if db_path is None or not db_path.exists():
        canonical = _app_data_dir() / "stitch-manager"
        if canonical.is_dir():
            db_path = canonical / "stitch.db"
        else:
            db_path = REPO_ROOT / "stitch.db"
            # Also try python/stitch.db (dev layout)
            if not db_path.exists():
                db_path = PYTHON_DIR / "stitch.db"
    key = "gmailAppPassword" if "gmail" in host.lower() else "imapPassword"
    user_key = f"u{owner_id}:{key}" if owner_id is not None else None
    try:
        con = _sqlite3.connect(str(db_path), timeout=5)
        # Try user-scoped key first, then global.
        if user_key:
            row = con.execute(
                "SELECT value FROM settings WHERE key = ?", (user_key,)
            ).fetchone()
            if row and row[0]:
                con.close()
                return cast("str", row[0])
        row = con.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        con.close()
        return row[0] if row and row[0] else ""
    except Exception as exc:
        logger.warning("_resolve_imap_password_from_db failed: %s", exc)
        return ""


def _build_imap_config(config: dict) -> dict | None:
    """Extract IMAP config from frontend config dict.

    Accepts both camelCase (from frontend JSON) and snake_case keys.
    When the password is the sentinel '********' (masked by settings API),
    resolves the real password from the settings DB synchronously.
    Threads ``owner_id`` from config to the resolver for per-user lookup.
    """
    server = config.get("imap_server") or config.get("imapServer")
    user = config.get("imap_user") or config.get("imapUser")
    password = config.get("imap_password") or config.get("imapPassword")
    owner_id = config.get("owner_id") or config.get("_caller_user_id")
    if server and user and password:
        port_raw = config.get("imap_port") or config.get("imapPort") or 993
        # Resolve sentinel — frontend sends '********' when the password is stored in the DB.
        if password in ("********", "••••••••", ""):
            real_pwd = _resolve_imap_password_from_db(
                str(server), owner_id=owner_id
            )
            if real_pwd:
                logger.debug("_build_imap_config: resolved DB password for %s", server)
                password = real_pwd
            else:
                logger.warning(
                    "_build_imap_config: sentinel received but no password in DB for %s",
                    server,
                )
                return None  # Don't build a broken imap_config
        logger.debug(
            "_build_imap_config: server=%s user=%s password_len=%d",
            server, user, len(password),
        )
        return {
            "host": server,
            "user": user,
            "password": password,
            "port": int(port_raw),
        }
    return None


def _build_addyio_config(config: dict):
    """Extract AddyIO config from frontend config dict."""
    if not (config.get("addyio_enabled") or config.get("addyioEnabled")):
        return None
    from autoreg.services.addyio import AddyIoConfig
    return AddyIoConfig(
        api_token=config.get("addyio_api_token") or config.get("addyioApiToken") or "",
        domain=config.get("addyio_domain") or config.get("addyioDomain") or "",
        alias_format=config.get("addyio_alias_format") or config.get("addyioAliasFormat") or "uuid",
        auto_delete=bool(config.get("addyio_auto_delete") or config.get("addyioAutoDelete")),
    )


def _build_mailtm_config(config: dict) -> dict | None:
    """Extract MailTM inbox config from frontend config dict."""
    address = (config.get("inbox_mailtm_address") or config.get("inboxMailtmAddress") or "").strip()
    password = (config.get("inbox_mailtm_password") or config.get("inboxMailtmPassword") or "").strip()
    if not address or not password:
        return None
    return {
        "address": address,
        "password": password,
        "base_url": config.get("inbox_mailtm_base_url", "https://api.mail.tm"),
    }


def _build_33mail_config(config: dict) -> dict | None:
    """Extract 33mail config from frontend config dict."""
    if not (config.get("thirty_three_mail_enabled") or config.get("thirtyThreeMailEnabled")):
        return None
    username = (config.get("thirty_three_mail_username") or config.get("thirtyThreeMailUsername") or "").strip()
    if not username:
        return None
    return {
        "username": username,
        "domain": config.get("thirty_three_mail_domain") or config.get("thirtyThreeMailDomain") or "33mail.com",
    }


def _build_provider_kwargs(config: dict) -> dict[str, Any]:
    """Build common provider kwargs from frontend config dict.

    Accepts both camelCase (from frontend JSON) and snake_case keys.
    """
    kwargs: dict[str, Any] = {
        "headless": config.get("headless", True),
        "imap_config": _build_imap_config(config),
        "email_strategy": config.get("email_strategy") or config.get("emailStrategy") or "mailtm",
        "base_email": config.get("base_email") or config.get("baseEmail") or None,
        "addyio_config": _build_addyio_config(config),
        "thirty_three_mail_config": _build_33mail_config(config),
        "mailtm_inbox_config": _build_mailtm_config(config),
    }
    return kwargs


def _build_provider(provider_name: str, config: dict):
    """Instantiate a provider from config dict.

    Core is a pure plugin HOST — every provider exists ONLY as a plugin.
    Two plugin sources are checked in order:

    1. **DATA plugin** (``kind=data``): resolved via :class:`PluginLoader` →
       :class:`PluginScenarioProvider` runs the package's data-only scenario.
    2. **PROVIDER plugin** (``kind=provider``): resolved via
       :data:`PLUGIN_PROVIDERS` (populated by
       :func:`autoreg.providers.registry.load_plugin_providers`) → the
       provider class is instantiated with ``base_kwargs``.

    If neither source has the provider, a clear ``RuntimeError`` is raised
    ("provider not installed — install plugin").
    """
    base_kwargs = _build_provider_kwargs(config)

    # DATA plugin resolution: a fresh PluginLoader per call is the pinning contract (plan §3.2 item 5).
    try:
        from autoreg.plugin.loader import PluginLoader
        from autoreg.plugin.provider_adapter import PluginScenarioProvider

        loader = PluginLoader()
        pkg_dir = loader.resolve(provider_name)
        if pkg_dir is not None:
            logger.info(
                "Registration: using plugin package for %s from %s",
                provider_name, pkg_dir,
            )
            return PluginScenarioProvider(
                pkg_dir,
                loader=loader,
                **base_kwargs,
                card_number=config.get("card_number") or config.get("cardNumber"),
                card_expiry=config.get("card_expiry") or config.get("cardExpiry"),
                card_cvc=config.get("card_cvc") or config.get("cardCvc"),
                cardholder_name=config.get("cardholder_name")
                or config.get("cardholderName"),
                billing_country=config.get("billing_country")
                or config.get("billingCountry"),
                billing_address=config.get("billing_address")
                or config.get("billingAddress"),
                billing_city=config.get("billing_city") or config.get("billingCity"),
                billing_state=config.get("billing_state") or config.get("billingState"),
                billing_zip=config.get("billing_zip") or config.get("billingZip"),
                kiro_plan=config.get("kiro_plan") or config.get("kiroPlan"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Plugin scenario resolution for %s failed: %s",
            provider_name, exc,
        )

    # PROVIDER plugin: re-scan so a fresh STITCH_PLUGINS_DIR (e.g. tests using tmp_path) is respected.
    try:
        from autoreg.providers.registry import get_plugin_provider, load_plugin_providers

        load_plugin_providers()
        provider_cls = get_plugin_provider(provider_name)
        if provider_cls is not None:
            logger.info(
                "Registration: using provider plugin for %s (%s)",
                provider_name, provider_cls.__name__,
            )
            return provider_cls(**base_kwargs)
    except Exception as exc:  # noqa: BLE001 — autoreg.providers may be absent
        logger.debug(
            "Provider plugin lookup for %s failed: %s", provider_name, exc
        )

    # No plugin found — clear error.
    raise RuntimeError(
        f"provider '{provider_name}' not installed — install plugin"
    )
