"""``attest`` CLI subcommand — offline attestation signing (Feature 2, OC3).

The catalog signing key NEVER touches the server: this command runs on the
reviewer's offline machine, fetches the approved submission's sha256 via the
admin API, signs ``{reviewer}|{reviewed_at}|{sha256}`` with the ed25519
private key from ``STITCH_CATALOG_PRIVKEY`` (base64 raw 32-byte), and uploads
only the resulting attestation blob. The server verifies it against its
configured ``STITCH_CATALOG_PUBKEY`` (PUT /admin/submissions/{id}/attest).
"""

from __future__ import annotations

import base64
import os
import sys
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# Env var names — mirror publish.py / drift.py conventions.
ENV_SERVER_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"
ENV_CATALOG_PRIVKEY = "STITCH_CATALOG_PRIVKEY"


def resolve_attest_config(server: str | None, admin_key_env: str) -> tuple[str, str]:
    """Resolve server URL (flag or STITCH_PUBLISH_URL) + admin key read from
    the env var named ``admin_key_env``. Raises ValueError if either cannot
    be resolved."""
    url = (server or os.environ.get(ENV_SERVER_URL, "")).strip()
    key = os.environ.get(admin_key_env, "").strip()
    if not url:
        raise ValueError(f"no server url (--server or {ENV_SERVER_URL})")
    if not key:
        raise ValueError(f"no admin key in env var {admin_key_env}")
    return url, key


def load_catalog_privkey() -> Ed25519PrivateKey:
    """Load the catalog signing key from STITCH_CATALOG_PRIVKEY.

    Format mirrors ``autoreg.plugin.crypto.load_public_key``: base64 of the
    raw 32-byte ed25519 key. Raises ValueError when missing or malformed.
    """
    raw_b64 = os.environ.get(ENV_CATALOG_PRIVKEY, "").strip()
    if not raw_b64:
        raise ValueError(f"no catalog signing key ({ENV_CATALOG_PRIVKEY} env var)")
    try:
        raw = base64.b64decode(raw_b64)
        return Ed25519PrivateKey.from_private_bytes(raw)
    except ValueError as exc:
        raise ValueError(
            f"{ENV_CATALOG_PRIVKEY} is not a base64 raw 32-byte ed25519 key"
        ) from exc


def sign_attestation(
    priv: Ed25519PrivateKey, reviewed_by: str, reviewed_at: str, sha256: str
) -> str:
    """Sign ``{reviewed_by}|{reviewed_at}|{sha256}`` — the exact payload the
    server verifies in ``plugin_validate.verify_attestation``."""
    payload = f"{reviewed_by}|{reviewed_at}|{sha256}"
    sig = priv.sign(payload.encode())
    return f"ed25519:{base64.b64encode(sig).decode('ascii')}"


async def fetch_submission(
    server_url: str,
    admin_key: str,
    submission_id: int,
    *,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """GET /admin/submissions/{id} and return the parsed detail JSON."""
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await http.get(
            f"{server_url.rstrip('/')}/admin/submissions/{submission_id}",
            headers={"X-Admin-Key": admin_key},
        )
        resp.raise_for_status()
        return resp.json()
    finally:
        if own_client:
            await http.aclose()


async def put_attestation(
    server_url: str,
    admin_key: str,
    submission_id: int,
    attestation: dict[str, str],
    *,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """PUT /admin/submissions/{id}/attest with the signed attestation blob."""
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await http.put(
            f"{server_url.rstrip('/')}/admin/submissions/{submission_id}/attest",
            json={"attestation": attestation},
            headers={"X-Admin-Key": admin_key},
        )
        resp.raise_for_status()
        return resp.json()
    finally:
        if own_client:
            await http.aclose()


def run_attest(
    *,
    server: str | None,
    submission: int,
    reviewer: str,
    admin_key_env: str,
    client: httpx.AsyncClient | None = None,
) -> int:
    """Run the attest CLI: fetch, sign, upload. Returns process exit code
    (0 success, 1 fetch/server/state error, 2 config error)."""
    import asyncio

    try:
        url, key = resolve_attest_config(server, admin_key_env)
        priv = load_catalog_privkey()
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    async def _run() -> int:
        detail = await fetch_submission(url, key, submission, client=client)
        status = detail.get("review_status")
        if status != "approved":
            print(
                f"error: submission {submission} is {status!r}, not approved "
                "— approve it before attesting",
                file=sys.stderr,
            )
            return 1
        sha256 = detail.get("sha256") or ""
        if not sha256:
            print(
                f"error: submission {submission} has no sha256",
                file=sys.stderr,
            )
            return 1
        reviewed_at = datetime.now(UTC).isoformat()
        attestation = {
            "reviewed_by": reviewer,
            "reviewed_at": reviewed_at,
            "sha256": sha256,
            "signature": sign_attestation(priv, reviewer, reviewed_at, sha256),
        }
        await put_attestation(url, key, submission, attestation, client=client)
        print(
            f"attested {detail.get('plugin_id')}@{detail.get('version')} "
            f"sha256={sha256[:12]} reviewer={reviewer}"
        )
        return 0

    try:
        return asyncio.run(_run())
    except httpx.HTTPStatusError as exc:
        print(
            f"error: attest failed: {exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: attest failed: {exc}", file=sys.stderr)
        return 1
