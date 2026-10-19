"""Vendor drift leak-guard for CI.

Verifies that every official service plugin's vendored
``_vendor/rpc_server.py`` (under ``plugins-src/``) is byte-identical to the
canonical vendored text derived from ``autoreg/plugin/rpc.py``. Exits 0 when
clean, 1 when any plugin's vendored copy has drifted.

Why: the vendored RPC server is the plugin<->host protocol contract. When a
plugin's vendored copy drifts (hand-edited, or generated from an older
canonical source), the plugin can silently speak a stale protocol — or ship a
latent bug (the ``datetime.UTC`` NameError that bit the template). This guard
keeps the committed plugins in lock-step with the canonical source.

The template/ tree is NOT checked here: ``template-sync.yml`` already verifies
template/ matches the scaffold, and the scaffold vendors from the same
canonical source.

Requires ``stitch_plugin_tools`` (installed via ``pip install -e python/`` in
CI). Run from anywhere: paths are resolved relative to this file.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Repo root: python/scripts/check_vendor_drift.py -> parents[1]=python, [2]=root.
_REPO_ROOT = Path(__file__).resolve().parents[2]


def _module_dirs(pkg: Path) -> list[Path]:
    """Return subdirectories of ``pkg`` that are a Python plugin module.

    A plugin module dir contains ``__main__.py`` (the RPC entry point).
    Data-only plugins have no module dir and are skipped by the caller.
    """
    return [
        d for d in sorted(pkg.iterdir())
        if d.is_dir() and (d / "__main__.py").is_file()
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vendor drift leak-guard for plugins-src/."
    )
    parser.add_argument(
        "--plugins-dir",
        default=str(_REPO_ROOT / "plugins-src"),
        help="Directory containing the official plugin packages.",
    )
    args = parser.parse_args()

    # Import after arg parse so --help works without the package installed.
    from stitch_plugin_tools.vendoring import vendored_matches_canonical

    plugins_root = Path(args.plugins_dir)
    if not plugins_root.is_dir():
        print(f"plugins dir not found: {plugins_root}", file=sys.stderr)
        return 1

    checked = 0
    drift: list[str] = []
    for pkg in sorted(plugins_root.iterdir()):
        if not pkg.is_dir():
            continue
        mods = _module_dirs(pkg)
        if not mods:
            # Data-only plugin (no code / no vendored server) — nothing to check.
            continue
        for module_dir in mods:
            checked += 1
            if not vendored_matches_canonical(module_dir):
                drift.append(str(module_dir.relative_to(_REPO_ROOT)))

    if drift:
        print("VENDOR DRIFT DETECTED — the following vendored rpc_server.py")
        print("files differ from the canonical autoreg/plugin/rpc.py:")
        for path in drift:
            print(f"  - {path}")
        print()
        print("Fix each with:")
        print("  python -m stitch_plugin_tools vendor <plugin-package-dir>")
        return 1

    print(f"VENDOR CLEAN ({checked} plugin module(s) checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
