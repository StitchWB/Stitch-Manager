"""``python -m stitch_plugin_tools`` entry point.

Nineteen subcommands:
    keygen --out <dir>                          generate ed25519 keypair
    sign <package_dir> --key <private.key>      sign a plugin package
    verify <package_dir> --pubkey <public.key>  verify a plugin package
    publish <package_dir> [--server-url …]      sign + zip + POST /admin/publish
    publish-all [--only …] [--dry-run]          publish all 17 official packages
    dev-install <package_dir>                   copy package to plugins-local
    pack-engine <out_dir> [--version …]         assemble engine-pack from autoreg/captcha
    new <out_dir> --id <plugin_id> […]          scaffold a kind=service plugin package
    upgrade <package_dir> [--apply]             migrate an authored plugin to the current scaffold
    sync-template [--out <dir>]                 regenerate the template/ dir (GitHub template seed)
    vendor <package_dir>                        vendor canonical rpc_server + helpers into <pkg>/_vendor/
    run <package_dir>                           interactive plugin REPL (spawn + stderr stream + reverse-RPC stubs)
    test <package_dir>                          run the plugin's own tests via the venv pytest
    manifest-lint <paths/globs…>                validate manifest UI contributions (CI walk)
    drift […]                                   fetch drift report + propose selector weight rerank
    publish-selectors […]                       publish a selector overlay pack (hot update)
    codes {issue|list}                          issue and list activation codes (admin)
    install-from <url> [--ref|--release] [--sha256] [--trust]  fetch+install from git/release
    catalog-lint <catalog.json>                 validate a community catalog offline (CI)
    attest --server … --submission ID …         offline-sign an approved submission attestation

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

from stitch_plugin_tools.cli_commands_server import (
    ENV_ADMIN_KEY as ENV_ADMIN_KEY,
)
from stitch_plugin_tools.cli_commands_server import (
    ENV_PUBLISH_URL as ENV_PUBLISH_URL,
)
from stitch_plugin_tools.cli_parsers import _build_parser as _build_parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
