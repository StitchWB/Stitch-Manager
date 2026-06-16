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
async def cmd_test_imap_connection(params: dict) -> dict:
    """Test IMAP connection with provided credentials.

    Ported from Rust ``test_imap_connection`` in python_commands.rs.
    Uses Python imaplib for the TLS connection test.
    """
    import imaplib
    import ssl

    server = (params.get("imapServer") or params.get("imap_server") or "").strip()
    user = (params.get("imapUser") or params.get("imap_user") or "").strip()
    password = (params.get("imapPassword") or params.get("imap_password") or "").strip()

    if not server or not user:
        return {"error": "imapServer and imapUser are required"}

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

    try:
        ctx = ssl.create_default_context()
        with imaplib.IMAP4_SSL(host, port, ssl_context=ctx) as mail:
            mail.login(user, password)
            return {"success": True, "message": f"Connected to {host}:{port}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


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
