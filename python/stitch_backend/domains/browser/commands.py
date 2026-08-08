"""Browser domain command handlers.

Exposes browser session management (open, save, load, clear) and
account browser launching to the frontend.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC
from typing import Any

from sqlalchemy import text

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session

logger = logging.getLogger(__name__)


# ── DB helpers (raw SQL, matching Rust browser_session.rs) ─────────────────

async def _save_session(db, account_id: int, profile_path: str, cookies: str, session_data: str) -> None:
    """Persist browser session data for an account."""
    from datetime import datetime

    # Validate JSON fields (empty strings are allowed)
    if cookies:
        json.loads(cookies)
    if session_data:
        json.loads(session_data)

    now = datetime.now(UTC).isoformat()
    await db.execute(
        text(
            "UPDATE accounts "
            "SET browser_profile_path = :pp, cookies = :ck, session_data = :sd, updated_at = :now "
            "WHERE id = :id"
        ),
        {"pp": profile_path, "ck": cookies, "sd": session_data, "now": now, "id": account_id},
    )


async def _load_session(db, account_id: int) -> dict[str, str] | None:
    """Load browser session data for an account."""
    row = (
        await db.execute(
            text("SELECT browser_profile_path, cookies, session_data FROM accounts WHERE id = :id"),
            {"id": account_id},
        )
    ).mappings().first()

    if not row:
        return None
    pp = row.get("browser_profile_path")
    if not pp:
        return None
    return {
        "profilePath": pp,
        "cookies": row.get("cookies") or "",
        "sessionData": row.get("session_data") or "",
    }


async def _clear_session(db, account_id: int) -> None:
    """Clear browser session data for an account."""
    from datetime import datetime

    now = datetime.now(UTC).isoformat()
    await db.execute(
        text(
            "UPDATE accounts "
            "SET browser_profile_path = NULL, cookies = NULL, session_data = NULL, updated_at = :now "
            "WHERE id = :id"
        ),
        {"now": now, "id": account_id},
    )


async def _get_account_info(db, account_id: int) -> dict[str, Any] | None:
    """Load minimal account info needed for browser launch."""
    try:
        row = (
            await db.execute(
                text(
                    "SELECT id, email, provider, status, browser_engine, shard_profile_id "
                    "FROM accounts WHERE id = :id"
                ),
                {"id": account_id},
            )
        ).mappings().first()
    except Exception:  # noqa: BLE001 — pre-migration schema without engine columns
        row = (
            await db.execute(
                text("SELECT id, email, provider, status FROM accounts WHERE id = :id"),
                {"id": account_id},
            )
        ).mappings().first()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row.get("email") or "",
        "provider": row.get("provider") or "",
        "status": row.get("status") or "",
        "browser_engine": row.get("browser_engine") or "cloakbrowser",
        "shard_profile_id": row.get("shard_profile_id"),
    }


# ── Commands ───────────────────────────────────────────────────────────────


@register_command("save_browser_session")
async def cmd_save_browser_session(params: dict) -> dict:
    """Save browser session data (profile path, cookies, session data) for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    profile_path = params.get("profilePath", params.get("profile_path", ""))
    cookies = params.get("cookies", "")
    session_data = params.get("sessionData", params.get("session_data", ""))

    try:
        await run_in_session(
            lambda db: _save_session(db, account_id, profile_path, cookies, session_data)
        )
    except json.JSONDecodeError as exc:
        return {"success": False, "error": f"Invalid JSON: {exc}"}
    except Exception as exc:
        logger.exception("Failed to save browser session")
        return {"success": False, "error": str(exc)}

    return {"success": True}


@register_command("load_browser_session", readonly=True)
async def cmd_load_browser_session(params: dict) -> dict | None:
    """Load saved browser session data for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return None

    result: dict[str, str] | None = await run_in_read_session(lambda db: _load_session(db, account_id))
    return result


@register_command("clear_browser_session")
async def cmd_clear_browser_session(params: dict) -> dict:
    """Clear saved browser session data for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    try:
        await run_in_session(lambda db: _clear_session(db, account_id))
    except Exception as exc:
        logger.exception("Failed to clear browser session")
        return {"success": False, "error": str(exc)}

    return {"success": True}


#: Background ShardX engine download state (single-flight).
_SHARD_ENGINE_UPDATE: dict[str, Any] = {"running": False, "error": None}


