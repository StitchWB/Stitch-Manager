"""``python -m stitch_plugin_tools`` entry point.

Thirteen subcommands:
    keygen --out <dir>                          generate ed25519 keypair
    sign <package_dir> --key <private.key>      sign a plugin package
    verify <package_dir> --pubkey <public.key>  verify a plugin package
    publish <package_dir> [--server-url …]      sign + zip + POST /admin/publish
    dev-install <package_dir>                   copy package to plugins-local
    pack-engine <out_dir> [--version …]         assemble engine-pack from autoreg/captcha
    new <out_dir> --id <plugin_id> […]          scaffold a kind=service plugin package
    upgrade <package_dir> [--apply]             migrate an authored plugin to the current scaffold
    sync-template [--out <dir>]                 regenerate the template/ dir (GitHub template seed)
    drift […]                                   fetch drift report + propose selector weight rerank
    publish-selectors […]                       publish a selector overlay pack (hot update)
    codes {issue|list}                          issue and list activation codes (admin)
    install-from <url> [--ref|--release] [--sha256] [--trust]  fetch+install from git/release

The signing key is OFFLINE — the developer stores it on media not reachable
from the build / runtime.  ``keygen`` writes the private key with
restrictive filesystem permissions (0600 on POSIX; on Windows the file is
created with the caller's default ACL — tighten manually if needed).

``publish`` resolves its target from CLI flags, then env vars
(STITCH_PUBLISH_URL / STITCH_ADMIN_KEY / STITCH_SIGNING_KEY) — nothing
hardcoded.  ``dev-install`` needs no server: it copies the package into
``plugins-local/{id}/`` for the local dev loop.
"""

from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path

import httpx

from autoreg.plugin import crypto
from autoreg.plugin.manifest import MANIFEST_FILENAME

_PRIVATE_KEY_NAME = "private.key"
_PUBLIC_KEY_NAME = "public.key"

# Env var names — mirror stitch_plugin_tools.publish for the codes CLI.
ENV_PUBLISH_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"


# ── keygen ────────────────────────────────────────────────────────────────


