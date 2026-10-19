"""Scaffold-generation detection for :mod:`stitch_plugin_tools.upgrade`.

AST helpers (fallback-block / docstring location), the v3 try-import
extraction, version keys, and ``detect_scaffold_version``.  All names are
re-exported from ``stitch_plugin_tools.upgrade``.
"""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from autoreg.plugin.manifest import MANIFEST_FILENAME
from stitch_plugin_tools.scaffold import (
    _MAIN_TEMPLATE,
    MARKER_PREFIX,
    SCAFFOLD_VERSION,
)

if TYPE_CHECKING:
    from pathlib import Path

# Marker: prerelease tags sort before same-numbered releases (v2-alpha < v2 < v3-alpha < v3).
_MARKER_RE = re.compile(
    rf"^{re.escape(MARKER_PREFIX)}(\d+)(?:-([0-9A-Za-z._]+))?[ \t]*$",
    re.MULTILINE,
)

# Fallback v3 try-import block, used only if extraction from scaffold's _MAIN_TEMPLATE fails; a test checks they match.
_V3_TRY_IMPORT_FALLBACK = (
    "try:\n"
    "    from autoreg.plugin.rpc import RpcPluginServer\n"
    "except ImportError:\n"
    "    from ._vendor.rpc_server import RpcPluginServer"
)


def _extract_v3_try_import_from_template() -> str:
    """Extract the v3 try-import block from scaffold's ``_MAIN_TEMPLATE``.

    Formats the template (to resolve ``{placeholder}``s), parses it with
    ``ast.parse``, finds the top-level ``Try`` with an ``ImportError``
    handler whose body imports ``RpcPluginServer`` from
    ``autoreg.plugin.rpc``, and returns its source text.  Returns the
    fallback constant on any failure.
    """
    try:
        formatted = _MAIN_TEMPLATE.format(
            plugin_id="_extract",
            pkg_name="_extract",
            scaffold_version=SCAFFOLD_VERSION,
        )
        tree = ast.parse(formatted)
    except Exception:  # noqa: BLE001 — best-effort extraction
        return _V3_TRY_IMPORT_FALLBACK
    for node in tree.body:
        if not isinstance(node, ast.Try):
            continue
        if not _try_body_imports_rpc_server(node):
            continue
        if not any(_is_importerror_handler(h) for h in node.handlers):
            continue
        segment = ast.get_source_segment(formatted, node)
        if segment is not None:
            return segment.rstrip("\n")
    return _V3_TRY_IMPORT_FALLBACK


# ── AST helpers ───────────────────────────────────────────────────────────


def _is_importerror_handler(handler: ast.ExceptHandler) -> bool:
    """True if the handler catches ``ImportError`` (or a tuple containing it)."""
    exc = handler.type
    if exc is None:
        return False
    if isinstance(exc, ast.Name) and exc.id == "ImportError":
        return True
    if isinstance(exc, ast.Tuple):
        return any(
            isinstance(e, ast.Name) and e.id == "ImportError" for e in exc.elts
        )
    return False


def _try_body_imports_rpc_server(node: ast.Try) -> bool:
    """True if the try body imports ``RpcPluginServer`` from ``autoreg.plugin.rpc``."""
    for stmt in node.body:
        if (
            isinstance(stmt, ast.ImportFrom)
            and stmt.module == "autoreg.plugin.rpc"
            and any(a.name == "RpcPluginServer" for a in stmt.names)
        ):
            return True
    return False


def _is_v2_fallback(node: ast.Try) -> bool:
    """True if the Try's except handler contains a ``ClassDef`` (inline class).

    v2-era blocks carry the inline ``RpcPluginServer`` class in the
    ``except ImportError`` handler.  v3 blocks have a single
    ``ImportFrom`` from ``._vendor.rpc_server`` instead.
    """
    for handler in node.handlers:
        if not _is_importerror_handler(handler):
            continue
        for stmt in handler.body:
            if isinstance(stmt, ast.ClassDef):
                return True
    return False


def _line_start_offsets(text: str) -> list[int]:
    """Return a list where ``offsets[i]`` is the byte offset of line ``i+1``.

    ``offsets[0]`` is always 0 (start of line 1).  The length of the list
    equals the number of lines (including a trailing empty line if the
    text ends with ``\\n``).
    """
    offsets = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def _find_fallback_try(text: str) -> tuple[int, int, ast.Try] | None:
    """Find the top-level ``Try`` with ``ImportError`` handler + RPC import.

    Returns ``(start_offset, end_offset, try_node)`` where:
    - ``start_offset`` = byte offset of the ``Try``'s first line
    - ``end_offset`` = byte offset of the next top-level def/class after
      the ``Try`` (or ``len(text)`` if none)
    - ``try_node`` = the ``ast.Try`` node

    Returns ``None`` when no such ``Try`` exists or the text is not
    valid Python.
    """
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    offsets = _line_start_offsets(text)
    for i, node in enumerate(tree.body):
        if not isinstance(node, ast.Try):
            continue
        if not _try_body_imports_rpc_server(node):
            continue
        if not any(_is_importerror_handler(h) for h in node.handlers):
            continue
        start = offsets[node.lineno - 1] if node.lineno - 1 < len(offsets) else 0
        # Find the next top-level def/class after this Try.
        end = len(text)
        for j in range(i + 1, len(tree.body)):
            nxt = tree.body[j]
            if isinstance(
                nxt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
            ):
                end = offsets[nxt.lineno - 1] if nxt.lineno - 1 < len(offsets) else len(text)
                break
        return start, end, node
    return None


