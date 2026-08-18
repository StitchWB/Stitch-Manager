"""Stitch plugin tooling CLI.

Runnable via ``python -m stitch_plugin_tools``:

    keygen --out <dir>                          generate ed25519 keypair
    sign <package_dir> --key <private.key>      sign a plugin package
    verify <package_dir> --pubkey <public.key>  verify a plugin package
"""

from __future__ import annotations

__all__ = ["main"]
