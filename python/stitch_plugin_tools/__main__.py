"""``python -m stitch_plugin_tools`` entry point.

Six subcommands:
    keygen --out <dir>                          generate ed25519 keypair
    sign <package_dir> --key <private.key>      sign a plugin package
    verify <package_dir> --pubkey <public.key>  verify a plugin package
    publish <package_dir> [--server-url …]      sign + zip + POST /admin/publish
    dev-install <package_dir>                   copy package to plugins-local
    pack-engine <out_dir> [--version …]         assemble engine-pack from autoreg/captcha

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

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
