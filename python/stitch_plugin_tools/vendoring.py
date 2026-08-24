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

Drift detection: the vendored file header embeds
``_VENDOR_SOURCE_SHA256 = "<hex>"`` — a SHA-256 computed over the full
canonical text EXCLUDING the hash line itself (avoiding self-reference:
the hash line's value depends on the hash, so including it would create
an unsolvable fixed-point).  ``vendored_matches_canonical(package_dir)``
compares the on-disk vendored file against the canonical text so callers
can WARN (not block) when a package's vendored copy has drifted.
"""

from __future__ import annotations

import ast
import hashlib
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

# Header prepended to every vendored file.  The ``_VENDOR_SOURCE_SHA256``
# line is inserted between _HEADER_FUTURE and _HEADER_SUFFIX.  The hash
# is computed over (_HEADER_PREFIX + _HEADER_FUTURE + _HEADER_SUFFIX +
# separator + body) — i.e. the full canonical text EXCLUDING the hash
# line itself.
#
# Layout: comment → from __future__ → _VENDOR_SOURCE_SHA256 → imports.
# ``from __future__ import annotations`` MUST precede the hash assignment
# — Python requires __future__ imports to be the first code statement
# (only comments/blank lines may precede them).  An assignment before
# ``from __future__`` is a SyntaxError.
_HEADER_PREFIX = (
    "# _vendored_from: autoreg/plugin/rpc.py"
    " — do not edit; regenerate via stitch_plugin_tools dev-install\n"
)

# from __future__ must come BEFORE the _VENDOR_SOURCE_SHA256 assignment.
_HEADER_FUTURE = (
    "\n"
    "from __future__ import annotations\n"
)

_HASH_LINE_TEMPLATE = '_VENDOR_SOURCE_SHA256 = "{hash}"\n'

_HEADER_SUFFIX = (
    "\n"
    "import json\n"
    "import sys\n"
    "import threading\n"
    "import time\n"
    "from typing import Any\n"
)

# Two-blank-line separator between header and first symbol (PEP 8).
_SECTION_SEP = "\n\n\n"

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


def _build_header(sha256_hex: str) -> str:
    """Assemble the vendored file header with the source hash embedded."""
    return (
        _HEADER_PREFIX
        + _HEADER_FUTURE
        + _HASH_LINE_TEMPLATE.format(hash=sha256_hex)
        + _HEADER_SUFFIX
    )


def canonical_rpc_server_text() -> str:
    """Return the canonical vendored ``rpc_server.py`` text (LF-normalized).

    This is the exact text that :func:`vendor_rpc_server` writes to
    ``<pkg>/_vendor/rpc_server.py``.  Tests and the upgrade tool use it
    for byte-equality comparison.

    The header embeds ``_VENDOR_SOURCE_SHA256`` — a SHA-256 over the full
    canonical text EXCLUDING the hash line itself (avoids self-reference).
    """
    rpc_path = _canonical_rpc_path()
    source = rpc_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    tree = ast.parse(source)
    snippets = _extract_symbol_sources(source, tree)

    # Body: symbols joined with two blank lines (PEP 8 two-blank-line
    # separation).  The file ends with a single trailing newline.
    body = _SECTION_SEP.join(snippets) + "\n"

    # Compute the source hash over the full canonical text EXCLUDING the
    # hash line itself.  The hash line's value depends on the hash, so
    # including it would create an unsolvable self-referential fixed-point.
    text_for_hash = _HEADER_PREFIX + _HEADER_FUTURE + _HEADER_SUFFIX + _SECTION_SEP + body
    sha = hashlib.sha256(text_for_hash.encode("utf-8")).hexdigest()

    header = _build_header(sha)
    return header + _SECTION_SEP + body


def vendored_matches_canonical(module_dir: Path) -> bool:
    """Return True if the module's vendored rpc_server.py matches canonical.

    ``module_dir`` is the Python package directory containing ``__main__.py``
    (the same convention as :func:`vendor_rpc_server`), NOT the plugin
    package root.  A module whose vendored file has drifted (edited by hand,
    or generated from a different canonical source) returns False.  Modules
    without a vendored file return False.  Never raises — callers use this
    to WARN (not block) on drift.
    """
    rpc_path = module_dir / "_vendor" / "rpc_server.py"
    if not rpc_path.is_file():
        return False
    try:
        existing = rpc_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    except OSError:
        return False
    return existing == canonical_rpc_server_text()


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
