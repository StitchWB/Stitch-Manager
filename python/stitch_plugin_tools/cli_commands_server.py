"""Server/admin command handlers for ``python -m stitch_plugin_tools``.

Covers drift / publish-selectors / codes / install-from / catalog-lint /
attest.  Wired into the argparse tree by
:mod:`stitch_plugin_tools.cli_parsers`.
"""

from __future__ import annotations

import os
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse

# Env var names — mirror stitch_plugin_tools.publish for the codes CLI.
ENV_PUBLISH_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"


# ── drift ────────────────────────────────────────────────────────────────


def _cmd_drift(args: argparse.Namespace) -> int:
    from stitch_plugin_tools.drift import run_drift

    return run_drift(
        server_url=args.server_url,
        admin_key=args.admin_key,
        plugin_id=args.plugin,
        version=args.version,
        window_hours=args.window_hours,
        package_dir=args.package_dir,
        apply=args.apply,
    )


# ── publish-selectors ────────────────────────────────────────────────────────


def _cmd_publish_selectors(args: argparse.Namespace) -> int:
    from stitch_plugin_tools.publish_selectors import run_publish_selectors

    return run_publish_selectors(
        server_url=args.server_url,
        admin_key=args.admin_key,
        plugin_id=args.plugin_id,
        plugin_version=args.plugin_version,
        package_dir=args.package_dir,
        note=args.note,
    )


# ── codes ──────────────────────────────────────────────────────────────────


def _resolve_admin_config(
    server_url: str | None, admin_key: str | None
) -> tuple[str, str]:
    """Resolve server URL + admin key from CLI flags or env vars.

    Returns ``(url, key)``.  Raises :class:`ValueError` if either value
    cannot be resolved — the caller catches and prints + returns exit code 2
    (mirrors :func:`stitch_plugin_tools.publish.resolve_publish_config`).
    """
    url = (server_url or os.environ.get(ENV_PUBLISH_URL, "")).strip()
    key = (admin_key or os.environ.get(ENV_ADMIN_KEY, "")).strip()
    if not url:
        raise ValueError(f"no server url (--server-url or {ENV_PUBLISH_URL})")
    if not key:
        raise ValueError(f"no admin key (--admin-key or {ENV_ADMIN_KEY})")
    return url, key


def _cmd_codes_issue(args: argparse.Namespace) -> int:
    import asyncio

    import httpx

    try:
        url, key = _resolve_admin_config(args.server_url, args.admin_key)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # Parse comma-separated entitlements: split, strip, drop empties.
    if args.entitlements:
        entitlements = [e.strip() for e in args.entitlements.split(",")]
        entitlements = [e for e in entitlements if e]
    else:
        entitlements = None

    async def _run() -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.post(
                f"{url.rstrip('/')}/admin/issue-code",
                json={"entitlements": entitlements, "count": args.count},
                headers={"X-Admin-Key": key},
            )
            resp.raise_for_status()
            return resp.json()["codes"]

    try:
        codes = asyncio.run(_run())
    except httpx.HTTPStatusError as exc:
        print(
            f"error: issue-code failed: {exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: issue-code failed: {exc}", file=sys.stderr)
        return 1

    for code in codes:
        print(code)
    return 0


def _cmd_codes_list(args: argparse.Namespace) -> int:
    import asyncio

    import httpx

    try:
        url, key = _resolve_admin_config(args.server_url, args.admin_key)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    async def _run() -> list[dict]:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(
                f"{url.rstrip('/')}/admin/codes",
                headers={"X-Admin-Key": key},
            )
            resp.raise_for_status()
            return resp.json()["codes"]

    try:
        codes = asyncio.run(_run())
    except httpx.HTTPStatusError as exc:
        print(
            f"error: list codes failed: {exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: list codes failed: {exc}", file=sys.stderr)
        return 1

    if not codes:
        print("(no codes issued)")
        return 0

    # Raw codes are never returned (only sha256 persisted); the hash prefix correlates a row with its issuance response.
    print(
        f"{'id':>4}  {'code_hash_prefix':12}  {'used':4}  "
        f"{'entitlements':20}  {'created_at'}"
    )
    for c in codes:
        ents = ",".join(c.get("entitlements", []))
        print(
            f"{c['id']:>4}  {c['code_hash_prefix']:12}  "
            f"{'yes' if c['used'] else 'no':4}  {ents:20}  {c['created_at']}"
        )
    return 0


def _cmd_install_from(args: argparse.Namespace) -> int:
    import asyncio

    from stitch_backend.domains.plugin_distribution.sources import (
        PluginSourceSpec,
        install_from_source,
    )

    if args.release is not None or (args.ref is None and args.sha256 is not None):
        spec = PluginSourceSpec(
            type="release",
            url=args.url,
            release=args.release,
            expected_sha256=args.sha256,
        )
    else:
        spec = PluginSourceSpec(
            type="git",
            url=args.url,
            ref=args.ref,
            expected_sha256=args.sha256,
        )

    result = asyncio.run(install_from_source(spec, trust=args.trust))
    if not result.get("success"):
        print(f"error: {result.get('error')}", file=sys.stderr)
        return 1
    print(
        f"installed {result.get('plugin_id')}@{result.get('version')}"
        + (f" (pinned {result['pinned_sha'][:12]})" if result.get("pinned_sha") else "")
    )
    return 0


def _cmd_catalog_lint(args: argparse.Namespace) -> int:
    """Validate a community catalog.json offline (for catalog repo CI)."""
    from stitch_plugin_tools.catalog_lint import lint_catalog

    return lint_catalog(args.catalog)


# ── attest ────────────────────────────────────────────────────────────────


def _cmd_attest(args: argparse.Namespace) -> int:
    from stitch_plugin_tools.attest import run_attest

    return run_attest(
        server=args.server,
        submission=args.submission,
        reviewer=args.reviewer,
        admin_key_env=args.admin_key_env,
    )
