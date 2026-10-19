"""firebase.auth capability: email/password → service API key exchange."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult, resolve_template

logger = logging.getLogger(__name__)


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
    step: ScenarioStep,
    store: dict[str, Any],
    proxy: str | None = None,
    *,
    login_direct: Callable[..., dict[str, Any]] | None = None,
    get_api_key: Callable[..., dict[str, Any]] | None = None,
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

    if login_direct is None:
        login_direct = _firebase_login_direct
    if get_api_key is None:
        get_api_key = _firebase_get_api_key

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
                tokens = login_direct(
                    requests_mod, firebase_api_key, email, password, proxy, timeout
                )
            id_token = tokens.get("idToken")
            if not id_token:
                last_error = "firebase.auth: no idToken in login response"
                continue

            key_info = get_api_key(
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
