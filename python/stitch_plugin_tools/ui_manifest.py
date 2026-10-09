"""Declarative UI contribution gate (F06, WS4).

Validates the ``contributions`` block of a service-plugin manifest so that
manifest drift fails at dev-install and publish time instead of silently
rendering a broken page.

Errors (block dev-install / publish / CI):

  1. A declarative page node uses a kind outside the frozen v2 vocabulary
     (heading, section, field, table, button, card_grid, markdown) or a
     ``field`` type outside (text, select, toggle).
  2. A referenced command (button.command, source.command,
     rowActions[].command, card.action.command, toggle field source.command)
     is not declared in ``contributions.commands``.
  3. A referenced i18n key (text/title/label/placeholder/empty/hint/confirm
     and table column labels, tab labels, page title) does not resolve in
     BOTH the ``ru`` and ``en`` bundles.
  4. ``button.paramsFrom`` targets a ``field`` id that is not declared on the
     page.
  5. A declared i18n key in the plugin namespace is referenced by no
     declarative node or tab label and appears as no quoted string literal
     in the manager frontend sources (dead key).  Host code consumes plugin
     bundles directly (``t('plugin.<id>.<key>')`` in core-page wrappers), so
     a src literal revives a key the declarative tree does not reference.

Warnings (never block): a ``paramsFromRow`` target that is not a declared
table column — rows may legitimately carry extra keys (e.g. totp rows expose
``id`` without a visible column); and a ``refreshOnSuccess`` node id that is
not on the page — the renderer ignores unknown ids.  Dead-key detection is
skipped for ``ui.kind=core_page`` because the core React page owns those keys.

Honest scope: see docs/service-plugins.md — semantic param inversion and
runtime data strings are NOT caught.
"""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path
from typing import Any

NODE_KINDS = frozenset(
    {"heading", "section", "field", "table", "button", "card_grid", "markdown"}
)
FIELD_KINDS = frozenset({"text", "select", "toggle"})
UI_KINDS = frozenset({"declarative", "core_page"})
LOCALES = ("ru", "en")

_REPO_SRC = Path(__file__).resolve().parents[2] / "src"
_SRC_SUFFIXES = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"})
_src_blob_cache: dict[str, str | None] = {}


def _src_literal_blob(src_root: Path | None) -> str | None:
    root = _REPO_SRC if src_root is None else Path(src_root)
    cache_key = str(root)
    if cache_key not in _src_blob_cache:
        if not root.is_dir():
            _src_blob_cache[cache_key] = None
        else:
            parts: list[str] = []
            for path in sorted(root.rglob("*")):
                if path.suffix in _SRC_SUFFIXES and path.is_file():
                    parts.append(path.read_text(encoding="utf-8", errors="replace"))
            _src_blob_cache[cache_key] = "\n".join(parts)
    return _src_blob_cache[cache_key]


def _live_in_src(plugin_id: str, key: str, blob: str) -> bool:
    for value in (key, f"plugin.{plugin_id}.{key}"):
        for quote in ("'", '"', "`"):
            if f"{quote}{value}{quote}" in blob:
                return True
    return False


def _resolve_key(bundle: Any, key: str) -> bool:
    node = bundle
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return False
        node = node[part]
    return isinstance(node, str)


def _leaf_paths(node: Any, prefix: tuple[str, ...] = ()) -> list[tuple[str, ...]]:
    if isinstance(node, dict):
        out: list[tuple[str, ...]] = []
        for key, value in node.items():
            out.extend(_leaf_paths(value, prefix + (str(key),)))
        return out
    return [prefix] if isinstance(node, str) else []


def _field_ids(nodes: Any) -> set[str]:
    ids: set[str] = set()
    if not isinstance(nodes, list):
        return ids
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("kind") == "field" and isinstance(node.get("id"), str):
            ids.add(node["id"])
        if node.get("kind") == "section":
            ids |= _field_ids(node.get("nodes"))
    return ids


def _node_ids(nodes: Any) -> set[str]:
    ids: set[str] = set()
    if not isinstance(nodes, list):
        return ids
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("id"), str):
            ids.add(node["id"])
        if node.get("kind") == "section":
            ids |= _node_ids(node.get("nodes"))
    return ids