def _find_module_docstring(text: str) -> tuple[int, int] | None:
    """Find the real module docstring via AST.

    Returns ``(start_offset, end_offset)`` where ``start_offset`` is the
    byte offset of the docstring's first line and ``end_offset`` is the
    byte offset of the line AFTER the docstring's last line (i.e. the
    point where the marker should be inserted).

    Returns ``None`` when the file is not valid Python or has no module
    docstring (``tree.body[0]`` is not an ``Expr`` with a ``Constant`` str).
    """
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    if not tree.body or not isinstance(tree.body[0], ast.Expr):
        return None
    doc_node = tree.body[0]
    if not isinstance(doc_node.value, ast.Constant) or not isinstance(
        doc_node.value.value, str
    ):
        return None
    offsets = _line_start_offsets(text)
    start = offsets[doc_node.lineno - 1] if doc_node.lineno - 1 < len(offsets) else 0
    after = (
        offsets[doc_node.end_lineno]
        if doc_node.end_lineno is not None and doc_node.end_lineno < len(offsets)
        else len(text)
    )
    return start, after


# Derived from scaffold's _MAIN_TEMPLATE so they never drift; assigned after the AST helpers (extraction calls them).
_V3_TRY_IMPORT = _extract_v3_try_import_from_template()


def _version_key(major: int, prerelease: str | None) -> tuple[int, int, str]:
    """Sortable key: release of N beats any prerelease of N."""
    return (major, 0 if prerelease else 1, prerelease or "")


CURRENT_VERSION_KEY = _version_key(SCAFFOLD_VERSION, None)


def format_version(major: int, prerelease: str | None) -> str:
    """Human-readable scaffold version (``v2``, ``v2-alpha``)."""
    return f"v{major}" + (f"-{prerelease}" if prerelease else "")


# ── Detection ────────────────────────────────────────────────────────────


@dataclass
class DetectedVersion:
    """Scaffold generation a package was generated by (or None = legacy)."""

    major: int
    prerelease: str | None
    source: str  # "marker" | "manifest" | "fallback_block"

    @property
    def key(self) -> tuple[int, int, str]:
        return _version_key(self.major, self.prerelease)

    @property
    def label(self) -> str:
        return format_version(self.major, self.prerelease)


def _package_module_dir(package_dir: Path) -> Path | None:
    """Resolve the Python package dir (the dir holding ``__main__.py``).

    Prefers ``entry.module`` from the manifest; falls back to the single
    subdirectory containing ``__main__.py``.
    """
    manifest_path = package_dir / MANIFEST_FILENAME
    if manifest_path.is_file():
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            raw = None
        if isinstance(raw, dict):
            module = (raw.get("entry") or {}).get("module")
            if isinstance(module, str) and (package_dir / module).is_dir():
                return package_dir / module
    candidates = [
        d for d in package_dir.iterdir()
        if d.is_dir() and (d / "__main__.py").is_file()
    ]
    if len(candidates) == 1:
        return candidates[0]
    return None


def detect_scaffold_version(package_dir: Path) -> DetectedVersion | None:
    """Detect the scaffold generation of a package (None = legacy/unmarked).

    Reads the ``_generated_by`` marker from ``__main__.py`` (then
    ``service.py`` / ``storage.py``); falls back to the manifest
    ``generated_by`` extra; falls back to the v2-era inline fallback
    block pattern in ``__main__.py`` (for packages that predate the
    marker convention but carry the v2 fallback class).
    """
    module_dir = _package_module_dir(package_dir)
    if module_dir is not None:
        for name in ("__main__.py", "service.py", "storage.py"):
            path = module_dir / name
            if not path.is_file():
                continue
            text = path.read_bytes().decode("utf-8", errors="replace")
            match = _MARKER_RE.search(text.replace("\r\n", "\n"))
            if match:
                return DetectedVersion(
                    major=int(match.group(1)),
                    prerelease=match.group(2),
                    source="marker",
                )
    manifest_path = package_dir / MANIFEST_FILENAME
    if manifest_path.is_file():
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            raw = None
        if isinstance(raw, dict):
            generated = raw.get("generated_by")
            if (
                isinstance(generated, dict)
                and generated.get("tool") == "stitch_plugin_tools"
                and isinstance(generated.get("scaffold"), int)
            ):
                return DetectedVersion(
                    major=generated["scaffold"], prerelease=None, source="manifest"
                )
    # v2-era fallback: no marker, but __main__.py has the inline Try/ImportError block with a ClassDef.
    if module_dir is not None:
        main_path = module_dir / "__main__.py"
        if main_path.is_file():
            text = main_path.read_bytes().decode("utf-8", errors="replace")
            text_lf = text.replace("\r\n", "\n")
            found = _find_fallback_try(text_lf)
            if found is not None:
                _, _, try_node = found
                if _is_v2_fallback(try_node):
                    return DetectedVersion(
                        major=2, prerelease=None, source="fallback_block"
                    )
    return None
