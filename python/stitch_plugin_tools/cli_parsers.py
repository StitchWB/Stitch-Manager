"""Argparse tree for ``python -m stitch_plugin_tools`` (all subcommands).

Handlers live in :mod:`stitch_plugin_tools.cli_commands_package` and
:mod:`stitch_plugin_tools.cli_commands_server`; this module only wires
flags, defaults and help texts to them.
"""

from __future__ import annotations

import argparse

from autoreg.plugin.manifest import (
    VALID_CATEGORIES,
    VALID_STATUSES,
)
from stitch_plugin_tools.classify import _cmd_classify
from stitch_plugin_tools.cli_commands_package import (
    _cmd_check,
    _cmd_dev_backend,
    _cmd_dev_install,
    _cmd_invoke,
    _cmd_keygen,
    _cmd_manifest_lint,
    _cmd_new,
    _cmd_pack_engine,
    _cmd_pack_provider,
    _cmd_pack_service,
    _cmd_publish,
    _cmd_publish_all,
    _cmd_run,
    _cmd_sign,
    _cmd_sync_template,
    _cmd_test,
    _cmd_typegen,
    _cmd_upgrade,
    _cmd_validate,
    _cmd_vendor,
    _cmd_verify,
    _cmd_verify_signature,
    _cmd_wrap,
)
from stitch_plugin_tools.cli_commands_server import (
    ENV_ADMIN_KEY,
    _cmd_attest,
    _cmd_catalog_lint,
    _cmd_catalog_snapshot,
    _cmd_codes_issue,
    _cmd_codes_list,
    _cmd_drift,
    _cmd_install_from,
    _cmd_publish_selectors,
)


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

    p_verify = sub.add_parser(
        "verify",
        help="run every dev gate for the plugin kind (ruff / manifest-lint / pytest / classify)",
    )
    p_verify.add_argument(
        "package_dir",
        nargs="?",
        default=".",
        help="package directory (default: cwd; reads plugin.json or catalog.json)",
    )
    p_verify.set_defaults(func=_cmd_verify)

    p_check = sub.add_parser(
        "check",
        help="run every dev gate and emit a machine-readable gate document",
    )
    p_check.add_argument(
        "package_dir",
        nargs="?",
        default=".",
        help="package directory (default: cwd; reads plugin.json or catalog.json)",
    )
    p_check.add_argument(
        "--json",
        action="store_true",
        help="emit the gate document as JSON on stdout",
    )
    p_check.set_defaults(func=_cmd_check)

    p_verify_sig = sub.add_parser(
        "verify-signature", help="verify a plugin package signature"
    )
    p_verify_sig.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_verify_sig.add_argument(
        "--pubkey",
        default=None,
        help="public key file (base64; default: embedded plugin pubkey)",
    )
    p_verify_sig.set_defaults(func=_cmd_verify_signature)

    p_publish = sub.add_parser(
        "publish", help="sign + zip + publish a package to the server"
    )
    p_publish.add_argument(
        "package_dir",
        nargs="?",
        default=".",
        help="package directory (contains plugin.json; default: cwd)",
    )
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
    p_publish.add_argument(
        "--dry-run",
        action="store_true",
        help="plan only: classify + lane + farm workflow + gate checklist; no publish",
    )
    p_publish.set_defaults(func=_cmd_publish)

    p_publish_all = sub.add_parser(
        "publish-all",
        help="publish every official package (services + engine-pack + providers)",
    )
    p_publish_all.add_argument(
        "--server-url", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_publish_all.add_argument(
        "--admin-key", default=None, help="admin key (or STITCH_ADMIN_KEY)"
    )
    p_publish_all.add_argument(
        "--signing-key", default=None, help="signing key file (or STITCH_SIGNING_KEY)"
    )
    p_publish_all.add_argument(
        "--only",
        action="append",
        default=None,
        help="publish only this plugin id (repeatable; default: all)",
    )
    p_publish_all.add_argument(
        "--dry-run",
        action="store_true",
        help="pack + validate only; no server contact, no keys/URL needed",
    )
    p_publish_all.set_defaults(func=_cmd_publish_all)

    p_dev = sub.add_parser(
        "dev-install", help="copy a package to plugins-local for the dev loop"
    )
    p_dev.add_argument("package_dir", help="package directory (contains plugin.json)")
    p_dev.add_argument(
        "--link",
        action="store_true",
        help="link instead of copy: write a .stitch-link pointer so edits "
        "in the working copy are live without re-install",
    )
    p_dev.set_defaults(func=_cmd_dev_install)

    p_dev_backend = sub.add_parser(
        "dev-backend",
        help="run the real backend headless for plugin development",
    )
    p_dev_backend.add_argument(
        "--port", type=int, default=25584, help="bind port (default: 25584)"
    )
    p_dev_backend.add_argument(
        "--watch",
        action="store_true",
        help="reload service plugins when their sources change",
    )
    p_dev_backend.set_defaults(func=_cmd_dev_backend)

    p_invoke = sub.add_parser(
        "invoke",
        help="POST a plugin command to a running dev backend",
    )
    p_invoke.add_argument("target", help="<plugin-id>.<cmd>")
    p_invoke.add_argument(
        "--params",
        default=None,
        help="JSON object for the command, or @file to read it",
    )
    p_invoke.add_argument(
        "--json", action="store_true", help="print the raw response body"
    )
    p_invoke.add_argument(
        "--url",
        default="http://127.0.0.1:25584",
        help="backend base URL (default: http://127.0.0.1:25584)",
    )
    p_invoke.set_defaults(func=_cmd_invoke)

    p_pack = sub.add_parser(
        "pack-engine",
        help="assemble an engine-pack from the real autoreg/captcha solvers",
    )
    p_pack.add_argument("out", help="output directory for the engine-pack")
    p_pack.add_argument(
        "--version",
        default=None,
        help="semver version (default: canonical manifest version, else 0.1.0)",
    )
    p_pack.add_argument(
        "--name", default="Engine Pack", help="human-readable pack name"
    )
    p_pack.add_argument(
        "--service", default="engine", help="service identifier (default: engine)"
    )
    p_pack.add_argument(
        "--src-root",
        default=None,
        help=(
            "repo root to assemble from (must contain python/autoreg/ and "
            "vendor/turnstile-solver/); default: resolve from the installed "
            "SDK location"
        ),
    )
    p_pack.set_defaults(func=_cmd_pack_engine)

    p_pack_service = sub.add_parser(
        "pack-service",
        help="assemble a clean, signable copy of a service-plugin package",
    )
    p_pack_service.add_argument(
        "package_dir", help="service-package root (contains plugin.json)"
    )
    p_pack_service.add_argument("out", help="output pack directory")
    p_pack_service.set_defaults(func=_cmd_pack_service)

    p_pack_provider = sub.add_parser(
        "pack-provider",
        help="assemble a kind=provider CODE plugin package from a providers tree",
    )
    p_pack_provider.add_argument(
        "provider_id", help="provider directory name (e.g. kiro)"
    )
    p_pack_provider.add_argument(
        "out", help="output directory for the package"
    )
    p_pack_provider.add_argument(
        "--version",
        default=None,
        help="semver version (default: canonical manifest version, else 0.1.0)",
    )
    p_pack_provider.add_argument(
        "--providers-root",
        default=None,
        help=(
            "directory containing <provider_id>/ plus base.py/common.py; "
            "default: resolve autoreg/providers from the installed SDK location"
        ),
    )
    p_pack_provider.set_defaults(func=_cmd_pack_provider)

    p_new = sub.add_parser(
        "new",
        help="scaffold a plugin package (kind=service RPC or kind=provider method)",
    )
    p_new.add_argument("out", help="output directory for the package")
    p_new.add_argument(
        "--id", required=True, help="plugin id ([A-Za-z0-9_-], no dots)"
    )
    p_new.add_argument(
        "--kind",
        choices=["service", "provider"],
        default="service",
        help="package kind to scaffold (default: service)",
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
    p_new.add_argument(
        "--description",
        default="",
        help="short marketplace description (default: generated from the name)",
    )
    p_new.add_argument(
        "--category",
        default="productivity",
        choices=list(VALID_CATEGORIES),
        help="marketplace category (default: productivity)",
    )
    p_new.add_argument(
        "--status",
        default="beta",
        choices=list(VALID_STATUSES),
        help="marketplace status (default: beta)",
    )
    p_new.add_argument(
        "--icon", default="🧩", help="single emoji icon (default: 🧩)"
    )
    p_new.set_defaults(func=_cmd_new)

    p_wrap = sub.add_parser(
        "wrap",
        help="wrap an existing local directory as a kind=service plugin package",
    )
    p_wrap.add_argument(
        "repo_dir", help="local directory to wrap (no git URL)"
    )
    p_wrap.add_argument(
        "--id", required=True, help="plugin id ([A-Za-z0-9_-], no dots)"
    )
    p_wrap.add_argument(
        "--name", default="", help="human-readable name (default: same as --id)"
    )
    p_wrap.add_argument(
        "--out", default=None, help="output directory (default: ./<id>)"
    )
    p_wrap.add_argument(
        "--runtime",
        choices=["auto", "python-module", "python-script", "cli", "native"],
        default="auto",
        help="wrapped program runtime (default: auto-detect)",
    )
    p_wrap.add_argument(
        "--version", default="0.1.0", help="semver version (default: 0.1.0)"
    )
    p_wrap.add_argument(
        "--description",
        default="",
        help="short marketplace description (default: generated from the path)",
    )
    p_wrap.add_argument(
        "--category",
        default="productivity",
        choices=list(VALID_CATEGORIES),
        help="marketplace category (default: productivity)",
    )
    p_wrap.add_argument(
        "--status",
        default="beta",
        choices=list(VALID_STATUSES),
        help="marketplace status (default: beta)",
    )
    p_wrap.add_argument(
        "--icon", default="🧩", help="single emoji icon (default: 🧩)"
    )
    p_wrap.add_argument(
        "--author", default="", help="author name (written to manifest extras)"
    )
    p_wrap.set_defaults(func=_cmd_wrap)

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

    p_vendor = sub.add_parser(
        "vendor",
        help="vendor the canonical RPC server + helpers into a plugin package",
    )
    p_vendor.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_vendor.set_defaults(func=_cmd_vendor)

    p_run = sub.add_parser(
        "run",
        help="run a plugin: '<pkg> <cmd>' runs one command; '<pkg>' opens the REPL",
    )
    p_run.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_run.add_argument(
        "command",
        nargs="?",
        help="plugin command to invoke once (one-shot); omit for the REPL",
    )
    p_run.add_argument(
        "--params",
        default=None,
        help="JSON object for the one-shot command, or @file to read it",
    )
    run_fresh = p_run.add_mutually_exclusive_group()
    run_fresh.add_argument(
        "--fresh",
        action="store_true",
        help="wipe the per-plugin run data_dir before starting (default)",
    )
    run_fresh.add_argument(
        "--keep",
        action="store_true",
        help="keep the existing per-plugin run data_dir",
    )
    p_run.add_argument(
        "--json",
        action="store_true",
        help="one-shot mode: emit JSONL events (ready / call) on stdout",
    )
    p_run.add_argument(
        "--watch",
        action="store_true",
        help="rebuild the plugin child when its sources change (poll mtime)",
    )
    p_run.set_defaults(func=_cmd_run)

    p_test = sub.add_parser(
        "test",
        help="run the plugin's own tests via the venv pytest",
    )
    p_test.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_test.set_defaults(func=_cmd_test)

    p_manifest_lint = sub.add_parser(
        "manifest-lint",
        help="validate plugin manifest UI contributions (CI) — paths or globs",
    )
    p_manifest_lint.add_argument(
        "paths", nargs="+", help="plugin.json path(s) or glob(s)"
    )
    p_manifest_lint.set_defaults(func=_cmd_manifest_lint)

    p_validate = sub.add_parser(
        "validate",
        help="validate a plugin manifest + cross-check UI contributions",
    )
    p_validate.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_validate.set_defaults(func=_cmd_validate)

    p_typegen = sub.add_parser(
        "typegen",
        help="generate _types.py + ui-types.d.ts from command params schemas",
    )
    p_typegen.add_argument(
        "package_dir", help="package directory (contains plugin.json)"
    )
    p_typegen.add_argument(
        "--check",
        action="store_true",
        help="compare generated output against on-disk; non-zero exit on drift",
    )
    p_typegen.set_defaults(func=_cmd_typegen)

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

    # ── catalog-lint ─────────────────────────────────────────────────────
    p_catalog_lint = sub.add_parser(
        "catalog-lint",
        help="validate a community catalog.json offline (for catalog repo CI)",
    )
    p_catalog_lint.add_argument(
        "catalog", help="path to catalog.json to validate"
    )
    p_catalog_lint.set_defaults(func=_cmd_catalog_lint)

    p_catalog_snapshot = sub.add_parser(
        "catalog-snapshot",
        help="snapshot third-party catalog sources into the controlled-org store",
    )
    p_catalog_snapshot.add_argument(
        "catalog", help="path to catalog.json to rewrite in place"
    )
    p_catalog_snapshot.add_argument("--id", dest="plugin_id", help="entry id to snapshot (default: all third-party)")
    p_catalog_snapshot.add_argument("--version", dest="version", help="entry version (with --id)")
    p_catalog_snapshot.add_argument(
        "--store-dir",
        help="local dir for snapshot artifacts (test seam; default: gh release upload)",
    )
    p_catalog_snapshot.add_argument(
        "--repo",
        help="snapshot store repo for gh release upload (default StitchWB/stitch-plugin-snapshots)",
    )
    p_catalog_snapshot.set_defaults(func=_cmd_catalog_snapshot)

    # ── attest ───────────────────────────────────────────────────────────
    p_attest = sub.add_parser(
        "attest",
        help="offline-sign an approved submission attestation (admin)",
    )
    p_attest.add_argument(
        "--server", default=None, help="server base URL (or STITCH_PUBLISH_URL)"
    )
    p_attest.add_argument(
        "--submission", type=int, required=True, help="submission id"
    )
    p_attest.add_argument(
        "--reviewer", required=True, help="reviewer name recorded in the attestation"
    )
    p_attest.add_argument(
        "--admin-key-env",
        default=ENV_ADMIN_KEY,
        help="env var holding the admin key (default: STITCH_ADMIN_KEY)",
    )
    p_attest.set_defaults(func=_cmd_attest)

    p_classify = sub.add_parser(
        "classify",
        help="publication verdict for a path or plugin id (class/channel/repo)",
    )
    p_classify.add_argument(
        "target",
        help="repo path (file or dir), provider id, or service-plugin id",
    )
    p_classify.set_defaults(func=_cmd_classify)

    return parser