@register_command("get_browser_engines", readonly=True)
async def cmd_get_browser_engines(params: dict) -> dict:
    """Report available browser engines and their install status.

    Drives the engine selector in the registration UI: engines that are not
    installed are shown disabled with a hint, and providers without engine
    support are handled by the frontend via ``supportedProviders``.

    For ShardBrowser the probe is read-only (never triggers a download):
    SDK presence, engine binary + version on disk, fingerprint library size,
    and the background update state.
    """
    import asyncio

    def _probe() -> dict:
        engines: list[dict[str, Any]] = []

        # CloakBrowser — bundled binary in resources/
        try:
            from autoreg.browser.cloakbrowser_finder import find_cloakbrowser

            cloak_path = find_cloakbrowser(auto_download=False)
        except Exception:  # noqa: BLE001
            cloak_path = None
        engines.append({
            "id": "cloakbrowser",
            "displayName": "CloakBrowser",
            "available": bool(cloak_path),
            "supportedProviders": ["kiro_v2"],
        })

        # ShardBrowser — shardx SDK installed; engine auto-downloads from the
        # ProxyShard CDN on first launch (~170 MB, cached afterwards).
        shard: dict[str, Any] = {
            "id": "shardbrowser",
            "displayName": "ShardBrowser",
            "available": False,
            "engineAutoDownload": True,
            "supportedProviders": ["kiro_v2"],
            "engineInstalled": False,
            "engineVersion": None,
            "fingerprints": 0,
            "updating": _SHARD_ENGINE_UPDATE["running"],
            "updateError": _SHARD_ENGINE_UPDATE["error"],
        }
        try:
            import shardx

            shard["available"] = True
            # Runtime metadata is computed from the package manifest; no
            # network / download happens until install() is called.
            import os as _os

            runtime = shardx.ShardX().runtime
            shard["engineVersion"] = getattr(runtime, "chromium_version", None)
            binary = getattr(runtime, "binary_path", None)
            installed = bool(binary) and Path(binary).exists()
            fp_dir = getattr(runtime, "fingerprints_dir", None)
            if not installed:
                # Fallback: the process env may differ from the canonical one
                # (launchers that strip LOCALAPPDATA) — check well-known cache
                # locations so the status reflects what is actually on disk.
                home = Path.home()
                candidates = {
                    Path(_os.environ.get("LOCALAPPDATA", home)) / "shardx-sdk",
                    home / "shardx-sdk",
                    home / "AppData" / "Local" / "shardx-sdk",
                }
                installed = any(
                    (c / "ShardX-Windows" / "chrome.exe").exists() for c in candidates
                )
                if installed and fp_dir is not None and not fp_dir.exists():
                    for c in candidates:
                        alt = c / "fingerprints"
                        if alt.exists():
                            fp_dir = alt
                            break
            shard["engineInstalled"] = installed
            if fp_dir is not None and fp_dir.exists():
                shard["fingerprints"] = len(list(fp_dir.glob("*.json")))
        except Exception:  # noqa: BLE001
            pass
        engines.append(shard)

        return {"engines": engines}

    return await asyncio.to_thread(_probe)


@register_command("update_shard_engine")
async def cmd_update_shard_engine(params: dict) -> dict:
    """Download / force-update the ShardX engine in a background thread.

    Returns immediately (``started``); the UI polls ``get_browser_engines``
    (``updating`` flag flips off when done, ``engineInstalled`` flips on).
    A 170 MB download can take minutes — never block the command timeout.
    """
    import threading

    force = bool((params or {}).get("force", True))

    if _SHARD_ENGINE_UPDATE["running"]:
        return {"started": False, "reason": "already running"}

    _SHARD_ENGINE_UPDATE["running"] = True
    _SHARD_ENGINE_UPDATE["error"] = None

    def _work() -> None:
        try:
            from autoreg.browser.async_shardbrowser_wrapper import build_shard_sdk

            sdk = build_shard_sdk()
            sdk.runtime.install(force=force)
            _SHARD_ENGINE_UPDATE["error"] = None
        except Exception as exc:  # noqa: BLE001
            _SHARD_ENGINE_UPDATE["error"] = str(exc)
        finally:
            _SHARD_ENGINE_UPDATE["running"] = False

    threading.Thread(
        target=_work, daemon=True, name="shardx-engine-update"
    ).start()
    return {"started": True}


@register_command("open_account_browser", readonly=True)
async def cmd_open_account_browser(params: dict) -> dict:
    """Launch CloakBrowser/Chrome with the account's persistent profile.

    Loads saved session data from DB, launches the browser, and optionally
    injects cookies into the new session.
    """
    account_id = int(params.get("accountId", params.get("id", params.get("account_id", 0))))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    # Load account + session from DB
    info = await run_in_read_session(lambda db: _get_account_info(db, account_id))
    if not info:
        return {"success": False, "error": f"Account {account_id} not found"}

    session = await run_in_read_session(lambda db: _load_session(db, account_id))
    profile_path = session["profilePath"] if session else None
    cookies = session["cookies"] if session else None

    provider = info.get("provider", "")
    email = info.get("email", "")
    proxy_url = params.get("proxyUrl", params.get("proxy"))
    headless = params.get("headless", False)
    extra_url = params.get("url")

    from stitch_backend.domains.browser.session import launch_account_browser

    result = await launch_account_browser(
        account_id=account_id,
        provider=provider,
        email=email,
        profile_path=profile_path,
        cookies_json=cookies,
        proxy_url=proxy_url,
        headless=headless,
        extra_url=extra_url,
        engine=info.get("browser_engine"),
        shard_profile_id=info.get("shard_profile_id"),
    )

    return {
        "success": result.success,
        "profilePath": result.profile_path,
        "pid": result.pid,
        "url": result.url,
        "error": result.error,
    }
