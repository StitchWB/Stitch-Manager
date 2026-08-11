"""Engine capability handlers for StepKind v2 (plan §4.3, §4.4).

Each capability is a pure function taking a step + dependencies and returning
a :class:`StepResult`.  Capabilities never touch the DB -- ``account.save``
only collects outputs from the store for the caller to persist.
"""

from __future__ import annotations

import email as email_mod
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..scenario.schema import ScenarioStep, SelectorCandidate

logger = logging.getLogger(__name__)


class ExecutorError(Exception):
    """Raised when the executor cannot proceed (e.g. totp.register v1.1)."""


@dataclass
class StepResult:
    """Result of executing one step."""

    step_id: str
    kind: str
    success: bool
    matched_candidate: int | None = None
    human_pause: bool = False
    human_pause_reason: str | None = None
    error: str | None = None
    skipped: bool = False
    skip_reason: str | None = None
    next_step_id: str | None = None
    terminal: bool = False
    meta: dict[str, Any] = field(default_factory=dict)


# ── selector helpers (shared with executor.py) ───────────────────────────


def build_selector(candidate: SelectorCandidate) -> str:
    """Build a DrissionPage selector string from kind + value.

    Conversion table (prepared_area/plugin_packages/README.md):
      css    → verbatim (DrissionPage auto-detects bare CSS)
      text   → text:{value}
      aria   → aria:{value}        (DrissionPage aria: prefix)
      testid → css:[data-testid="{value}"]
      attr   → @{value}            (e.g. @placeholder=..., @data-id=...)
      xpath  → verbatim (DrissionPage auto-detects bare XPath)
      role   → @:{value}          (legacy, not in README table)
    """
    k = candidate.kind.lower()
    v = candidate.value
    if k == "text":
        return f"text:{v}"
    if k == "testid":
        return f'css:[data-testid="{v}"]'
    if k == "attr":
        return f"@{v}"
    if k == "aria":
        return f"aria:{v}"
    if k == "role":
        return f"@:{v}"
    return v


def resolve_selector(
    browser: Any, step: ScenarioStep, timeout_s: float = 5.0
) -> tuple[Any, int | None]:
    """Try ``selector_candidates`` by weight desc.

    Returns ``(element, matched_index)`` where *matched_index* is the original
    position in ``step.selector_candidates`` (the ``matched_candidate`` sensor
    from plan §3.4), or ``(None, None)``.
    """
    indexed = list(enumerate(step.selector_candidates))
    indexed.sort(key=lambda pair: pair[1].weight, reverse=True)
    for original_index, candidate in indexed:
        try:
            elem = browser.ele(build_selector(candidate), timeout=timeout_s)
            if elem:
                return elem, original_index
        except Exception:  # noqa: BLE001
            continue
    return None, None


# ── extract ─────────────────────────────────────────────────────────────


def _cookie_value(browser: Any, name: str) -> str:
    for c in browser.cookies() or []:
        cn = c.get("name") if isinstance(c, dict) else getattr(c, "name", None)
        if cn == name:
            return c.get("value", "") if isinstance(c, dict) else getattr(c, "value", "")
    return ""


def extract_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Extract a value into the store (plan §4.3 extract)."""
    meta = step.meta or {}
    source = meta.get("from", "")
    name = meta.get("name", "")
    to_key = meta.get("to", "")
    if not source or not to_key:
        return StepResult(
            step.id, step.kind, False, error="extract: 'from' and 'to' required"
        )

    idx: int | None = None
    try:
        if source == "url_param":
            value = parse_qs(urlsplit(browser.url).query).get(name, [""])[0]
        elif source == "cookie":
            value = _cookie_value(browser, name)
        elif source in ("text", "attribute"):
            elem, idx = resolve_selector(browser, step, step.timeout_ms / 1000.0)
            if elem is None:
                return StepResult(
                    step.id, step.kind, False,
                    error="extract: element not found", matched_candidate=idx,
                )
            if source == "text":
                value = getattr(elem, "text", "") or ""
            else:
                value = elem.attr(meta.get("attr", "")) if hasattr(elem, "attr") else ""
        else:
            return StepResult(
                step.id, step.kind, False, error=f"extract: unknown source '{source}'"
            )
        store[to_key] = value
        return StepResult(step.id, step.kind, True, matched_candidate=idx, meta={"to": to_key})
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"extract: {e}")


# ── branch ─────────────────────────────────────────────────────────────


def branch_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Branch on a condition (plan §4.3 branch)."""
    meta = step.meta or {}
    condition = meta.get("if", "")
    then_id = meta.get("then", "")
    else_id = meta.get("else", "")
    idx: int | None = None

    try:
        if condition == "selector_exists":
            elem, idx = resolve_selector(browser, step, step.timeout_ms / 1000.0)
            matched = elem is not None
        elif condition == "url_contains":
            matched = meta.get("value", "") in (browser.url or "")
        elif condition == "var_equals":
            matched = store.get(meta.get("name", "")) == meta.get("value", "")
        else:
            return StepResult(
                step.id, step.kind, False, error=f"branch: unknown condition '{condition}'"
            )
        return StepResult(
            step.id, step.kind, True,
            next_step_id=then_id if matched else else_id,
            matched_candidate=idx if condition == "selector_exists" else None,
            meta={"condition": condition, "matched": matched},
        )
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"branch: {e}")