class _PageLinter:
    def __init__(self, plugin_id: str, declared: set[str], bundles: dict) -> None:
        self.plugin_id = plugin_id
        self.declared = declared
        self.bundles = bundles
        self.fields: set[str] = set()
        self.node_ids: set[str] = set()
        self.used: set[tuple[str, ...]] = set()
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def _is_key(self, value: Any) -> bool:
        return isinstance(value, str) and value.startswith(self.plugin_id + ".")

    def key(self, loc: str, value: Any) -> None:
        if not self._is_key(value):
            return
        self.used.add(tuple(value.split(".")))
        for locale in LOCALES:
            if not _resolve_key(self.bundles.get(locale), value):
                self.errors.append(
                    f"{loc}: i18n key {value!r} does not resolve in the "
                    f"{locale!r} bundle"
                )

    def command(self, loc: str, value: Any) -> None:
        if not isinstance(value, str) or not value:
            self.errors.append(f"{loc}: missing command name")
        elif value not in self.declared:
            self.errors.append(
                f"{loc}: command {value!r} is not declared in "
                f"contributions.commands"
            )

    def params_from(self, module: dict, loc: str) -> None:
        params_from = module.get("paramsFrom")
        if not isinstance(params_from, dict):
            return
        for param, target in params_from.items():
            if target not in self.fields:
                self.errors.append(
                    f"{loc}.paramsFrom[{param}]: target field {target!r} is "
                    f"not declared on the page"
                )

    def action(self, action: Any, loc: str, columns: set[str] | None) -> None:
        if not isinstance(action, dict):
            return
        self.key(f"{loc}.label", action.get("label"))
        self.command(f"{loc}.command", action.get("command"))
        params_from_row = action.get("paramsFromRow")
        if isinstance(params_from_row, dict) and columns is not None:
            for param, target in params_from_row.items():
                if target not in columns:
                    self.warnings.append(
                        f"{loc}.paramsFromRow[{param}]: target {target!r} is "
                        f"not a declared column (allowed when the row carries "
                        f"the key)"
                    )

    def visit(self, node: Any, loc: str) -> None:
        if not isinstance(node, dict):
            self.errors.append(f"{loc}: node must be an object")
            return
        kind = node.get("kind")
        if kind not in NODE_KINDS:
            self.errors.append(
                f"{loc}: unknown node kind {kind!r} "
                f"(vocabulary: {', '.join(sorted(NODE_KINDS))})"
            )
            return
        if kind == "section":
            self.key(f"{loc}.title", node.get("title"))
            for i, child in enumerate(node.get("nodes") or []):
                self.visit(child, f"{loc}.nodes[{i}]")
            return
        if kind == "heading":
            self.key(f"{loc}.text", node.get("text"))
            return
        if kind == "field":
            field_type = node.get("field")
            if field_type not in FIELD_KINDS:
                self.errors.append(
                    f"{loc}.field: unknown field type {field_type!r} "
                    f"(vocabulary: {', '.join(sorted(FIELD_KINDS))})"
                )
            self.key(f"{loc}.label", node.get("label"))
            self.key(f"{loc}.placeholder", node.get("placeholder"))
            source = node.get("source")
            if isinstance(source, dict):
                self.command(f"{loc}.source.command", source.get("command"))
            for i, option in enumerate(node.get("options") or []):
                if isinstance(option, dict):
                    self.key(f"{loc}.options[{i}].label", option.get("label"))
            return
        if kind == "button":
            self.key(f"{loc}.label", node.get("label"))
            self.key(f"{loc}.confirm", node.get("confirm"))
            self.command(f"{loc}.command", node.get("command"))
            self.params_from(node, loc)
            refresh = node.get("refreshOnSuccess")
            if isinstance(refresh, list):
                for target in refresh:
                    if isinstance(target, str) and target not in self.node_ids:
                        self.warnings.append(
                            f"{loc}.refreshOnSuccess: node id {target!r} is "
                            f"not declared on the page (ignored at render)"
                        )
            return
        if kind == "table":
            source = node.get("source")
            self.command(
                f"{loc}.source.command",
                source.get("command") if isinstance(source, dict) else None,
            )
            self.key(f"{loc}.empty", node.get("empty"))
            columns: set[str] = set()
            for i, col in enumerate(node.get("columns") or []):
                if isinstance(col, dict):
                    if isinstance(col.get("key"), str):
                        columns.add(col["key"])
                    self.key(f"{loc}.columns[{i}].label", col.get("label"))
            for i, act in enumerate(node.get("rowActions") or []):
                self.action(act, f"{loc}.rowActions[{i}]", columns)
            return
        if kind == "card_grid":
            source = node.get("source")
            self.command(
                f"{loc}.source.command",
                source.get("command") if isinstance(source, dict) else None,
            )
            self.key(f"{loc}.empty", node.get("empty"))
            card = node.get("card")
            if isinstance(card, dict):
                self.key(f"{loc}.card.hint", card.get("hint"))
                self.action(card.get("action"), f"{loc}.card.action", None)
            return
        if kind == "markdown":
            source = node.get("source")
            self.command(
                f"{loc}.source.command",
                source.get("command") if isinstance(source, dict) else None,
            )
            self.key(f"{loc}.empty", node.get("empty"))
            return


