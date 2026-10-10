"""Package-lifecycle command handlers for ``python -m stitch_plugin_tools``.

Covers keygen / sign / verify / publish / publish-all / dev-install /
pack-engine / pack-provider / new / upgrade / sync-template / vendor /
run / test.  Wired into the argparse tree by
:mod:`stitch_plugin_tools.cli_parsers`.
"""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from autoreg.plugin import crypto
from autoreg.plugin.manifest import MANIFEST_FILENAME

if TYPE_CHECKING:
    import argparse

_PRIVATE_KEY_NAME = "private.key"
_PUBLIC_KEY_NAME = "public.key"


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
    """Make the private key readable only by the owner (POSIX chmod, win32 ACL)."""
    if os.name == "nt":
        _restrict_permissions_windows(path)
    elif os.name == "posix":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def _restrict_permissions_windows(path: Path) -> None:
    user = ""
    try:
        user = subprocess.run(
            ["whoami"], capture_output=True, text=True, check=True
        ).stdout.strip()
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        grant_user = user or "%USERNAME%"
        print(
            f"warning: could not restrict permissions on {path}: "
            f"the private key may be readable by other users; "
            f"run icacls manually: icacls {path} /inheritance:r "
            f"/grant:r {grant_user}:F",
            file=sys.stderr,
        )


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
    try:
        signature = crypto.sign_package(package_dir, priv_pem)
    except (ValueError, TypeError) as exc:
        print(f"error: cannot load private key {key_path}: {exc}", file=sys.stderr)
        return 2
    crypto.write_signature(package_dir, signature)

    manifest_path = package_dir / MANIFEST_FILENAME
    print(f"signed {manifest_path}")
    print(f"signature: {signature}")
    return 0


# ── verify ───────────────────────────────────────────────────────────────


def _cmd_verify(args: argparse.Namespace) -> int:
    package_dir = Path(args.package_dir)

    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2

    if args.pubkey:
        pubkey_path = Path(args.pubkey)
        if not pubkey_path.is_file():
            print(f"error: public key not found: {pubkey_path}", file=sys.stderr)
            return 2
        pub_b64 = pubkey_path.read_text(encoding="utf-8").strip()
    else:
        pub_b64 = crypto.load_embedded_pubkey()
        if not pub_b64:
            print(
                "error: no public key available: pass --pubkey <file>, set "
                "STITCH_PLUGIN_PUBKEY, or bundle plugin_pubkey.txt",
                file=sys.stderr,
            )
            return 2

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


def _cmd_publish_all(args: argparse.Namespace) -> int:
    """Publish all official packages; --dry-run validates without keys/URL."""
    import asyncio

    from stitch_plugin_tools.publish import publish_all, resolve_publish_config

    server_url, admin_key, signing_pem = "", "", None
    if not args.dry_run:
        try:
            server_url, admin_key, signing_pem = resolve_publish_config(
                args.server_url, args.admin_key, args.signing_key
            )
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    results = asyncio.run(
        publish_all(
            server_url=server_url,
            admin_key=admin_key,
            signing_pem=signing_pem,
            only=args.only,
            dry_run=args.dry_run,
        )
    )
    failed = False
    for entry in results:
        line = f"{entry['id']} @ {entry['version']} -> {entry['status']}"
        if entry["status"] == "failed":
            failed = True
            line += f" ({entry['error']})"
        print(line)
    return 1 if failed else 0


# ── dev-install ───────────────────────────────────────────────────────────


def _cmd_dev_install(args: argparse.Namespace) -> int:
    from stitch_plugin_tools.publish import dev_install

    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2
    dest = dev_install(package_dir, link=args.link)
    mode = "linked" if args.link else "copied"
    print(f"dev-installed ({mode}) to {dest}")
    return 0


# ── pack-engine ───────────────────────────────────────────────────────────


