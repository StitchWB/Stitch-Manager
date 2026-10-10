"""Vendor the canonical RpcPluginServer + plugin helpers into plugin packages.

Extracts the server-side subset from ``autoreg/plugin/rpc.py`` and writes
it into ``<pkg>/_vendor/rpc_server.py`` so service plugins run standalone
(no ``autoreg`` on ``sys.path``) without carrying an inline fallback class.
``autoreg/plugin/helpers.py`` is small enough to vendor as a whole-file
copy to ``<pkg>/_vendor/plugin_helpers.py`` (no AST extraction).

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
import os
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


# stitch_plugin_tools/vendoring.py → python/ → autoreg/plugin/rpc.py
_REPO_RPC_PATH = Path(__file__).resolve().parents[1] / "autoreg" / "plugin" / "rpc.py"

_BUNDLED_RPC_PATH = (
    Path(__file__).resolve().parent / "_bundled" / "rpc_server_canon.py"
)

_REPO_HELPERS_PATH = (
    Path(__file__).resolve().parents[1] / "autoreg" / "plugin" / "helpers.py"
)

_BUNDLED_HELPERS_PATH = (
    Path(__file__).resolve().parent / "_bundled" / "plugin_helpers_canon.py"
)


class CanonicalRpcSourceError(RuntimeError):
    """A canonical ``autoreg/plugin/`` source (rpc.py or helpers.py) could not be resolved.

    Raised when every resolution step fails: ``STITCH_PLUGIN_CANON`` unset
    or dangling (rpc.py only), the repo-relative file absent, and the
    bundled snapshot shipped inside ``stitch_plugin_tools`` missing too.
    """


def _canonical_rpc_source() -> str:
    """Return the canonical ``autoreg/plugin/rpc.py`` text (LF-normalized).

    Resolution order:
      1. ``STITCH_PLUGIN_CANON`` — path to a canonical rpc.py; a set but
         dangling value raises instead of silently falling through.
      2. The repo-relative ``autoreg/plugin/rpc.py`` (hub checkout layout).
      3. The bundled snapshot ``_bundled/rpc_server_canon.py`` shipped
         inside ``stitch_plugin_tools`` (installs without the ``autoreg``
         tree).

    Raises :class:`CanonicalRpcSourceError` when none resolve.
    """
    env_value = os.environ.get("STITCH_PLUGIN_CANON")
    if env_value:
        env_path = Path(env_value)
        if not env_path.is_file():
            raise CanonicalRpcSourceError(
                f"STITCH_PLUGIN_CANON is set to {env_path} but that file"
                " does not exist; unset it or point it at a valid canonical"
                " rpc.py"
            )
        return env_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if _REPO_RPC_PATH.is_file():
        return _REPO_RPC_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    if _BUNDLED_RPC_PATH.is_file():
        return _BUNDLED_RPC_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    raise CanonicalRpcSourceError(
        "cannot resolve the canonical rpc.py: STITCH_PLUGIN_CANON is not"
        f" set, {_REPO_RPC_PATH} does not exist, and the bundled copy"
        f" {_BUNDLED_RPC_PATH} is missing; set STITCH_PLUGIN_CANON to a"
        " canonical rpc.py or reinstall stitch_plugin_tools"
    )


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

    Raises :class:`CanonicalRpcSourceError` when no canonical source
    resolves (env var, repo-relative, bundled).
    """
    source = _canonical_rpc_source()
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


_HELPERS_HEADER_PREFIX = (
    "# _vendored_from: autoreg/plugin/helpers.py"
    " — do not edit; regenerate via stitch_plugin_tools dev-install\n"
)

_HELPERS_FUTURE_LINE = "from __future__ import annotations\n"


def _canonical_helpers_source() -> str:
    """Return the canonical ``autoreg/plugin/helpers.py`` text (LF-normalized).

    Resolution order:
      1. The repo-relative ``autoreg/plugin/helpers.py`` (hub checkout
         layout).
      2. The bundled snapshot ``_bundled/plugin_helpers_canon.py`` shipped
         inside ``stitch_plugin_tools`` (installs without the ``autoreg``
         tree).

    Raises :class:`CanonicalRpcSourceError` when neither resolves.
    """
    if _REPO_HELPERS_PATH.is_file():
        return _REPO_HELPERS_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    if _BUNDLED_HELPERS_PATH.is_file():
        return _BUNDLED_HELPERS_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    raise CanonicalRpcSourceError(
        f"cannot resolve the canonical helpers.py: {_REPO_HELPERS_PATH} does"
        f" not exist and the bundled copy {_BUNDLED_HELPERS_PATH} is missing;"
        " reinstall stitch_plugin_tools"
    )


def canonical_plugin_helpers_text() -> str:
    """Return the canonical vendored ``plugin_helpers.py`` text (LF-normalized).

    Whole-file copy of the canonical ``autoreg/plugin/helpers.py`` with the
    vendored-from marker comment prepended and ``_VENDOR_SOURCE_SHA256``
    inserted right after the ``from __future__`` import (same header layout
    as the vendored ``rpc_server.py`` — an assignment before
    ``from __future__`` would be a SyntaxError).  The hash covers the full
    vendored text EXCLUDING the hash line itself (same self-reference
    avoidance as ``rpc_server.py``).

    Raises :class:`CanonicalRpcSourceError` when no canonical source
    resolves (repo-relative or bundled).
    """
    source = _canonical_helpers_source()
    if _HELPERS_FUTURE_LINE not in source:
        raise RuntimeError(
            "canonical helpers.py: 'from __future__ import annotations' not found"
        )
    text_for_hash = _HELPERS_HEADER_PREFIX + source
    sha = hashlib.sha256(text_for_hash.encode("utf-8")).hexdigest()
    return _HELPERS_HEADER_PREFIX + source.replace(
        _HELPERS_FUTURE_LINE,
        _HELPERS_FUTURE_LINE + _HASH_LINE_TEMPLATE.format(hash=sha),
        1,
    )


def vendor_plugin_helpers(package_dir: Path) -> Path:
    """Write the canonical ``_vendor/plugin_helpers.py`` into ``package_dir``.

    Mirrors :func:`vendor_rpc_server`: creates ``<package_dir>/_vendor/``
    (with the ``__init__.py`` marker) if absent and writes the canonical
    helpers text.  Idempotent — an already-canonical file is left untouched.

    Args:
        package_dir: The Python package directory (the one containing
            ``__main__.py``), NOT the plugin package root.

    Returns:
        The path to the written ``plugin_helpers.py``.
    """
    vendor_dir = package_dir / "_vendor"
    vendor_dir.mkdir(parents=True, exist_ok=True)

    init_path = vendor_dir / "__init__.py"
    if not init_path.exists():
        init_path.write_text(
            '"""Vendored RPC server — regenerated by stitch_plugin_tools."""\n',
            encoding="utf-8",
        )

    helpers_path = vendor_dir / "plugin_helpers.py"
    canonical = canonical_plugin_helpers_text()
    if helpers_path.is_file():
        existing = helpers_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if existing == canonical:
            return helpers_path  # idempotent — no write needed
    helpers_path.write_text(canonical, encoding="utf-8")
    return helpers_path


def vendor_all(package_dir: Path) -> list[Path]:
    """Vendor every canonical module (``rpc_server.py`` + ``plugin_helpers.py``).

    Single entry point for all refresh paths (scaffold, vendor CLI,
    dev-install, publish, run) so a package's ``_vendor/`` is always complete.

    Returns:
        The paths written, in vendor order.
    """
    return [vendor_rpc_server(package_dir), vendor_plugin_helpers(package_dir)]
