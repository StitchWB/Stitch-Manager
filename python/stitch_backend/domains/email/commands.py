"""Email domain command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("generate_email")
async def cmd_generate_email(params: dict) -> dict:
    """Generate a single email address using the configured strategy."""
    from stitch_backend.domains.email.service import EmailService

    strategy = params.get("strategy", "random")
    svc = EmailService()
    try:
        email = await svc.generate_email(strategy)
    finally:
        await svc.close()
    return {"email": email, "strategy": strategy}


@register_command("poll_verification_link")
async def cmd_poll_verification_link(params: dict) -> dict:
    """Poll IMAP for a verification code/link for a given email."""
    from stitch_backend.domains.email.service import EmailService

    email = params.get("email", "")
    if not email:
        return {"success": False, "error": "No email specified"}

    subject_filter = params.get("subjectFilter", "")
    code_pattern = params.get("codePattern")
    timeout = float(params.get("timeout", 120))

    svc = EmailService()
    try:
        code = await svc.wait_for_verification_code(
            email=email,
            subject_filter=subject_filter,
            code_pattern=code_pattern,
            timeout=timeout,
        )
    except TimeoutError:
        return {"success": False, "error": "Timeout waiting for verification code"}
    finally:
        await svc.close()

    return {"success": True, "code": code}


# ── Addy.io commands ──────────────────────────────────────────────────────────


@register_command("test_addyio_connection")
async def cmd_test_addyio_connection(params: dict) -> dict:
    """Test Addy.io API token — returns token details."""
    from stitch_backend.domains.email import addyio

    api_token = (params.get("apiToken") or params.get("api_token") or "").strip()
    if not api_token:
        return {"error": "apiToken is required"}
    try:
        return await addyio.test_connection(api_token)
    except Exception as exc:
        return {"error": f"Addy.io connection failed: {exc}"}


@register_command("get_addyio_account")
async def cmd_get_addyio_account(params: dict) -> dict:
    """Get Addy.io account details."""
    from stitch_backend.domains.email import addyio

    api_token = (params.get("apiToken") or params.get("api_token") or "").strip()
    if not api_token:
        return {"error": "apiToken is required"}
    try:
        return await addyio.get_account(api_token)
    except Exception as exc:
        return {"error": f"Addy.io request failed: {exc}"}


@register_command("get_addyio_domains")
async def cmd_get_addyio_domains(params: dict) -> dict:
    """Get Addy.io domain options."""
    from stitch_backend.domains.email import addyio

    api_token = (params.get("apiToken") or params.get("api_token") or "").strip()
    if not api_token:
        return {"error": "apiToken is required"}
    try:
        return await addyio.get_domains(api_token)
    except Exception as exc:
        return {"error": f"Addy.io request failed: {exc}"}


@register_command("get_addyio_recipients")
async def cmd_get_addyio_recipients(params: dict) -> list:
    """Get verified Addy.io recipients."""
    from stitch_backend.domains.email import addyio

    api_token = (params.get("apiToken") or params.get("api_token") or "").strip()
    if not api_token:
        return []
    try:
        return await addyio.get_recipients(api_token)
    except Exception as exc:
        return [{"error": f"Addy.io request failed: {exc}"}]


# ── IMAP + Proxy test commands ───────────────────────────────────────────────


@register_command("test_imap_connection")
async def cmd_test_imap_connection(params: dict) -> str:
    """Test IMAP connection with provided credentials.

    Ported from Rust ``test_imap_connection`` in python_commands.rs.
    Returns a success string on success, raises on failure — matching
    the Rust contract (frontend expects ``safeInvoke<string>``).
    """
    import imaplib
    import ssl

    server = (params.get("imapServer") or params.get("imap_server") or "").strip()
    user = (params.get("imapUser") or params.get("imap_user") or "").strip()
    password = (params.get("imapPassword") or params.get("imap_password") or "").strip()

    if not server or not user:
        raise ValueError("imapServer and imapUser are required")

    # Parse host:port
    host = server
    port = 993
    if ":" in server:
        parts = server.split(":", 1)
        host = parts[0]
        try:
            port = int(parts[1])
        except ValueError:
            port = 993

    # Resolve password sentinel ("********") from settings table
    is_gmail = "gmail.com" in server or "imap.google.com" in server
    setting_key = "gmailAppPassword" if is_gmail else "imapPassword"
    if password in ("••••••••", "********", ""):
        from sqlalchemy import text as sql_text
        from stitch_backend.database import run_in_session

        async def _fetch_pwd(session):
            r = await session.execute(
                sql_text("SELECT value FROM settings WHERE key = :k"),
                {"k": setting_key},
            )
            row = r.first()
            return row[0] if row else ""

        password = await run_in_session(_fetch_pwd)
        if not password:
            pwd_type = "Gmail App Password" if is_gmail else "IMAP password"
            raise ValueError(f"{pwd_type} not configured")

    ctx = ssl.create_default_context()
    with imaplib.IMAP4_SSL(host, port, ssl_context=ctx) as mail:
        mail.login(user, password)
        status, data = mail.select("INBOX")
        message_count = data[0].decode() if status == "OK" else "0"
        mail.close()
        mail.logout()
        return f"Connected successfully! INBOX has {message_count} messages"


@register_command("test_proxy")
async def cmd_test_proxy(params: dict) -> dict:
    """Test proxy connectivity.

    Ported from frontend ``testProxy({proxyUrl, proxyType})``.
    Delegates to ``test_proxy_library_draft`` if available,
    otherwise performs a basic HTTP test through the proxy.
    """
    proxy_url = (params.get("proxyUrl") or "").strip()
    if not proxy_url:
        return {"success": False, "error": "proxyUrl is required"}

    import httpx

    try:
        async with httpx.AsyncClient(
            proxy=proxy_url, timeout=12,
        ) as client:
            resp = await client.get("https://httpbin.org/ip")
            resp.raise_for_status()
            data = resp.json()
            return {
                "success": True,
                "ip": data.get("origin", "unknown"),
            }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


# ── Rust-style email generation commands ──────────────────────────────────────

import hashlib
import random
import string
import time as _time


def _generate_email_by_strategy(strategy: str, imap_user: str = "", domain: str | None = None,
                                email_pool: list[str] | None = None,
                                custom_login_name: str | None = None) -> dict:
    """Generate an email based on strategy. Mirrors Rust EmailGenerator."""
    strategy = strategy.lower().replace("-", "_").replace(" ", "_")
    tag = hashlib.md5(str(_time.time()).encode()).hexdigest()[:8]

    if strategy == "single":
        return {"email": imap_user or "user@example.com", "strategy": "single"}
    elif strategy == "plus_alias":
        if not imap_user or "@" not in imap_user:
            return {"error": "imapUser required for plus_alias"}
        local, dom = imap_user.rsplit("@", 1)
        return {"email": f"{local}+{tag}@{dom}", "strategy": "plus_alias"}
    elif strategy in ("catch_all", "catchall"):
        dom = domain or (imap_user.rsplit("@", 1)[1] if "@" in imap_user else "example.com")
        prefix = custom_login_name or ''.join(random.choices(string.ascii_lowercase, k=10))
        return {"email": f"{prefix}@{dom}", "strategy": "catch_all"}
    elif strategy in ("gmail_dot_alias", "gmaildotalias"):
        if not imap_user or "@" not in imap_user:
            return {"error": "imapUser required for gmail_dot_alias"}
        local, dom = imap_user.rsplit("@", 1)
        if len(local) > 2:
            idx = random.randint(1, len(local) - 1)
            dotted = local[:idx] + "." + local[idx:]
        else:
            dotted = local + "." + tag[:4]
        return {"email": f"{dotted}@{dom}", "strategy": "gmail_dot_alias"}
    elif strategy == "pool":
        if not email_pool:
            return {"error": "emailPool required for pool strategy"}
        return {"email": random.choice(email_pool), "strategy": "pool"}
    else:
        # Fallback: random email
        return {"email": f"user_{tag}@example.com", "strategy": strategy}


@register_command("email_generate")
async def cmd_email_generate(params: dict) -> dict:
    """Generate email based on strategy. Mirrors Rust ``email_generate``."""
    request = params.get("request", params)
    strategy = request.get("strategy", "single")
    imap_user = request.get("imapUser", request.get("imap_user", ""))
    domain = request.get("domain")
    email_pool = request.get("emailPool", request.get("email_pool", []))
    custom_login_name = request.get("customLoginName", request.get("custom_login_name"))
    return _generate_email_by_strategy(strategy, imap_user, domain, email_pool, custom_login_name)


@register_command("email_generate_from_settings")
async def cmd_email_generate_from_settings(params: dict) -> dict:
    """Generate email from stored settings. Mirrors Rust ``email_generate_from_settings``."""
    from sqlalchemy import text as sql_text
    from stitch_backend.database import run_in_session

    async def _fetch(session):
        r = await session.execute(sql_text(
            "SELECT key, value FROM settings WHERE key IN ('email_strategy', 'imap_email', 'imap_server')"
        ))
        return {row[0]: row[1] for row in r.fetchall()}

    settings = await run_in_session(_fetch)
    strategy = settings.get("email_strategy", "single")
    imap_user = settings.get("imap_email", "")
    domain = settings.get("imap_server") or None
    return _generate_email_by_strategy(strategy, imap_user, domain)


@register_command("email_generate_from_settings_persistent")
async def cmd_email_generate_from_settings_persistent(params: dict) -> dict:
    """Generate email from settings with persistent counter. Mirrors Rust equivalent."""
    from sqlalchemy import text as sql_text
    from stitch_backend.database import run_in_session

    provider = params.get("provider", "default")

    async def _fetch(session):
        r = await session.execute(sql_text(
            "SELECT key, value FROM settings WHERE key IN ('email_strategy', 'imap_email', 'imap_server')"
        ))
        settings = {row[0]: row[1] for row in r.fetchall()}
        # Increment persistent counter
        await session.execute(sql_text(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) "
            "VALUES (:k, CAST(COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = :k), 0) + 1 AS TEXT), strftime('%s','now'))"
        ), {"k": f"email_counter_{provider}"})
        return settings

    settings = await run_in_session(_fetch)
    strategy = settings.get("email_strategy", "single")
    imap_user = settings.get("imap_email", "")
    domain = settings.get("imap_server") or None
    return _generate_email_by_strategy(strategy, imap_user, domain)


@register_command("email_test_strategies")
async def cmd_email_test_strategies(params: dict) -> list:
    """Test email generation with different strategies. Mirrors Rust ``email_test_strategies``."""
    results = []
    for strat, imap_user, domain, pool in [
        ("single", "test.user@gmail.com", None, None),
        ("plus_alias", "test.user@gmail.com", None, None),
        ("catch_all", "", "mydomain.ru", None),
        ("gmail_dot_alias", "testuser@gmail.com", None, None),
        ("pool", "", None, ["user1@mail.ru", "user2@mail.ru"]),
    ]:
        result = _generate_email_by_strategy(strat, imap_user, domain, pool)
        results.append([strat, result])
    return results


# ── Rust-style IMAP commands ──────────────────────────────────────────────────


@register_command("test_imap_connection_rust")
async def cmd_test_imap_connection_rust(params: dict) -> bool:
    """Test IMAP connection. Mirrors Rust ``test_imap_connection_rust``.

    Returns True on success, raises on failure.
    """
    import imaplib
    import ssl

    host = (params.get("host") or "").strip()
    port = int(params.get("port", 993))
    user = (params.get("user") or "").strip()
    password = (params.get("password") or "").strip()

    if not host or not user:
        raise ValueError("host, user, and password are required")

    ctx = ssl.create_default_context()
    with imaplib.IMAP4_SSL(host, port, ssl_context=ctx) as mail:
        mail.login(user, password)
        mail.select("INBOX")
        mail.close()
        mail.logout()
    return True


@register_command("get_verification_code_rust")
async def cmd_get_verification_code_rust(params: dict) -> str:
    """Poll IMAP for a verification code using stored settings.

    Mirrors Rust ``get_verification_code_rust``.
    """
    import asyncio
    import imaplib
    import re
    import ssl
    from sqlalchemy import text as sql_text
    from stitch_backend.database import run_in_session

    target_email = (params.get("targetEmail") or params.get("target_email") or "").strip()
    timeout_secs = int(params.get("timeoutSecs", params.get("timeout_secs", 300)))
    if not target_email:
        raise ValueError("targetEmail is required")

    # Fetch IMAP config from settings
    async def _fetch_config(session):
        r = await session.execute(sql_text(
            "SELECT key, value FROM settings WHERE key IN "
            "('imap_server', 'imap_user', 'imap_password', 'gmail_app_password')"
        ))
        return {row[0]: row[1] for row in r.fetchall()}

    settings = await run_in_session(_fetch_config)
    host_raw = settings.get("imap_server", "")
    user = settings.get("imap_user", "")
    is_gmail = "gmail" in host_raw
    password = settings.get("gmail_app_password") if is_gmail else settings.get("imap_password")
    if not host_raw or not user or not password:
        raise ValueError("IMAP not configured. Set imap_server, imap_user, and password in settings.")

    # Parse host:port
    if ":" in host_raw:
        parts = host_raw.split(":", 1)
        host, port = parts[0], int(parts[1])
    else:
        host, port = host_raw, 993

    # Poll for verification code
    code_pattern = re.compile(r'\b(\d{6})\b')
    deadline = _time.time() + timeout_secs
    ctx = ssl.create_default_context()

    while _time.time() < deadline:
        try:
            with imaplib.IMAP4_SSL(host, port, ssl_context=ctx) as mail:
                mail.login(user, password)
                mail.select("INBOX")
                _, msg_nums = mail.search(None, f'(TO "{target_email}")')
                for num in msg_nums[0].split()[-10:]:  # check last 10
                    _, data = mail.fetch(num, "(BODY[TEXT])")
                    if data and data[0]:
                        body = data[0][1].decode("utf-8", errors="replace") if isinstance(data[0], tuple) else ""
                        m = code_pattern.search(body)
                        if m:
                            mail.close()
                            mail.logout()
                            return m.group(1)
                mail.close()
                mail.logout()
        except Exception:
            pass
        await asyncio.sleep(3)

    raise TimeoutError(f"Verification code not found within {timeout_secs}s for {target_email}")


@register_command("get_verification_code_with_credentials")
async def cmd_get_verification_code_with_credentials(params: dict) -> str:
    """Poll IMAP for verification code with explicit credentials.

    Mirrors Rust ``get_verification_code_with_credentials``.
    """
    import asyncio
    import imaplib
    import re

    host = (params.get("host") or "").strip()
    port = int(params.get("port", 993))
    user = (params.get("user") or "").strip()
    password = (params.get("password") or "").strip()
    target_email = (params.get("targetEmail") or params.get("target_email") or "").strip()
    timeout_secs = int(params.get("timeoutSecs", params.get("timeout_secs", 300)))

    if not host or not user or not target_email:
        raise ValueError("host, user, password, and targetEmail are required")

    code_pattern = re.compile(r'\b(\d{6})\b')
    deadline = _time.time() + timeout_secs
    ctx = ssl.create_default_context()

    while _time.time() < deadline:
        try:
            with imaplib.IMAP4_SSL(host, port, ssl_context=ctx) as mail:
                mail.login(user, password)
                mail.select("INBOX")
                _, msg_nums = mail.search(None, f'(TO "{target_email}")')
                for num in msg_nums[0].split()[-10:]:
                    _, data = mail.fetch(num, "(BODY[TEXT])")
                    if data and data[0]:
                        body = data[0][1].decode("utf-8", errors="replace") if isinstance(data[0], tuple) else ""
                        m = code_pattern.search(body)
                        if m:
                            mail.close()
                            mail.logout()
                            return m.group(1)
                mail.close()
                mail.logout()
        except Exception:
            pass
        await asyncio.sleep(3)

    raise TimeoutError(f"Verification code not found within {timeout_secs}s for {target_email}")
