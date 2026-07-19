"""Bidirectional Kiro IDE auth-token sync (ported from Kiro-account-manager kiroAuthSync.ts).

Kiro IDE persists its token to ``~/.aws/sso/cache/kiro-auth-token.json`` and
watches that file with its own refresh loop. Stitch Manager must treat this
file as the single source of truth, otherwise we get the classic bug:

    Stitch refreshes token -> gets refreshToken_v2
    but writes refreshToken_v1 (already rotated/invalid) to disk
    -> IDE uses v1 against OIDC in ~1h -> 401 -> logoutAndForget()

This module mirrors the IDE file format exactly (mode 0o600, field ordering,
IdC client-registration file) and provides a content-debounced watcher so when
the IDE self-refreshes, Stitch can reverse-sync the new token back into its
own account store.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Any, Callable, TypedDict

KIRO_SSO_CACHE_DIR = Path.home() / ".aws" / "sso" / "cache"
KIRO_AUTH_TOKEN_PATH = KIRO_SSO_CACHE_DIR / "kiro-auth-token.json"

_KIRO_DEFAULT_START_URL = "https://view.awsapps.com/start"
_KIRO_OIDC_SCOPES = [
    "codewhisperer:completions",
    "codewhisperer:analysis",
    "codewhisperer:conversations",
    "codewhisperer:transformations",
    "codewhisperer:taskassist",
]

# Placeholder ARN the Kiro IDE source code hardcodes for BuilderId accounts.
# The IDE internal logic depends on this field existing; removing it breaks IDE.
KIRO_BUILDER_ID_PLACEHOLDER_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX"
# Social login (Github/Google) shared fixed Kiro backend profileArn.
KIRO_SOCIAL_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"

_ENTERPRISE_FALLBACK_PROFILE_ID = "VNECVYCYYAWN"
_ENTERPRISE_FALLBACK_ACCOUNT_ID = "610548660232"

_PLACEHOLDER_PROFILE_ARNS = {KIRO_BUILDER_ID_PLACEHOLDER_ARN}


def get_enterprise_fallback_arn(region: str | None = None) -> str:
    r = "eu-central-1" if (region or "").startswith("eu-") else "us-east-1"
    return f"arn:aws:codewhisperer:{r}:{_ENTERPRISE_FALLBACK_ACCOUNT_ID}:profile/{_ENTERPRISE_FALLBACK_PROFILE_ID}"


def is_placeholder_profile_arn(arn: str | None) -> bool:
    return bool(arn) and arn in _PLACEHOLDER_PROFILE_ARNS


def resolve_profile_arn_for_write(
    *,
    profile_arn: str | None = None,
    auth_method: str | None = None,
    provider: str | None = None,
    region: str | None = None,
) -> str | None:
    """Unified decision: what profileArn should be written to disk.

    Priority:
      1. caller gives a non-placeholder profileArn -> use it
      2. social/Github/Google -> fixed Kiro Social profileArn
      3. Enterprise/external_idp -> region-aware fallback ARN
      4. BuilderId / other -> Kiro IDE placeholder ARN (IDE needs this field)
    """
    if profile_arn and not is_placeholder_profile_arn(profile_arn):
        return profile_arn
    if auth_method == "social" or provider in ("Github", "Google"):
        return KIRO_SOCIAL_PROFILE_ARN
    if provider == "Enterprise" or auth_method == "external_idp":
        return get_enterprise_fallback_arn(region)
    return KIRO_BUILDER_ID_PLACEHOLDER_ARN


def _compute_client_id_hash(start_url: str | None) -> str:
    return hashlib.sha1(
        json.dumps({"startUrl": start_url or _KIRO_DEFAULT_START_URL}).encode("utf-8")
    ).hexdigest()


class WriteKiroAuthTokenInput(TypedDict, total=False):
    access_token: str
    refresh_token: str
    expires_at_iso: str
    auth_method: str  # 'IdC' | 'social'
    provider: str
    region: str
    start_url: str
    client_id: str
    client_secret: str
    profile_arn: str


def write_kiro_auth_token_file(input: WriteKiroAuthTokenInput) -> dict[str, str]:
    """Write token file in a format byte-compatible with Kiro IDE (mode 0o600)."""
    KIRO_SSO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    client_id_hash = _compute_client_id_hash(input.get("start_url"))
    auth_method = input.get("auth_method")
    provider = input.get("provider", "")
    profile_arn = input.get("profile_arn")

    if auth_method == "social":
        token_data: dict[str, Any] = {
            "accessToken": input["access_token"],
            "refreshToken": input["refresh_token"],
            "profileArn": profile_arn,
            "expiresAt": input["expires_at_iso"],
            "authMethod": auth_method,
            "provider": provider,
        }
    else:
        token_data = {
            "accessToken": input["access_token"],
            "refreshToken": input["refresh_token"],
            "expiresAt": input["expires_at_iso"],
            "clientIdHash": client_id_hash,
            "authMethod": auth_method or "IdC",
            "provider": provider,
            "region": input.get("region") or "us-east-1",
            "profileArn": profile_arn,
        }

    # Defensive: never write a placeholder ARN that bypassed the resolver.
    if is_placeholder_profile_arn(token_data.get("profileArn")):
        token_data["profileArn"] = None

    _write_text(KIRO_AUTH_TOKEN_PATH, json.dumps(token_data, indent=2))

    client_reg_path: str | None = None
    if auth_method != "social" and input.get("client_id") and input.get("client_secret"):
        client_reg_path = str(KIRO_SSO_CACHE_DIR / f"{client_id_hash}.json")
        client_expires_at = (
            # IDE uses ISO without trailing Z
            __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
            .isoformat()
            .replace("Z", "")
        )
        client_data = {
            "clientId": input["client_id"],
            "clientSecret": input["client_secret"],
            "expiresAt": client_expires_at,
            "scopes": _KIRO_OIDC_SCOPES,
        }
        _write_text(Path(client_reg_path), json.dumps(client_data, indent=2))

    return {
        "token_path": str(KIRO_AUTH_TOKEN_PATH),
        **({"client_reg_path": client_reg_path} if client_reg_path else {}),
    }


def _write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass  # Windows: chmod is a no-op; Linux/macOS enforce perms


def read_kiro_auth_token_file() -> dict[str, Any] | None:
    try:
        data = json.loads(KIRO_AUTH_TOKEN_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not data.get("accessToken") or not data.get("refreshToken"):
        return None
    return data


def parse_access_token_claims(access_token: str) -> dict[str, str] | None:
    """Decode JWT payload (no signature check) for reverse account matching."""
    if not access_token:
        return None
    parts = access_token.split(".")
    if len(parts) < 2:
        return None
    try:
        import base64

        b64 = parts[1].replace("-", "+").replace("_", "/")
        while len(b64) % 4:
            b64 += "="
        claims = json.loads(base64.b64decode(b64).decode("utf-8"))
        aud_raw = claims.get("aud")
        if isinstance(aud_raw, str):
            aud = aud_raw
        elif isinstance(aud_raw, list) and aud_raw and isinstance(aud_raw[0], str):
            aud = aud_raw[0]
        else:
            aud = None
        return {
            "sub": claims.get("sub") if isinstance(claims.get("sub"), str) else None,
            "email": claims.get("email") if isinstance(claims.get("email"), str) else None,
            "aud": aud,
            "preferred_username": claims.get("preferred_username")
            if isinstance(claims.get("preferred_username"), str)
            else None,
        }
    except Exception:
        return None


class KiroAuthTokenWatcher:
    """Content-debounced watcher for the IDE token file (reverse-sync source)."""

    def __init__(self, interval_ms: int = 2000) -> None:
        self._interval = interval_ms / 1000.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_sig = ""
        self._on_change: Callable[[dict[str, Any]], Any] | None = None

    def start(self, on_change: Callable[[dict[str, Any]], Any]) -> None:
        self._on_change = on_change
        token = read_kiro_auth_token_file()
        if token:
            self._last_sig = f"{token.get('accessToken')}|{token.get('refreshToken')}"
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        import time

        while not self._stop.is_set():
            if self._stop.wait(self._interval):
                break
            try:
                token = read_kiro_auth_token_file()
                if not token:
                    continue
                sig = f"{token.get('accessToken')}|{token.get('refreshToken')}"
                if sig == self._last_sig:
                    continue
                self._last_sig = sig
                if self._on_change:
                    self._on_change(token)
            except Exception:
                # watcher must never throw into the host
                continue

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None


# Module-level watcher so it can be started/stopped from the app lifecycle.
_watcher: KiroAuthTokenWatcher | None = None


def watch_kiro_auth_token_file(on_change: Callable[[dict[str, Any]], Any]) -> KiroAuthTokenWatcher:
    global _watcher
    if _watcher is not None:
        _watcher.stop()
    _watcher = KiroAuthTokenWatcher()
    _watcher.start(on_change)
    return _watcher