def _cmd_keygen(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    priv_pem, pub_b64 = crypto.generate_keypair()

    priv_path = out_dir / _PRIVATE_KEY_NAME
    pub_path = out_dir / _PUBLIC_KEY_NAME

    priv_path.write_bytes(priv_pem)
    _restrict_permissions(priv_path)

    pub_path.write_text(pub_b64 + "\n", encoding="utf-8")

    print(f"private key: {priv_path}")
    print(f"public key:  {pub_path}")
    print(f"public b64:  {pub_b64}")
    return 0


def _restrict_permissions(path: Path) -> None:
    """Make the private key readable only by the owner (POSIX)."""
    if os.name == "posix":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


# ── sign ─────────────────────────────────────────────────────────────────


def _cmd_sign(args: argparse.Namespace) -> int:
    package_dir = Path(args.package_dir)
    key_path = Path(args.key)

    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2
    if not key_path.is_file():
        print(f"error: private key not found: {key_path}", file=sys.stderr)
        return 2

    priv_pem = key_path.read_bytes()
    signature = crypto.sign_package(package_dir, priv_pem)
    crypto.write_signature(package_dir, signature)

    manifest_path = package_dir / MANIFEST_FILENAME
    print(f"signed {manifest_path}")
    print(f"signature: {signature}")
    return 0


# ── verify ───────────────────────────────────────────────────────────────


def _cmd_verify(args: argparse.Namespace) -> int:
    package_dir = Path(args.package_dir)
    pubkey_path = Path(args.pubkey)

    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2
    if not pubkey_path.is_file():
        print(f"error: public key not found: {pubkey_path}", file=sys.stderr)
        return 2

    pub_b64 = pubkey_path.read_text(encoding="utf-8").strip()
    manifest = crypto.read_manifest(package_dir)
    if not manifest.signature:
        print("error: package has no signature field", file=sys.stderr)
        return 1

    ok = crypto.verify_package(package_dir, manifest.signature, pub_b64)
    if ok:
        print(f"OK: signature valid for {manifest.id}@{manifest.version}")
        return 0
    print(f"FAIL: signature invalid for {manifest.id}@{manifest.version}", file=sys.stderr)
    return 1


# ── publish ───────────────────────────────────────────────────────────────


def _cmd_publish(args: argparse.Namespace) -> int:
    import asyncio

    from stitch_plugin_tools.publish import publish_package, resolve_publish_config

    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2

    try:
        server_url, admin_key, signing_pem = resolve_publish_config(
            args.server_url, args.admin_key, args.key
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        result = asyncio.run(
            publish_package(
                package_dir,
                server_url=server_url,
                admin_key=admin_key,
                signing_key_pem=signing_pem,
                rollout_percent=args.rollout,
            )
        )
    except httpx.HTTPStatusError as exc:
        print(
            f"error: publish failed: {exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: publish failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"published {result.get('plugin_id')}@{result.get('version')} "
        f"rollout={result.get('rollout_percent')}%"
    )
    return 0


# ── dev-install ───────────────────────────────────────────────────────────


def _cmd_dev_install(args: argparse.Namespace) -> int:
    from stitch_plugin_tools.publish import dev_install

    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2
    dest = dev_install(package_dir)
    print(f"dev-installed to {dest}")
    return 0


# ── pack-engine ───────────────────────────────────────────────────────────


def _cmd_pack_engine(args: argparse.Namespace) -> int:
    """Assemble an engine-pack from the real autoreg/captcha solvers.

    See :func:`stitch_plugin_tools.publish.pack_engine` for the full
    import-handling rationale.  The assembled pack is unsigned — run
    ``python -m stitch_plugin_tools sign <out_dir> --key <private.key>``
    to produce a publish-ready, signed pack.
    """
    from stitch_plugin_tools.publish import pack_engine

    out_dir = Path(args.out)
    try:
        result = pack_engine(
            out_dir,
            version=args.version,
            name=args.name,
            service=args.service,
        )
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"engine-pack assembled at {result}")
    print(f"  version: {args.version}")
    print(f"  solvers: {', '.join(('turnstile', 'turnstile_api', 'aliyun_slider'))}")
    print("  bundled: vendor/turnstile-solver service + checkbox_template.png")
    print(
        f"  sign with: python -m stitch_plugin_tools sign {result} "
        f"--key <private.key>"
    )
    return 0


# ── new ───────────────────────────────────────────────────────────────────


def _cmd_new(args: argparse.Namespace) -> int:
    """Scaffold a new kind=service plugin package.

    See :func:`stitch_plugin_tools.scaffold.scaffold_service_plugin` for
    the generated layout.  The package is unsigned — run ``sign`` after.
    """
    from stitch_plugin_tools.scaffold import scaffold_service_plugin

    out_dir = Path(args.out)
    try:
        result = scaffold_service_plugin(
            out_dir,
            plugin_id=args.id,
            name=args.name,
            author=args.author,
            version=args.version,
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"scaffolded service plugin at {result}")
    print(f"  id:      {args.id}")
    print(f"  version: {args.version}")
    print(
        f"  sign with: python -m stitch_plugin_tools sign {result} "
        f"--key <private.key>"
    )
    return 0


# ── upgrade ──────────────────────────────────────────────────────────────


def _cmd_upgrade(args: argparse.Namespace) -> int:
    """Migrate an authored plugin to the current scaffold conventions.

    Writes a diff preview to ``<package>/upgrade.diff`` first; nothing is
    modified until ``--apply``.  Only canonical regions (inline fallback
    block, marker lines, generated manifest fields) are rewritten —
    author handlers, storage schema, and contributions are never touched.
    """
    from stitch_plugin_tools.upgrade import (
        SKIPPED_AUTHOR_REGIONS,
        upgrade_package,
    )

    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2

    report = upgrade_package(package_dir, apply=args.apply)

    if report.status == "legacy":
        print(f"legacy plugin: {report.message}")
        print("manual migration checklist:")
        print("  1. adopt the RPC entry conventions (RpcPluginServer or the")
        print("     inline fallback, _Ctx handshake state, service.py layer)")
        print("  2. add the _generated_by marker + manifest generated_by field")
        print("  3. re-run this command to pick up future scaffold changes")
        print("  see docs/plugin-authoring.md §7 (Implementation Conventions)")
        return 1

    if report.status == "newer":
        print(report.message)
        return 1

    detected = report.detected.label if report.detected else "?"
    print(f"detected scaffold generation: {detected} (via {report.detected.source})")

    if report.status in ("up-to-date", "no-drift"):
        print(report.message)
        return 0

    for result in report.results:
        flag = "updated" if result.changed else "skipped"
        print(f"  [{flag:>7}] {result.file}: {result.region} — {result.note}")

    print("author regions preserved (never rewritten):")
    for region in SKIPPED_AUTHOR_REGIONS:
        print(f"  - {region}")

    print(report.message)
    return 0


# ── sync-template ────────────────────────────────────────────────────────


def _cmd_sync_template(args: argparse.Namespace) -> int:
    """Regenerate the template/ directory from the scaffold internals."""
    from stitch_plugin_tools.template_sync import (
        TEMPLATE_PLUGIN_ID,
        sync_template,
    )

    out_dir = Path(args.out)
    license_source = Path(args.license) if args.license else Path("LICENSE")
    try:
        result = sync_template(out_dir, license_source=license_source)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"template regenerated at {result}")
    print(f"  plugin id: {TEMPLATE_PLUGIN_ID}")
    print("  extras:    .github/workflows/ci.yml, .gitignore, LICENSE,")
    print("             README.md, tests/test_plugin_protocol.py")
    return 0


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

    # Tabular output: id | code_hash_prefix | used | entitlements | created_at
    # Raw codes are never returned by the server (only sha256 is persisted);
    # the hash prefix lets an operator correlate a row with an issuance
    # response (which carries the raw code) by matching sha256(raw)[:12].
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