# ── imap.otp ───────────────────────────────────────────────────────────


def _default_imap_factory(imap_config: dict[str, Any]) -> Any:
    """Create a real ``imaplib.IMAP4_SSL`` connection from config."""
    import imaplib
    return imaplib.IMAP4_SSL(imap_config.get("host", ""), int(imap_config.get("port", 993)))


def _extract_body(msg: Any) -> str:
    """Extract text body from an ``email.message.Message``."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode("utf-8", errors="replace")
            elif ct == "text/html" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    body = re.sub(r"<[^>]*>", " ", payload.decode("utf-8", errors="replace"))
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")
    return body


def _poll_imap_once(
    conn_factory: Callable[[dict[str, Any]], Any],
    imap_config: dict[str, Any],
    subject_pattern: str,
    body_regex: str,
    recency_s: int,
) -> str | None:
    """Poll IMAP once for a verification code. Returns code or ``None``."""
    from email.utils import parsedate_to_datetime

    conn = conn_factory(imap_config)
    try:
        conn.login(imap_config.get("user", ""), imap_config.get("password", ""))
        conn.select("INBOX")
        status, data = conn.search(None, "ALL")
        if status != "OK" or not data[0]:
            return None
        msg_ids = data[0].split()
        subject_re = re.compile(subject_pattern) if subject_pattern else None
        for msg_id in reversed(msg_ids[-10:]):
            _, msg_data = conn.fetch(msg_id, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            msg = email_mod.message_from_bytes(msg_data[0][1])
            if subject_re and not subject_re.search(msg.get("Subject", "")):
                continue
            try:
                msg_date = parsedate_to_datetime(msg["Date"])
                if time.time() - msg_date.timestamp() > recency_s:
                    continue
            except Exception:  # noqa: BLE001
                pass
            match = re.search(body_regex, _extract_body(msg))
            if match:
                return match.group(1) if match.groups() else match.group(0)
        return None
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


def imap_otp_capability(
    step: ScenarioStep,
    imap_config: dict[str, Any] | None,
    imap_factory: Callable[[dict[str, Any]], Any] | None,
    store: dict[str, Any],
) -> StepResult:
    """Poll IMAP for a verification code (plan §4.3 imap.otp)."""
    meta = step.meta or {}
    to_key = meta.get("to", "otp.code")
    subject_pattern = meta.get("subject_pattern", "")
    body_regex = meta.get("body_regex", r"\b(\d{6})\b")
    recency_s = int(meta.get("recency_s", 600))
    poll_interval_s = float(meta.get("poll_interval_s", 5))
    timeout_s = int(meta.get("timeout_s", 120))

    if not imap_config:
        return StepResult(
            step.id, step.kind, False, error="imap.otp: no imap_config provided"
        )
    factory = imap_factory or _default_imap_factory
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            code = _poll_imap_once(
                factory, imap_config, subject_pattern, body_regex, recency_s
            )
            if code:
                store[to_key] = code
                return StepResult(step.id, step.kind, True, meta={"to": to_key})
        except Exception as e:  # noqa: BLE001
            logger.debug("imap.otp poll error: %s", e)
        time.sleep(poll_interval_s)
    return StepResult(
        step.id, step.kind, False,
        error="imap.otp: no verification code received within timeout",
    )


# ── captcha.solve ──────────────────────────────────────────────────────


def _resolve_turnstile_solver() -> type:
    """Resolve TurnstileSolver: engine-pack first, autoreg.captcha fallback."""
    from .engine_pack import get_solver_class

    cls = get_solver_class("turnstile", "TurnstileSolver")
    if cls is not None:
        return cls
    from ..captcha.turnstile import TurnstileSolver

    return TurnstileSolver


def _resolve_aliyun_solver() -> type:
    """Resolve AliyunSliderSolver: engine-pack first, autoreg.captcha fallback."""
    from .engine_pack import get_solver_class

    cls = get_solver_class("aliyun_slider", "AliyunSliderSolver")
    if cls is not None:
        return cls
    from ..captcha.aliyun_slider import AliyunSliderSolver

    return AliyunSliderSolver


def _solve_turnstile(browser: Any, step: ScenarioStep) -> bool:
    solver_cls = _resolve_turnstile_solver()
    timeout = int((step.meta or {}).get("timeout", 60))
    return bool(
        solver_cls(browser, log_callback=logger.info).solve(method="auto", timeout=timeout)
    )


def _solve_aliyun(browser: Any, step: ScenarioStep) -> bool:
    solver_cls = _resolve_aliyun_solver()
    max_attempts = int((step.meta or {}).get("max_attempts", 5))
    return bool(
        solver_cls(browser, log_callback=logger.info).solve(max_attempts=max_attempts)
    )


def _solve_im_human(browser: Any, step: ScenarioStep) -> bool:
    timeout = int((step.meta or {}).get("timeout", 60))
    click_fn = getattr(browser, "click_im_human_checkbox", None)
    return bool(click_fn(timeout=timeout)) if click_fn else False


_CAPTCHA_SOLVERS: dict[str, Callable[[Any, ScenarioStep], bool]] = {
    "turnstile": _solve_turnstile,
    "aliyun": _solve_aliyun,
    "im_human": _solve_im_human,
}


def captcha_solve_capability(step: ScenarioStep, browser: Any) -> StepResult:
    """Dispatch to a captcha solver (plan §4.3 captcha.solve)."""
    meta = step.meta or {}
    provider = meta.get("provider", "")
    optional = bool(meta.get("optional", False))
    solver = _CAPTCHA_SOLVERS.get(provider)

    if solver is None:
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"no solver for provider '{provider}' (optional)",
            )
        return StepResult(
            step.id, step.kind, False,
            error=f"captcha.solve: no solver for provider '{provider}'",
        )
    try:
        ok = solver(browser, step)
        if not ok and optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"solver '{provider}' failed (optional)",
                meta={"provider": provider},
            )
        if not ok:
            return StepResult(
                step.id, step.kind, False,
                error=f"captcha.solve: solver '{provider}' failed",
            )
        return StepResult(step.id, step.kind, True, meta={"provider": provider})
    except Exception as e:  # noqa: BLE001
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"solver '{provider}' error (optional)",
            )
        return StepResult(step.id, step.kind, False, error=f"captcha.solve: {e}")


# ── stripe.fill_checkout ───────────────────────────────────────────────


def stripe_fill_checkout_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Fill Stripe checkout form (plan §4.3). Human pause when no card."""
    meta = step.meta or {}
    card_number = store.get("card.number") or meta.get("card_number")
    card_expiry = store.get("card.expiry") or meta.get("card_expiry")
    card_cvc = store.get("card.cvc") or meta.get("card_cvc")
    if not (card_number and card_expiry and card_cvc):
        return StepResult(
            step.id, step.kind, True, human_pause=True,
            human_pause_reason=(
                "No card configured. Fill the Stripe form in the browser, "
                "then click Resume -- or click Skip to leave billing for later."
            ),
        )
    attach = getattr(browser, "attach_card_and_billing", None)
    if attach is None:
        return StepResult(
            step.id, step.kind, False,
            error="stripe.fill_checkout: browser does not support Stripe billing",
        )
    try:
        ok = attach(
            card_number=card_number, card_expiry=card_expiry, card_cvc=card_cvc,
            cardholder_name=store.get("card.holder") or meta.get("cardholder_name"),
            country=store.get("card.country") or meta.get("billing_country"),
            address_line1=store.get("card.address") or meta.get("billing_address"),
            city=store.get("card.city") or meta.get("billing_city"),
            zip_code=store.get("card.zip") or meta.get("billing_zip"),
            state=store.get("card.state") or meta.get("billing_state"),
        )
        if not ok:
            return StepResult(step.id, step.kind, False, error="stripe.fill_checkout: submit failed")
        return StepResult(step.id, step.kind, True, meta={"billing_added": True})
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"stripe.fill_checkout: {e}")


# ── totp.register ──────────────────────────────────────────────────────


def totp_register_capability(step: ScenarioStep) -> StepResult:
    """TOTP registration -- deferred to engine v1.1 (plan §4.3)."""
    if bool((step.meta or {}).get("optional", False)):
        return StepResult(
            step.id, step.kind, True, skipped=True,
            skip_reason="totp.register requires engine v1.1 (optional)",
        )
    raise ExecutorError("totp.register requires engine v1.1")


def account_save_capability(
    step: ScenarioStep, store: dict[str, Any]
) -> StepResult:
    """Collect outputs and mark terminal (plan §4.3, §4.4)."""
    meta = step.meta or {}
    output_keys = meta.get("outputs", [])
    if not isinstance(output_keys, list):
        output_keys = []
    outputs = {key: store.get(key) for key in output_keys}
    return StepResult(step.id, step.kind, True, terminal=True, meta={"outputs": outputs})
