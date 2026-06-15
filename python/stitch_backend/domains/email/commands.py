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