# ── argparse ──────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m stitch_plugin_tools",
        description="Stitch plugin tooling: keygen / sign / verify",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_keygen = sub.add_parser("keygen", help="generate an ed25519 keypair")
    p_keygen.add_argument("--out", required=True, help="output directory")
    p_keygen.set_defaults(func=_cmd_keygen)

    p_sign = sub.add_parser("sign", help="sign a plugin package")
    p_sign.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_sign.add_argument("--key", required=True, help="private key file (PEM)")
    p_sign.set_defaults(func=_cmd_sign)

    p_verify = sub.add_parser("verify", help="verify a plugin package signature")
    p_verify.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_verify.add_argument("--pubkey", required=True, help="public key file (base64)")
    p_verify.set_defaults(func=_cmd_verify)

    p_publish = sub.add_parser(
        "publish", help="sign + zip + publish a package to the server"
    )
    p_publish.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_publish.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_publish.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_publish.add_argument(
        "--key", default=None, help="signing key file (or STITCH_SIGNING_KEY)"
    )
    p_publish.add_argument(
        "--rollout",
        type=int,
        default=0,
        help="rollout percent (0=staged, 10=canary, 100=full)",
    )
    p_publish.set_defaults(func=_cmd_publish)

    p_dev = sub.add_parser(
        "dev-install", help="copy a package to plugins-local for the dev loop"
    )
    p_dev.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_dev.set_defaults(func=_cmd_dev_install)

    p_pack = sub.add_parser(
        "pack-engine",
        help="assemble an engine-pack from the real autoreg/captcha solvers",
    )
    p_pack.add_argument("out", help="output directory for the engine-pack")
    p_pack.add_argument(
        "--version", default="0.1.0", help="semver version (default: 0.1.0)"
    )
    p_pack.add_argument(
        "--name", default="Engine Pack", help="human-readable pack name"
    )
    p_pack.add_argument(
        "--service", default="engine", help="service identifier (default: engine)"
    )
    p_pack.set_defaults(func=_cmd_pack_engine)

    p_new = sub.add_parser(
        "new",
        help="scaffold a kind=service plugin package (manifest + RPC entry + storage)",
    )
    p_new.add_argument("out", help="output directory for the package")
    p_new.add_argument(
        "--id", required=True, help="plugin id ([A-Za-z0-9_-], no dots)"
    )
    p_new.add_argument(
        "--name", default="", help="human-readable name (default: same as --id)"
    )
    p_new.add_argument(
        "--author", default="", help="author name (written to manifest extras)"
    )
    p_new.add_argument(
        "--version", default="0.1.0", help="semver version (default: 0.1.0)"
    )
    p_new.set_defaults(func=_cmd_new)

    p_upgrade = sub.add_parser(
        "upgrade",
        help="migrate an authored plugin to the current scaffold conventions",
    )
    p_upgrade.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_upgrade.add_argument(
        "--apply",
        action="store_true",
        help="write the changes (default: preview to <package>/upgrade.diff only)",
    )
    p_upgrade.set_defaults(func=_cmd_upgrade)

    p_sync_template = sub.add_parser(
        "sync-template",
        help="regenerate the template/ dir (GitHub template seed) from the scaffold",
    )
    p_sync_template.add_argument(
        "--out", default="template", help="output directory (default: template/)"
    )
    p_sync_template.add_argument(
        "--license",
        default=None,
        help="LICENSE file to copy verbatim (default: ./LICENSE if present)",
    )
    p_sync_template.set_defaults(func=_cmd_sync_template)

    p_drift = sub.add_parser(
        "drift",
        help="fetch drift report + propose selector weight rerank",
    )
    p_drift.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_drift.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_drift.add_argument(
        "--plugin", required=True, help="plugin id to filter drift by"
    )
    p_drift.add_argument(
        "--version", default=None, help="optional version filter"
    )
    p_drift.add_argument(
        "--window-hours",
        type=int,
        default=None,
        help="time window in hours (default: 168 = 7 days)",
    )
    p_drift.add_argument(
        "--package-dir",
        default=None,
        help="package dir with scenario.json to rerank (owner's prepared_area copy)",
    )
    p_drift.add_argument(
        "--apply",
        action="store_true",
        help="write the reranked scenario.json back to --package-dir",
    )
    p_drift.set_defaults(func=_cmd_drift)

    p_pub_sel = sub.add_parser(
        "publish-selectors",
        help="publish a selector overlay pack (hot update, no plugin bump)",
    )
    p_pub_sel.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_pub_sel.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_pub_sel.add_argument(
        "--plugin-id", required=True, help="plugin id to publish the overlay for"
    )
    p_pub_sel.add_argument(
        "--plugin-version", required=True, help="plugin version to publish the overlay for"
    )
    p_pub_sel.add_argument(
        "--package-dir", required=True,
        help="package dir with scenario.json (owner's prepared_area copy)",
    )
    p_pub_sel.add_argument(
        "--note", default=None, help="optional note attached to the pack",
    )
    p_pub_sel.set_defaults(func=_cmd_publish_selectors)

    # ── codes ───────────────────────────────────────────────────────────
    p_codes = sub.add_parser(
        "codes",
        help="issue and list activation codes (admin)",
    )
    codes_sub = p_codes.add_subparsers(dest="codes_command", required=True)

    p_codes_issue = codes_sub.add_parser(
        "issue", help="issue one or more activation codes"
    )
    p_codes_issue.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_codes_issue.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_codes_issue.add_argument(
        "--entitlements",
        default=None,
        help="comma-separated plugin ids (default: * = all plugins)",
    )
    p_codes_issue.add_argument(
        "--count",
        type=int,
        default=1,
        help="number of codes to issue (default: 1, max: 100)",
    )
    p_codes_issue.set_defaults(func=_cmd_codes_issue)

    p_codes_list = codes_sub.add_parser(
        "list", help="list all activation codes (used + unused)"
    )
    p_codes_list.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_codes_list.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_codes_list.set_defaults(func=_cmd_codes_list)

    # ── install-from ─────────────────────────────────────────────────────
    p_install_from = sub.add_parser(
        "install-from",
        help="fetch + install a plugin from a git repo or release tarball",
    )
    p_install_from.add_argument("url", help="git URL or release tarball URL")
    p_install_from.add_argument(
        "--ref", default=None, help="branch/tag/SHA (git mode, default: main)",
    )
    p_install_from.add_argument(
        "--release", default=None, help="release tag (switches to release mode)",
    )
    p_install_from.add_argument(
        "--sha256", default=None, help="expected sha256 of the release tarball",
    )
    p_install_from.add_argument(
        "--trust", action="store_true",
        help="admin override for the dev-tier gate (git mode)",
    )
    p_install_from.set_defaults(func=_cmd_install_from)

    return parser


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


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