def lint_contributions(
    plugin_id: str, contributions: Any, src_root: Path | None = None
) -> tuple[list[str], list[str]]:
    """Return ``(errors, warnings)`` for a plugin's contributions block.

    ``src_root`` overrides the manager frontend sources consulted by the
    dead-key rule (default: the ``src/`` tree of the repository hosting this
    tool; a missing tree disables the literal escape and keeps the rule strict).
    """
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(contributions, dict):
        return errors, warnings

    commands = contributions.get("commands")
    declared = (
        {
            entry.get("name")
            for entry in commands
            if isinstance(entry, dict) and isinstance(entry.get("name"), str)
        }
        if isinstance(commands, list)
        else set()
    )

    i18n = contributions.get("i18n")
    bundles = i18n if isinstance(i18n, dict) else {}

    ui = contributions.get("ui")
    if not isinstance(ui, dict):
        return errors, warnings

    ui_kind = ui.get("kind")
    if ui_kind not in UI_KINDS:
        errors.append(
            f"ui.kind: must be one of {', '.join(sorted(UI_KINDS))}, "
            f"got {ui_kind!r}"
        )
        return errors, warnings

    linter = _PageLinter(plugin_id, declared, bundles)

    tabs = ui.get("tabs")
    if isinstance(tabs, list):
        for i, tab in enumerate(tabs):
            if isinstance(tab, dict):
                linter.key(f"ui.tabs[{i}].label", tab.get("label"))

    if ui_kind == "declarative":
        page = ui.get("page")
        if not isinstance(page, dict):
            errors.append("ui.page: declarative ui requires a page object")
        else:
            linter.fields = _field_ids(page.get("nodes"))
            linter.node_ids = _node_ids(page.get("nodes"))
            linter.key("ui.page.title", page.get("title"))
            for i, node in enumerate(page.get("nodes") or []):
                linter.visit(node, f"ui.page.nodes[{i}]")
            literals = _src_literal_blob(src_root)
            for locale in LOCALES:
                bundle = bundles.get(locale)
                if not isinstance(bundle, dict):
                    continue
                seen: set[tuple[str, ...]] = set()
                for leaf in _leaf_paths(bundle):
                    if leaf in seen:
                        continue
                    seen.add(leaf)
                    if leaf in linter.used:
                        continue
                    key = ".".join(leaf)
                    if literals is not None and _live_in_src(plugin_id, key, literals):
                        continue
                    linter.errors.append(
                        f"dead i18n key in {locale!r} bundle: {key}"
                    )

    errors.extend(linter.errors)
    warnings.extend(linter.warnings)
    return errors, warnings


def assert_contributions(plugin_id: str, contributions: Any) -> None:
    """Raise ``ValueError`` when a plugin's UI contributions are invalid.

    Warnings never raise (they are surfaced by :func:`lint_paths`).
    """
    errors, _warnings = lint_contributions(plugin_id, contributions)
    if errors:
        raise ValueError(
            f"manifest {plugin_id} has invalid UI contributions:\n  "
            + "\n  ".join(errors)
        )


def lint_paths(patterns: list[str]) -> int:
    """Validate manifest UI contributions for paths/globs. Return exit code."""
    paths: list[str] = []
    for pattern in patterns:
        matched = sorted(glob.glob(pattern))
        paths.extend(matched if matched else [pattern])
    if not paths:
        print("error: no manifest paths matched", file=sys.stderr)
        return 1

    total_errors = 0
    total_warnings = 0
    for raw_path in paths:
        path = Path(raw_path)
        if not path.is_file():
            print(f"  FAIL  {path}: manifest file not found", file=sys.stderr)
            total_errors += 1
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"  FAIL  {path}: {exc}", file=sys.stderr)
            total_errors += 1
            continue

        plugin_id = raw.get("id") if isinstance(raw, dict) else None
        contributions = (
            raw.get("contributions", {}) if isinstance(raw, dict) else {}
        )
        label = plugin_id if isinstance(plugin_id, str) else path.name
        errors, warnings = lint_contributions(str(label), contributions)
        if errors:
            for error in errors:
                print(f"  FAIL  {label}: {error}")
            total_errors += len(errors)
        else:
            print(f"  OK    {label}")
        for warning in warnings:
            print(f"  WARN  {label}: {warning}")
            total_warnings += 1

    print(
        f"\n{len(paths)} manifest(s): {total_errors} error(s), "
        f"{total_warnings} warning(s)"
    )
    return 0 if total_errors == 0 else 1
