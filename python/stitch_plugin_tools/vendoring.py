"""Vendor the canonical RpcPluginServer into plugin packages (scaffold v3).

Extracts the server-side subset from ``autoreg/plugin/rpc.py`` and writes
it into ``<pkg>/_vendor/rpc_server.py`` so service plugins run standalone
(no ``autoreg`` on ``sys.path``) without carrying an inline fallback class.

Extraction is AST-driven and byte-stable: the same canonical source always
produces the same vendored file.  The vendored module is importable
standalone (stdlib-only: ``json``, ``sys``, ``threading``, ``time``,
``typing.Any``).

Symbols extracted:
  - ``_JSONRPC``, ``_ERR_INTERNAL`` constants
  - ``RpcError``, ``RpcTimeoutError``, ``RpcProtocolError``,
    ``RpcCallError`` exception classes
  - ``RpcPluginServer`` class
  - ``_error`` helper function

The client-side symbols (``RpcPluginClient``, ``_PendingCall``,
``_make_request``, ``logger``) are NOT extracted — plugins only need the
server side.
"""

from __future__ import annotations

import ast
from pathlib import Path

# Symbols to extract from the canonical rpc.py, in output order.
# Each entry is (ast node type, name).
_TARGET_SYMBOLS: list[tuple[type, str]] = [
    (ast.Assign, "_JSONRPC"),
    (ast.Assign, "_ERR_INTERNAL"),
    (ast.ClassDef, "RpcError"),
    (ast.ClassDef, "RpcTimeoutError"),
    (ast.ClassDef, "RpcProtocolError"),
    (ast.ClassDef, "RpcCallError"),
    (ast.ClassDef, "RpcPluginServer"),
    (ast.FunctionDef, "_error"),
]

# Header prepended to every vendored file.
_HEADER = (
    "# _vendored_from: autoreg/plugin/rpc.py"
    " — do not edit; regenerate via stitch_plugin_tools dev-install\n"
    "\n"
    "from __future__ import annotations\n"
    "\n"
    "import json\n"
    "import sys\n"
    "import threading\n"
    "import time\n"
    "from typing import Any\n"
)

# Stdlib imports the extracted symbols reference (for the import block).
# These are the ONLY imports the server-side subset needs.


def _canonical_rpc_path() -> Path:
    """Resolve the path to ``autoreg/plugin/rpc.py`` from this module."""
    # stitch_plugin_tools/vendoring.py → python/ → autoreg/plugin/rpc.py
    return Path(__file__).resolve().parents[1] / "autoreg" / "plugin" / "rpc.py"


def _extract_symbol_sources(source: str, tree: ast.Module) -> list[str]:
    """Extract the source text of each target symbol in output order.

    Returns a list of source snippets (one per symbol) with surrounding
    blank lines stripped to exactly two trailing newlines for stable
    separation.
    """
    # Build a map of (node_type, name) -> (lineno, end_lineno).
    found: dict[tuple[type, str], tuple[int, int]] = {}
    for node in tree.body:
        for node_type, name in _TARGET_SYMBOLS:
            if isinstance(node, node_type):
                target_name = _node_name(node, name)
                if target_name == name:
                    found[(node_type, name)] = (node.lineno, node.end_lineno or node.lineno)

    snippets: list[str] = []
    lines = source.splitlines(keepends=False)
    for node_type, name in _TARGET_SYMBOLS:
        key = (node_type, name)
        if key not in found:
            raise RuntimeError(
                f"canonical rpc.py: symbol {name!r} ({node_type.__name__}) not found"
            )
        lineno, end_lineno = found[key]
        # ast line numbers are 1-based; list is 0-based.
        snippet_lines = lines[lineno - 1 : end_lineno]
        snippet = "\n".join(snippet_lines).rstrip()
        snippets.append(snippet)

    return snippets


def _node_name(node: ast.stmt, expected: str) -> str | None:
    """Extract the name of an Assign (first target id) or ClassDef/FunctionDef."""
    if isinstance(node, ast.ClassDef) or isinstance(node, ast.FunctionDef):
        return node.name
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == expected:
                return target.id
    return None


def canonical_rpc_server_text() -> str:
    """Return the canonical vendored ``rpc_server.py`` text (LF-normalized).

    This is the exact text that :func:`vendor_rpc_server` writes to
    ``<pkg>/_vendor/rpc_server.py``.  Tests and the upgrade tool use it
    for byte-equality comparison.
    """
    rpc_path = _canonical_rpc_path()
    source = rpc_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    tree = ast.parse(source)
    snippets = _extract_symbol_sources(source, tree)

    parts = [_HEADER.rstrip("\n")]
    for snippet in snippets:
        parts.append(snippet)
    # Join with exactly two newlines between sections (PEP 8 two-blank-line
    # separation).  The file ends with a single trailing newline.
    body = "\n\n\n".join(parts) + "\n"
    return body


def vendor_rpc_server(package_dir: Path) -> Path:
    """Write the canonical ``_vendor/`` package into ``package_dir``.

    Creates ``<package_dir>/_vendor/__init__.py`` (empty marker) and
    ``<package_dir>/_vendor/rpc_server.py`` (the vendored server).  If the
    vendored file already exists and matches the canonical text, it is left
    untouched (idempotent).  Otherwise it is overwritten.

    Args:
        package_dir: The Python package directory (the one containing
            ``__main__.py``), NOT the plugin package root.

    Returns:
        The path to the written ``rpc_server.py``.
    """
    vendor_dir = package_dir / "_vendor"
    vendor_dir.mkdir(parents=True, exist_ok=True)

    # __init__.py — empty marker so _vendor is a proper subpackage.
    init_path = vendor_dir / "__init__.py"
    if not init_path.exists():
        init_path.write_text(
            '"""Vendored RPC server — regenerated by stitch_plugin_tools."""\n',
            encoding="utf-8",
        )

    # rpc_server.py — the canonical vendored text.
    rpc_path = vendor_dir / "rpc_server.py"
    canonical = canonical_rpc_server_text()
    if rpc_path.is_file():
        existing = rpc_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if existing == canonical:
            return rpc_path  # idempotent — no write needed
    rpc_path.write_text(canonical, encoding="utf-8")
    return rpc_path