def _cmd_pack_engine(args: argparse.Namespace) -> int:
    """Assemble an engine-pack from the real autoreg/captcha solvers.

    See :func:`stitch_plugin_tools.publish.pack_engine` for the full
    import-handling rationale.  The assembled pack is unsigned - run
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
            src_root=Path(args.src_root) if args.src_root else None,
        )
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"engine-pack assembled at {result}")
    print(f"  version: {crypto.read_manifest(result).version}")
    print(f"  solvers: {', '.join(('turnstile', 'turnstile_api', 'aliyun_slider'))}")
    print("  bundled: vendor/turnstile-solver service + checkbox_template.png")
    print(
        f"  sign with: python -m stitch_plugin_tools sign {result} "
        f"--key <private.key>"
    )
    return 0


def _cmd_pack_service(args: argparse.Namespace) -> int:
    """Assemble a clean, signable copy of a service-plugin package.

    Applies the packaging excludes (repo/CI metadata, tests, env files, and
    the manifest's ``package_exclude`` list) so a repo-root package ships its
    runtime payload only.  The result is unsigned - sign it before publishing.
    """
    from stitch_plugin_tools.publish import pack_service

    try:
        result = pack_service(Path(args.package_dir), Path(args.out))
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"packed {result}")
    return 0


def _cmd_pack_provider(args: argparse.Namespace) -> int:
    """Assemble a self-contained CODE plugin package for one provider.

    Copies ``<providers_root>/<provider_id>/``, bundles base/common,
    rewrites imports to package-relative form and emits ``plugin.json``
    (``kind=provider``).  The package is unsigned - run
    ``python -m stitch_plugin_tools sign <out_dir> --key <private.key>``
    to produce a publish-ready, signed package.
    """
    from stitch_plugin_tools.publish import pack_provider

    out_dir = Path(args.out)
    try:
        result = pack_provider(
            args.provider_id,
            out_dir,
            version=args.version,
            providers_root=(
                Path(args.providers_root) if args.providers_root else None
            ),
        )
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"provider plugin assembled at {result}")
    print(f"  provider: {args.provider_id}")
    print(f"  version: {crypto.read_manifest(result).version}")
    print(
        f"  sign with: python -m stitch_plugin_tools sign {result} "
        f"--key <private.key>"
    )
    return 0


# ── new ───────────────────────────────────────────────────────────────────


def _cmd_new(args: argparse.Namespace) -> int:
    """Scaffold a new plugin package (kind=service or kind=provider).

    See :func:`stitch_plugin_tools.scaffold.scaffold_service_plugin` and
    :func:`stitch_plugin_tools.scaffold.scaffold_provider_plugin` for the
    generated layouts.  The package is unsigned — run ``sign`` after.
    """
    out_dir = Path(args.out)
    try:
        if args.kind == "provider":
            from stitch_plugin_tools.scaffold import scaffold_provider_plugin

            result = scaffold_provider_plugin(
                out_dir,
                plugin_id=args.id,
                name=args.name,
                author=args.author,
                version=args.version,
                description=args.description,
                category=args.category,
                status=args.status,
                icon=args.icon,
            )
        else:
            from stitch_plugin_tools.scaffold import scaffold_service_plugin

            result = scaffold_service_plugin(
                out_dir,
                plugin_id=args.id,
                name=args.name,
                author=args.author,
                version=args.version,
                description=args.description,
                category=args.category,
                status=args.status,
                icon=args.icon,
            )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"scaffolded {args.kind} plugin at {result}")
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


# ── vendor ───────────────────────────────────────────────────────────────


def _cmd_vendor(args: argparse.Namespace) -> int:
    """Vendor the canonical RPC server + helpers into a plugin package.

    Writes ``<pkg>/_vendor/rpc_server.py`` from ``autoreg/plugin/rpc.py``
    and ``<pkg>/_vendor/plugin_helpers.py`` from ``autoreg/plugin/helpers.py``
    so the package runs standalone (no ``autoreg`` on sys.path).  Run
    after ``dev-install`` or before ``publish`` to refresh the vendored
    modules.  Idempotent: skips the write when a file is already canonical.
    """
    from stitch_plugin_tools.upgrade import _package_module_dir
    from stitch_plugin_tools.vendoring import vendor_all

    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"error: package dir not found: {package_dir}", file=sys.stderr)
        return 2
    module_dir = _package_module_dir(package_dir)
    if module_dir is None:
        print(
            f"error: no Python package dir (with __main__.py) found in {package_dir}",
            file=sys.stderr,
        )
        return 2
    for path in vendor_all(module_dir):
        print(f"vendored {path.name} to {path}")
    return 0


# ── run / test ────────────────────────────────────────────────────────────


def _cmd_run(args: argparse.Namespace) -> int:
    """Interactive plugin REPL — spawn, stream stderr, drive commands.

    See :func:`stitch_plugin_tools.runtool.run_package` for the spawn /
    attach / stderr-streaming / reverse-RPC-stub design.  The author
    loop becomes: ``new`` → edit handlers → ``run`` (exercise commands
    instantly, watch stderr) → ``test`` → ``dev-install``.
    """
    from stitch_plugin_tools.runtool import run_package

    return run_package(Path(args.package_dir))


def _cmd_test(args: argparse.Namespace) -> int:
    """Run the plugin's own tests via the venv pytest.

    Streams ``python -m pytest <package_dir>/tests -q`` output.  No
    tests dir → friendly message pointing at the template's starter
    test.  pytest absent → error with install hint.
    """
    from stitch_plugin_tools.runtool import test_package

    return test_package(Path(args.package_dir))


def _cmd_manifest_lint(args: argparse.Namespace) -> int:
    """Validate manifest UI contributions for one or more paths/globs (CI)."""
    from stitch_plugin_tools.ui_manifest import lint_paths

    return lint_paths(args.paths)
