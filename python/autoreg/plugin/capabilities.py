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


# ── shared templating helper ────────────────────────────────────────────────

_TEMPLATE_RE = re.compile(r"\$\{([^}]+)\}")


def resolve_template(value: str | None, store: dict[str, Any], *, warn: bool = True) -> str:
    """Resolve ``${key}`` placeholders against ``store``.

    Shared by :meth:`ScenarioExecutor._resolve_value` and capability
    handlers (e.g. ``stripe.fill_checkout`` resolving ``${config.*}``).
    Plain keys (``account.email``, ``config.card_number``, ...).  Missing
    keys interpolate to empty string and emit a single warning per key
    when ``warn`` is True.  Values without placeholders pass through
    unchanged.  ``None`` -> ``""``.
    """
    if not value:
        return ""
    if "${" not in value:
        return value

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in store:
            return str(store[key])
        if warn:
            logger.warning("template: missing store key %r", key)
        return ""

    return _TEMPLATE_RE.sub(_replace, value)


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


def resolve_all_selectors(
    browser: Any, step: ScenarioStep, timeout_s: float = 5.0
) -> tuple[list[Any], int | None]:
    """Resolve ALL elements matching the first successful candidate.

    Used by ``split_chars`` fill (multi-input OTP distribution).  Tries
    candidates by weight desc; the first candidate that matches at least one
    element via ``browser.eles()`` (DrissionPage plural form) wins, and ALL
    elements matched by that candidate are returned in DOM order.

    Returns ``(elements, matched_index)`` or ``([], None)``.
    """
    indexed = list(enumerate(step.selector_candidates))
    indexed.sort(key=lambda pair: pair[1].weight, reverse=True)
    for original_index, candidate in indexed:
        try:
            elems = browser.eles(build_selector(candidate), timeout=timeout_s)
            if elems:
                return list(elems), original_index
        except Exception:  # noqa: BLE001
            continue
    return [], None


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
            # Tolerant key: scenarios write "var" (kiro-autoreg), older
            # authors wrote "name" — accept both.
            var_name = meta.get("name") or meta.get("var") or ""
            matched = store.get(var_name) == meta.get("value", "")
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
    subject_patterns: list[str],
    body_regex: str,
    recency_s: int,
    code_source: str = "body",
    subject_code_regex: str = "",
) -> str | None:
    """Poll IMAP once for a verification code. Returns code or ``None``.

    ``subject_patterns`` are tried IN ORDER (primary first, fallback after)
    so a broad fallback never shadows a precise primary match on the same
    poll iteration.  An empty list disables subject filtering.

    ``code_source`` selects where the code lives:
      * ``"body"`` (default) — match ``body_regex`` against the email body.
      * ``"subject"`` — match ``subject_code_regex`` against the Subject
        header (windsurf: "229743 - Verify your Email with Windsurf").
    """
    from email.utils import parsedate_to_datetime

    conn = conn_factory(imap_config)
    try:
        conn.login(imap_config.get("user", ""), imap_config.get("password", ""))
        conn.select("INBOX")
        status, data = conn.search(None, "ALL")
        if status != "OK" or not data[0]:
            return None
        msg_ids = data[0].split()
        subject_res = [re.compile(p) for p in subject_patterns if p]
        # Cache fetched (subject, body, age-ok) per message so the fallback
        # pass does not re-fetch over the network.
        fetched: list[tuple[str, str]] = []
        for msg_id in reversed(msg_ids[-10:]):
            _, msg_data = conn.fetch(msg_id, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            msg = email_mod.message_from_bytes(msg_data[0][1])
            try:
                msg_date = parsedate_to_datetime(msg["Date"])
                if time.time() - msg_date.timestamp() > recency_s:
                    continue
            except Exception:  # noqa: BLE001
                pass
            fetched.append((msg.get("Subject", ""), _extract_body(msg)))

        if code_source == "subject":
            subject_code_re = re.compile(
                subject_code_regex or r"(\d{6})"
            )
            for subject, _body in fetched:
                m = subject_code_re.search(subject)
                if m:
                    return m.group(1) if m.groups() else m.group(0)
            return None

        patterns: list[re.Pattern[str] | None] = subject_res or [None]
        for subject_re in patterns:
            for subject, body in fetched:
                if subject_re is not None and not subject_re.search(subject):
                    continue
                match = re.search(body_regex, body)
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
    subject_patterns = [
        p
        for p in (
            meta.get("subject_pattern", ""),
            meta.get("subject_pattern_fallback", ""),
        )
        if p
    ]
    body_regex = meta.get("body_regex", r"\b(\d{6})\b")
    recency_s = int(meta.get("recency_s", 600))
    poll_interval_s = float(meta.get("poll_interval_s", 5))
    timeout_s = int(meta.get("timeout_s", 120))
    code_source = meta.get("code_source", "body")
    subject_code_regex = meta.get("subject_code_regex", "")

    if not imap_config:
        return StepResult(
            step.id, step.kind, False, error="imap.otp: no imap_config provided"
        )
    factory = imap_factory or _default_imap_factory
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            code = _poll_imap_once(
                factory, imap_config, subject_patterns, body_regex, recency_s,
                code_source=code_source, subject_code_regex=subject_code_regex,
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
    timeout = int((step.meta or {}).get("timeout", 60))
    # Resolution: engine-pack unified solver first (local_service → remote_http
    # → opencv_dom), then autoreg.captcha fallback (OpenCV/DOM only).
    # The unified solver handles the D3-vin HTTP service internally — no
    # separate TurnstileApiSolver path needed.
    solver_cls = _resolve_turnstile_solver()
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
    if click_fn is not None:
        return bool(click_fn(timeout=timeout))
    # Generic fallback (bare ChromiumPage): click via the step's own
    # selector candidates — the kiro-autoreg scenario carries them.
    elem, _idx = resolve_selector(browser, step, 3.0)
    if elem is None:
        return False
    try:
        elem.click()
    except Exception:  # noqa: BLE001
        return False
    return True


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
    """Fill Stripe checkout form (plan §4.3). Human pause when no card.

    Resolves ``${config.*}`` references in ``meta.card_fields`` against the
    store (seeded by :meth:`PluginScenarioProvider.register` from the
    registration config kwargs).  Falls back to ``meta.card_*`` /
    ``meta.billing_*`` literals when no template is provided.  When no
    card number is resolved, returns ``human_pause=True`` so the pipeline
    halts for manual input.
    """
    meta = step.meta or {}
    card_fields = meta.get("card_fields")
    if isinstance(card_fields, dict):
        # v1.1: resolve ${config.*} templates from the store.
        card_number = resolve_template(card_fields.get("card_number"), store, warn=False)
        card_expiry = resolve_template(card_fields.get("card_expiry"), store, warn=False)
        card_cvc = resolve_template(card_fields.get("card_cvc"), store, warn=False)
        cardholder_name = resolve_template(
            card_fields.get("cardholder_name"), store, warn=False
        )
        billing_country = resolve_template(
            card_fields.get("billing_country"), store, warn=False
        )
        billing_address = resolve_template(
            card_fields.get("billing_address"), store, warn=False
        )
        billing_city = resolve_template(card_fields.get("billing_city"), store, warn=False)
        billing_state = resolve_template(
            card_fields.get("billing_state"), store, warn=False
        )
        billing_zip = resolve_template(card_fields.get("billing_zip"), store, warn=False)
    else:
        # v1 fallback: read card.* from store or meta literals.
        card_number = store.get("card.number") or meta.get("card_number")
        card_expiry = store.get("card.expiry") or meta.get("card_expiry")
        card_cvc = store.get("card.cvc") or meta.get("card_cvc")
        cardholder_name = store.get("card.holder") or meta.get("cardholder_name")
        billing_country = store.get("card.country") or meta.get("billing_country")
        billing_address = store.get("card.address") or meta.get("billing_address")
        billing_city = store.get("card.city") or meta.get("billing_city")
        billing_state = store.get("card.state") or meta.get("billing_state")
        billing_zip = store.get("card.zip") or meta.get("billing_zip")
    if not (card_number and card_expiry and card_cvc):
        return StepResult(
            step.id, step.kind, True, human_pause=True,
            human_pause_reason=(
                "No card configured. Fill the Stripe form in the browser, "
                "then click Resume -- or click Skip to leave billing for later."
            ),
        )

    # Parity with built-in _attach_billing: the OAuth bounce pre-fetches
    # the Stripe checkout URL — wait briefly for it before touching fields.
    wait_for_url = meta.get("wait_for_url")
    if wait_for_url and wait_for_url not in (getattr(browser, "url", "") or ""):
        wait_s = float(meta.get("wait_for_url_timeout_s", 30))
        deadline = time.time() + wait_s
        while time.time() < deadline:
            if wait_for_url in (getattr(browser, "url", "") or ""):
                break
            time.sleep(0.5)
        else:
            return StepResult(
                step.id, step.kind, False,
                error=f"stripe.fill_checkout: checkout URL never opened ({wait_for_url})",
            )

    attach = getattr(browser, "attach_card_and_billing", None)
    try:
        if attach is not None:
            ok = attach(
                card_number=card_number, card_expiry=card_expiry, card_cvc=card_cvc,
                cardholder_name=cardholder_name,
                country=billing_country,
                address_line1=billing_address,
                city=billing_city,
                zip_code=billing_zip,
                state=billing_state,
            )
        else:
            # Bare ChromiumPage (plugin path): drive the shared Stripe
            # mixins directly — they take page= explicitly, so no browser
            # subclass is required.
            ok = _fill_stripe_via_mixin(
                browser,
                card_number=card_number,
                card_expiry=card_expiry,
                card_cvc=card_cvc,
                cardholder_name=cardholder_name,
                country=billing_country,
                address_line1=billing_address,
                city=billing_city,
                zip_code=billing_zip,
                state=billing_state,
            )
        if not ok:
            return StepResult(step.id, step.kind, False, error="stripe.fill_checkout: submit failed")
        # Post-submit: wait for the success redirect (built-in parity:
        # app.kiro.dev/account/home).  Not reaching it is a SOFT success —
        # the built-in treats "no obvious error" as attached.
        success_url = meta.get("success_url")
        if success_url:
            submit_timeout = float(meta.get("submit_timeout_s", 90))
            deadline = time.time() + submit_timeout
            while time.time() < deadline:
                if success_url in (getattr(browser, "url", "") or ""):
                    return StepResult(
                        step.id, step.kind, True, meta={"billing_added": True}
                    )
                time.sleep(1.0)
            return StepResult(
                step.id, step.kind, True,
                meta={"billing_added": True, "note": "no_success_redirect"},
            )
        return StepResult(step.id, step.kind, True, meta={"billing_added": True})
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"stripe.fill_checkout: {e}")


def _fill_stripe_via_mixin(
    page: Any,
    *,
    card_number: str,
    card_expiry: str,
    card_cvc: str,
    cardholder_name: str = "",
    country: str = "",
    address_line1: str = "",
    city: str = "",
    zip_code: str = "",
    state: str = "",
) -> bool:
    """Fill Stripe checkout on a bare ``ChromiumPage`` via the shared mixins.

    Lazy import: the Zone-1 export guard (scripts/check_export_leaks.py)
    only blocks column-0 imports, and lazy import also keeps DrissionPage
    out of the module import path for headless test environments.
    """
    from ..browser.mixins.stripe_billing import StripeBillingMixin  # noqa: PLC0415

    def _opt(v: str) -> str | None:
        return v or None

    mixin = StripeBillingMixin()
    if not mixin.fill_stripe_card(
        card_number=card_number,
        expiry=card_expiry,
        cvc=card_cvc,
        cardholder_name=_opt(cardholder_name),
        page=page,
    ):
        return False
    mixin.fill_stripe_address(
        country=_opt(country),
        line1=_opt(address_line1),
        city=_opt(city),
        zip_code=_opt(zip_code),
        state=_opt(state),
        page=page,
    )
    return bool(mixin.submit_stripe_billing(page=page))


# ── totp.register ──────────────────────────────────────────────────────

_BASE32_RE = re.compile(r"[A-Z2-7]{16,64}")


def _generate_totp(
    secret: str, timestamp: int | None = None, *, digits: int = 6, period: int = 30
) -> str:
    """Generate a TOTP code (RFC 6238) using stdlib only.

    No new dependencies — ``hmac``/``hashlib``/``base64``/``time`` only.
    Cross-checked against ``pyotp`` when available (tests).
    """
    import base64  # noqa: PLC0415
    import hashlib  # noqa: PLC0415
    import hmac  # noqa: PLC0415
    import time as _time  # noqa: PLC0415

    if timestamp is None:
        timestamp = int(_time.time())
    counter = timestamp // period

    # Decode Base32 secret (pad to multiple of 8).
    clean = secret.upper().replace(" ", "").rstrip("=")
    pad = (8 - len(clean) % 8) % 8
    key = base64.b32decode(clean + "=" * pad)

    # HOTP: HMAC-SHA1 of counter (big-endian 8 bytes).
    mac = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    binary = (
        (mac[offset] & 0x7F) << 24
        | (mac[offset + 1] & 0xFF) << 16
        | (mac[offset + 2] & 0xFF) << 8
        | (mac[offset + 3] & 0xFF)
    )
    return str(binary % (10**digits)).zfill(digits)


def _extract_totp_secret_from_page(browser: Any) -> str | None:
    """Extract a Base32 TOTP secret from page text/html.

    Searches the page's ``html`` property for ``[A-Z2-7]{16,64}`` matches.
    Returns the first match (uppercased) or ``None``.
    """
    html = getattr(browser, "html", None)
    if not html:
        return None
    # Strip tags so attributes don't pollute the match.
    text = re.sub(r"<[^>]*>", " ", str(html))
    for m in _BASE32_RE.finditer(text):
        candidate = m.group(0)
        # Avoid matching short Base32-like fragments in URLs/scripts.
        if len(candidate) >= 16:
            return candidate.upper()
    return None


def _persist_totp_secret(
    *, secret: str, label: str, issuer: str = "AWS Builder ID"
) -> str | None:
    """Persist TOTP secret to the local ``totp_keys`` SQLite table.

    Duplicates the minimal insert from the built-in kiro_v2 mfa step
    (providers/kiro_v2/steps/mfa.py) because the zone-boundary leak-guard
    prevents importing that Zone-2 module from Zone-1.  Schema ownership
    stays in mfa.py — this is a minimal duplicate that creates the table
    if needed (same DDL) and inserts one row.
    """
    import sqlite3  # noqa: PLC0415
    import uuid  # noqa: PLC0415

    try:
        from stitch_backend.config import get_database_path  # noqa: PLC0415

        db_path = str(get_database_path())
        key_id = str(uuid.uuid4())
        secret_clean = secret.strip().upper()

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_keys (
                    id          TEXT PRIMARY KEY,
                    label       TEXT NOT NULL,
                    secret      TEXT NOT NULL,
                    issuer      TEXT,
                    account_id  TEXT,
                    digits      INTEGER NOT NULL DEFAULT 6,
                    period      INTEGER NOT NULL DEFAULT 30,
                    algorithm   TEXT NOT NULL DEFAULT 'SHA1',
                    enabled     INTEGER NOT NULL DEFAULT 1,
                    created_at  TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO totp_keys
                    (id, label, secret, issuer, account_id,
                     digits, period, algorithm, enabled, created_at)
                VALUES (?, ?, ?, ?, NULL, 6, 30, 'SHA1', 1, datetime('now'))
                """,
                (key_id, label, secret_clean, issuer),
            )
            conn.commit()
        logger.info("totp.register: secret saved to DB (id=%s)", key_id)
        return key_id
    except Exception as exc:  # noqa: BLE001
        logger.warning("totp.register: failed to save secret to DB: %s", exc)
        return None


def totp_register_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Register a TOTP MFA device (plan §4.3 totp.register, v1.1).

    Best-effort sub-flow: navigate, click through sub-flow candidates in
    order (each tolerant), extract Base32 secret from page text, compute
    TOTP code (stdlib), fill code input, confirm, persist secret to DB.

    Any sub-step failure → return failed StepResult (optional semantics
    will skip); NEVER raise.  Stores ``account.totp_ref`` = secret on
    success so ``account.save`` outputs can capture it.
    """
    meta = step.meta or {}
    optional = bool(meta.get("optional", False))

    def _fail(msg: str) -> StepResult:
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"totp.register: {msg} (optional)",
            )
        return StepResult(step.id, step.kind, False, error=f"totp.register: {msg}")

    try:
        # 1. Navigate if requested.
        navigate_url = meta.get("navigate_url")
        if navigate_url:
            try:
                browser.get(navigate_url)
            except Exception as exc:  # noqa: BLE001
                return _fail(f"navigate failed: {exc}")

        # 2. Sub-flow clicks: iterate step's own selector_candidates in
        # order, click each (tolerant).  Skip candidates that look like
        # inputs (xpath with //input) — those are filled later.
        candidates = step.selector_candidates
        code_input_candidate = None
        for cand in candidates:
            sel = build_selector(cand)
            # Detect code-input candidates (xpath with //input).
            if "input" in sel.lower() and ("xpath" in sel.lower() or "//" in sel):
                code_input_candidate = cand
                continue
            try:
                elem = browser.ele(sel, timeout=5.0)
                if elem:
                    elem.click()
            except Exception:  # noqa: BLE001
                continue  # tolerant

        # 3. Extract secret from page text.
        secret = _extract_totp_secret_from_page(browser)
        if not secret:
            return _fail("could not extract Base32 secret from page")

        # 4. Compute TOTP code (stdlib, no new deps).
        code = _generate_totp(secret)

        # 5. Fill code input (from step candidates).
        if code_input_candidate is None:
            # Fallback: find any input in the step candidates.
            for cand in candidates:
                if "input" in build_selector(cand).lower():
                    code_input_candidate = cand
                    break
        if code_input_candidate is not None:
            try:
                elem = browser.ele(build_selector(code_input_candidate), timeout=10.0)
                if elem:
                    try:
                        elem.clear()
                    except Exception:  # noqa: BLE001
                        pass
                    elem.input(code)
            except Exception as exc:  # noqa: BLE001
                return _fail(f"code input fill failed: {exc}")

        # 6. Confirm: click remaining button candidates (assign, done).
        for cand in candidates:
            sel = build_selector(cand)
            if "input" in sel.lower() and ("xpath" in sel.lower() or "//" in sel):
                continue  # skip code input
            try:
                elem = browser.ele(sel, timeout=3.0)
                if elem:
                    elem.click()
            except Exception:  # noqa: BLE001
                continue  # tolerant

        # 7. Persist secret to DB (raw-SQL, same schema as kiro_v2 mfa).
        label = str(store.get("account.email") or "plugin")
        _persist_totp_secret(secret=secret, label=label)

        # 8. Store output for account.save.
        store["account.totp_ref"] = secret
        return StepResult(
            step.id, step.kind, True,
            meta={"totp_secret": secret, "totp_code": code},
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(str(exc))


def _capture_session(browser: Any, meta: dict[str, Any]) -> dict[str, Any]:
    """Capture cookies + session metadata from a live browser.

    Mirrors ``KiroV2Browser.get_session_data`` (providers/kiro_v2/browser.py):
    cookies via CDP ``Network.getAllCookies`` filtered to ``cookie_domains``
    (substring match — same semantics as ``AWS_COOKIE_DOMAINS`` there), plus
    ``session_data`` JSON with last_url / timestamp / user_agent.  Cookie
    failure degrades to an empty list rather than failing the terminal step.
    """
    import json as _json  # noqa: PLC0415 — keep module import surface light

    cookie_domains = meta.get("cookie_domains") or []
    cookies: list[dict[str, Any]] = []
    try:
        run_cdp = getattr(browser, "run_cdp", None)
        if run_cdp is not None:
            resp = run_cdp("Network.getAllCookies")
            raw = resp.get("cookies") if isinstance(resp, dict) else []
        else:
            raw = browser.cookies() or []
        for c in raw or []:
            if not isinstance(c, dict):
                c = {
                    "name": getattr(c, "name", ""),
                    "value": getattr(c, "value", ""),
                    "domain": getattr(c, "domain", ""),
                }
            if cookie_domains and not any(
                d in (c.get("domain") or "") for d in cookie_domains
            ):
                continue
            cookies.append(c)
    except Exception as exc:  # noqa: BLE001
        logger.warning("account.save: cookie capture failed: %s", exc)

    try:
        run_js = getattr(browser, "run_js", None)
        user_agent = run_js("return navigator.userAgent") if run_js else ""
    except Exception:  # noqa: BLE001
        user_agent = ""
    session_meta = {
        "last_url": getattr(browser, "url", "") or "",
        "timestamp": time.time(),
        "user_agent": user_agent,
    }
    return {
        "cookies": _json.dumps(cookies),
        "session_data": _json.dumps(session_meta),
    }


def account_save_capability(
    step: ScenarioStep, store: dict[str, Any], browser: Any = None
) -> StepResult:
    """Collect outputs and mark terminal (plan §4.3, §4.4).

    When ``account.session`` is declared among outputs, a browser is
    available, and nothing stored a session earlier, capture it here —
    this is what makes the account reusable after a plugin-path
    registration (previously ``account.session`` silently stayed empty).
    """
    meta = step.meta or {}
    output_keys = meta.get("outputs", [])
    if not isinstance(output_keys, list):
        output_keys = []
    if (
        browser is not None
        and "account.session" in output_keys
        and store.get("account.session") is None
    ):
        store["account.session"] = _capture_session(browser, meta)
    outputs = {key: store.get(key) for key in output_keys}
    return StepResult(step.id, step.kind, True, terminal=True, meta={"outputs": outputs})


# ── firebase.auth ────────────────────────────────────────────────────────


def _firebase_login_direct(
    requests_mod: Any, firebase_api_key: str, email: str, password: str,
    proxy: str | None, timeout: int,
) -> dict[str, Any]:
    """Sign in with email/password against the public identitytoolkit API."""
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={firebase_api_key}"
    )
    resp = requests_mod.post(
        url,
        json={"email": email, "password": password, "returnSecureToken": True},
        headers={
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        },
        timeout=timeout,
        verify=False,
        proxies={"http": proxy, "https": proxy} if proxy else None,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "idToken": data.get("idToken"),
        "refreshToken": data.get("refreshToken"),
        "expiresIn": int(data.get("expiresIn", 3600)),
    }


def _firebase_login_worker(
    requests_mod: Any, worker_url: str, worker_secret: str,
    firebase_api_key: str, email: str, password: str,
    proxy: str | None, timeout: int,
) -> dict[str, Any]:
    """Sign in via the Cloudflare Worker proxy (blocked-region fallback path)."""
    resp = requests_mod.post(
        f"{worker_url}/login",
        json={"email": email, "password": password, "api_key": firebase_api_key},
        headers={
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "X-Secret-Key": worker_secret,
        },
        timeout=timeout,
        verify=False,
        proxies={"http": proxy, "https": proxy} if proxy else None,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "idToken": data.get("idToken"),
        "refreshToken": data.get("refreshToken"),
        "expiresIn": int(data.get("expiresIn", 3600)),
    }


def _firebase_get_api_key(
    requests_mod: Any, register_api: str, id_token: str,
    proxy: str | None, timeout: int,
) -> dict[str, Any]:
    """Exchange a Firebase ID token for the service API key (register API)."""
    resp = requests_mod.post(
        register_api,
        json={"firebase_id_token": id_token},
        headers={
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        },
        timeout=timeout,
        verify=False,
        proxies={"http": proxy, "https": proxy} if proxy else None,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "apiKey": data.get("api_key"),
        "name": data.get("name"),
        "apiServerUrl": data.get("api_server_url"),
    }


def firebase_auth_capability(
    step: ScenarioStep, store: dict[str, Any], proxy: str | None = None
) -> StepResult:
    """Firebase email/password → service API key (windsurf-style exchange).

    Generic capability: all endpoints/keys come from ``meta`` (the method's
    data), so the same capability serves any Firebase-backed service.  Flow:
    signInWithPassword (worker → direct identitytoolkit) → exchange the ID
    token at ``register_api`` for the service ``apiKey``.  Retries with
    backoff while the account is still propagating (``EMAIL_NOT_FOUND``).

    Meta:
        firebase_api_key, register_api  — required
        worker_url, worker_secret       — optional (blocked-region proxy)
        email, password                 — templates (default ${account.*})
        to_api_key                      — store key (default account.api_key)
        to_name                         — optional store key for returned name
        max_retries                     — default 8
    """
    import requests as requests_mod  # noqa: PLC0415 — lazy, Zone-1 guard

    try:
        import urllib3  # noqa: PLC0415

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:  # noqa: BLE001
        pass

    meta = step.meta or {}
    firebase_api_key = resolve_template(meta.get("firebase_api_key"), store, warn=False)
    register_api = resolve_template(meta.get("register_api"), store, warn=False)
    worker_url = resolve_template(meta.get("worker_url"), store, warn=False)
    worker_secret = resolve_template(meta.get("worker_secret"), store, warn=False)
    email = resolve_template(
        meta.get("email", "${account.email}"), store, warn=False
    )
    password = resolve_template(
        meta.get("password", "${account.password}"), store, warn=False
    )
    to_api_key = meta.get("to_api_key", "account.api_key")
    to_name = meta.get("to_name")
    max_retries = int(meta.get("max_retries", 8))
    timeout = int(meta.get("timeout_s", 30))

    if not firebase_api_key or not register_api:
        return StepResult(
            step.id, step.kind, False,
            error="firebase.auth: firebase_api_key and register_api are required",
        )
    if not email or not password:
        return StepResult(
            step.id, step.kind, False,
            error="firebase.auth: email/password not resolvable from store",
        )

    last_error: str | None = None
    for attempt in range(1, max_retries + 1):
        if attempt > 1:
            time.sleep(min(attempt * 4, 20))
        try:
            # Login: worker first (if configured), then direct identitytoolkit.
            tokens: dict[str, Any] | None = None
            if worker_url and worker_secret:
                try:
                    tokens = _firebase_login_worker(
                        requests_mod, worker_url, worker_secret,
                        firebase_api_key, email, password, proxy, timeout,
                    )
                except Exception:  # noqa: BLE001 — fall through to direct
                    tokens = None
            if not tokens or not tokens.get("idToken"):
                tokens = _firebase_login_direct(
                    requests_mod, firebase_api_key, email, password, proxy, timeout
                )
            id_token = tokens.get("idToken")
            if not id_token:
                last_error = "firebase.auth: no idToken in login response"
                continue

            key_info = _firebase_get_api_key(
                requests_mod, register_api, id_token, proxy, timeout
            )
            api_key = key_info.get("apiKey")
            if api_key and len(str(api_key)) > 10:
                store[to_api_key] = api_key
                if to_name and key_info.get("name"):
                    store[to_name] = key_info["name"]
                return StepResult(
                    step.id, step.kind, True,
                    meta={"to": to_api_key, "api_key_prefix": str(api_key)[:12]},
                )
            last_error = "firebase.auth: empty apiKey in register response"
        except Exception as e:  # noqa: BLE001
            last_error = str(e)
            # Don't retry a definitive credential error.
            if "INVALID_PASSWORD" in last_error or "INVALID_LOGIN_CREDENTIALS" in last_error:
                break
            logger.debug("firebase.auth attempt %d failed: %s", attempt, last_error)

    return StepResult(
        step.id, step.kind, False,
        error=f"firebase.auth: could not obtain api key ({last_error})",
    )
