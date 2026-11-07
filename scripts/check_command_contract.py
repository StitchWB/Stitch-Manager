#!/usr/bin/env python3
"""Frontend/backend command contract gate.

Catches the class of bugs where the frontend calls a command name that the
active backend cannot dispatch.  Two cases it covers that other audits miss:

  - FE invocations via ``safeInvoke('foo')`` that resolve to nothing in the
    backend checkout's ``@register_command`` / ``@command`` decorators AND
    no plugin manifest declares them.
  - Decorators that exist in source but belong to a different backend
    checkout than the one currently driving the FE (e.g. dev workspace
    uses the hub's backend but the FE was synced from public).

Output: prints a table of FE commands that the configured backend cannot
dispatch and exits 1.  Exit 0 when every FE command resolves to a handler
in (decorators \u222a plugin commands).

Test fixtures live in ``python/tests/test_check_command_contract.py``.
The gate runs pre-start from ``scripts/workspace.ps1`` and ``Action Check``.

Usage:
    python scripts/check_command_contract.py \\
        --frontend-src src \\
        --backend-python ../IDE-Account-Manager/python \\
        --plugins-dir ../IDE-Account-Manager/plugins-src \\
        [--plugins-dir ...] [--json]
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import io
import json
import re
import sys
from pathlib import Path

RE_SAFE_INVOKE = re.compile(
    r"""safeInvoke(?:WithRetry)?\s*(?:<[^>]{0,200}>)?\s*\(\s*['"]([a-z0-9_.]+)['"]"""
)
RE_DECORATOR = re.compile(
    r"""@(?:register_command|command)\(\s*['"]([a-z0-9_.]+)['"]"""
)
RE_DUAL_KEY = re.compile(
    r"""^\s*['"]([a-z][a-z0-9_]+)['"]\s*:\s*['"][a-z][a-z0-9_]*['"]"""
)
RE_TEST_PATH = re.compile(r"(?:^|[\\/])__tests__[\\/]|(?<![A-Za-z0-9_])(?:\.test\.|\.spec\.)")

TEST_ONLY_COMMANDS = frozenset()

EXCLUDED_DIR_PARTS = frozenset({
    "__pycache__",
    ".ruff_cache",
    ".mypy_cache",
    ".pytest_cache",
    ".git",
    "node_modules",
    "dist",
    "build",
    ".egg-info",
})


def _is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_DIR_PARTS for part in path.parts)


def extract_fe(src_root: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not src_root.is_dir():
        raise SystemExit(f"frontend-src not a directory: {src_root}")
    for path in src_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in (".ts", ".tsx"):
            continue
        if path.name.endswith(".d.ts"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if RE_TEST_PATH.search(text[:0] + str(path)):
            continue
        rel = str(path)
        if RE_TEST_PATH.search(rel):
            continue
        for match in RE_SAFE_INVOKE.finditer(text):
            out.setdefault(match.group(1), []).append(rel)
    return out


def extract_decorators(py_root: Path) -> set[str]:
    out: set[str] = set()
    if not py_root.is_dir():
        raise SystemExit(f"backend-python not a directory: {py_root}")
    for path in py_root.rglob("*.py"):
        if _is_excluded(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in RE_DECORATOR.finditer(text):
            out.add(match.group(1))
    return out


_COMMAND_CALL_NAMES = frozenset({"command", "register_command"})


def _is_command_call(node: ast.Call) -> bool:
    return isinstance(node.func, ast.Name) and node.func.id in _COMMAND_CALL_NAMES


def _fstring_single_placeholder(node: ast.JoinedStr) -> tuple[str, str] | None:
    """Return ``(template, var)`` when the f-string has exactly one ``{var}``
    placeholder that is a plain name; ``None`` otherwise.  The template keeps
    the placeholder as ``{var}`` so callers can substitute concrete values."""
    parts: list[str] = []
    var: str | None = None
    for value in node.values:
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            parts.append(value.value)
        elif isinstance(value, ast.FormattedValue):
            if var is not None or not isinstance(value.value, ast.Name):
                return None
            var = value.value.id
            parts.append(f"{{{var}}}")
        else:
            return None
    if var is None:
        return None
    return "".join(parts), var


def _module_string_lists(tree: ast.Module) -> dict[str, list[str]]:
    """Map ``NAME = ["a", "b", ...]`` to its literal values."""
    out: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target, value = node.targets[0], node.value
        if not (isinstance(target, ast.Name) and isinstance(value, ast.List)):
            continue
        if not value.elts or not all(
            isinstance(elt, ast.Constant) and isinstance(elt.value, str)
            for elt in value.elts
        ):
            continue
        out[target.id] = [elt.value for elt in value.elts if isinstance(elt, ast.Constant)]
    return out


def _function_first_param(tree: ast.Module, name: str) -> str | None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            if node.args.args:
                return node.args.args[0].arg
            return None
    return None


def _dynamic_commands_in_module(tree: ast.Module) -> set[str]:
    """Expand factory-loop command registrations the decorator regex cannot see.

    Catches the ``api_keys/commands.py`` shape::

        _PROVIDERS = ["gemini", "openai", ...]

        def _make_get_cmd(provider: str):
            ...
            command(f"get_{provider}_api_keys")(handler)

        for _p in _PROVIDERS:
            _make_get_cmd(_p)

    and the direct shape ``for _p in _PROVIDERS: command(f"get_{_p}_api_keys")``.
    Only single-placeholder f-strings bound (directly or through the factory's
    first parameter) to the loop variable are expanded.
    """
    out: set[str] = set()
    lists = _module_string_lists(tree)
    if not lists:
        return out

    # func_name -> [(template, placeholder_var)] for command(f"...{var}...")
    func_templates: dict[str, list[tuple[str, str]]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call) and _is_command_call(sub) and sub.args:
                tmpl = _fstring_single_placeholder(sub.args[0]) if isinstance(sub.args[0], ast.JoinedStr) else None
                if tmpl:
                    func_templates.setdefault(node.name, []).append(tmpl)

    for node in ast.walk(tree):
        if not isinstance(node, ast.For) or not isinstance(node.iter, ast.Name):
            continue
        values = lists.get(node.iter.id)
        if not values or not isinstance(node.target, ast.Name):
            continue
        loop_var = node.target.id

        def expand(template: str, var: str, values: list[str] = values) -> None:
            out.update(template.replace(f"{{{var}}}", value) for value in values)

        for sub in ast.walk(node):
            if not isinstance(sub, ast.Call):
                continue
            # Direct: command(f"...{loop_var}...") inside the loop body.
            if _is_command_call(sub) and sub.args and isinstance(sub.args[0], ast.JoinedStr):
                tmpl = _fstring_single_placeholder(sub.args[0])
                if tmpl and tmpl[1] == loop_var:
                    expand(*tmpl)
                continue
            # Factory: FACTORY(loop_var) where FACTORY registers command(f"...{param}...").
            if not isinstance(sub.func, ast.Name) or sub.func.id not in func_templates:
                continue
            if not sub.args or not isinstance(sub.args[0], ast.Name) or sub.args[0].id != loop_var:
                continue
            param = _function_first_param(tree, sub.func.id)
            if param is None:
                continue
            for template, var in func_templates[sub.func.id]:
                if var == param:
                    expand(template, var)
    return out


def extract_dynamic_commands(py_root: Path) -> set[str]:
    out: set[str] = set()
    if not py_root.is_dir():
        return out
    for path in py_root.rglob("*.py"):
        if _is_excluded(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(text)
        except (OSError, SyntaxError, ValueError):
            continue
        out |= _dynamic_commands_in_module(tree)
    return out


def extract_plugin_commands(roots: list[Path]) -> set[str]:
    out: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for manifest in root.rglob("plugin.json"):
            try:
                data = json.loads(manifest.read_text(encoding="utf-8", errors="ignore"))
            except (OSError, json.JSONDecodeError):
                continue
            commands = (data.get("contributions") or {}).get("commands") or []
            if not isinstance(commands, list):
                continue
            for cmd in commands:
                if isinstance(cmd, dict) and cmd.get("name"):
                    out.add(cmd["name"])
    return out


def extract_dual_routes(backend_python_root: Path) -> set[str]:
    """Find prefix->suffix maps in ``*_dual.py`` (e.g. mail_dual, sheets_dual).

    Each dual module declares a dict whose keys are the FE-facing command
    names the dispatcher accepts; both keys and values belong to the
    backend's dispatchable set, because the dual route forwards the key
    (after stripping the prefix) to the plugin host.
    """
    out: set[str] = set()
    plugin_runtime = backend_python_root / "stitch_backend" / "domains" / "plugin_runtime"
    if not plugin_runtime.is_dir():
        return out
    for path in plugin_runtime.glob("*_dual.py"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line in text.splitlines():
            match = RE_DUAL_KEY.match(line)
            if match:
                out.add(match.group(1))
    return out


def load_baseline(path: Path | None) -> set[str]:
    if path is None:
        return set()
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Could not parse baseline {path}: {exc}") from exc
    items = data.get("known_missing") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise SystemExit(f"baseline must be a list or {{'known_missing': [...]}}: {path}")
    return {str(x) for x in items}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--frontend-src", required=True, type=Path)
    parser.add_argument(
        "--backend-python",
        required=True,
        type=Path,
        help="Directory that contains the stitch_backend/ package to scan for decorators.",
    )
    parser.add_argument(
        "--plugins-dir",
        action="append",
        default=[],
        type=Path,
        help="Directory(ies) with plugin.json files (plugins-src, plugins). Repeatable.",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help="JSON file with a list of FE commands known to be missing from the backend by design "
             "(test-only stubs, dead FE code, plugin-only with no decorator). When provided, "
             "commands in the baseline are excluded from the missing-set.",
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--runtime", action="store_true", help="Load the configured backend startup registry with this interpreter.")
    args = parser.parse_args()

    fe_calls = extract_fe(args.frontend_src)
    if args.runtime:
        sys.path.insert(0, str(args.backend_python.resolve()))
        with contextlib.redirect_stdout(io.StringIO()):
            from stitch_backend.core.command_registry import list_commands
            from stitch_backend.startup import import_command_modules

            import_command_modules()
            decorators = set(list_commands())
    else:
        decorators = extract_decorators(args.backend_python) | extract_dynamic_commands(args.backend_python)
    plugins = extract_plugin_commands(args.plugins_dir)
    dual_routes = extract_dual_routes(args.backend_python)
    baseline = load_baseline(args.baseline)
    backend = decorators | plugins | dual_routes

    fe_filtered = {k: v for k, v in fe_calls.items() if k not in TEST_ONLY_COMMANDS}
    missing_raw = sorted(set(fe_filtered) - backend)
    missing_baselined = sorted(set(missing_raw) - baseline)
    baseline_matched = sorted(set(missing_raw) & baseline)
    unused = sorted(backend - set(fe_filtered))

    payload = {
        "fe_calls_total": len(fe_filtered),
        "fe_calls_skipped_test": len(fe_calls) - len(fe_filtered),
        "backend_decorators": len(decorators),
        "plugin_commands": len(plugins),
        "dual_route_keys": len(dual_routes),
        "baseline_entries": len(baseline),
        "missing_raw": missing_raw,
        "missing_baselined": missing_baselined,
        "baseline_matched": baseline_matched,
        "missing_sample_files": {
            name: fe_filtered[name][0] for name in missing_baselined[:5]
        },
        "unused_backend_sample": unused[:20],
    }

    if args.json:
        print(json.dumps(payload, indent=2))
        return 1 if missing_baselined else 0

    print(f"FE commands scanned     : {len(fe_filtered)}"
          f" (skipped test-only: {payload['fe_calls_skipped_test']})")
    print(f"Backend decorators      : {len(decorators)}")
    print(f"Plugin commands         : {len(plugins)}")
    print(f"Dual-route keys         : {len(dual_routes)}")
    print(f"Baseline entries        : {len(baseline)}")
    print(f"Total backend handlers  : {len(backend)}")

    if missing_baselined:
        print()
        print(f"[FAIL] {len(missing_baselined)} NEW FE command(s) have no backend handler:")
        for name in missing_baselined:
            files = sorted(set(fe_filtered[name]))[:3]
            short = ", ".join(f.replace("\\", "/") for f in files)
            print(f"  - {name}  (caller: {short})")
        if missing_raw:
            print()
            print(f"({len(missing_raw) - len(missing_baselined)} other gap(s) suppressed by baseline)")
        print()
        print("Fix one of:")
        print("  - add @register_command or @command decorator in backend code")
        print("  - declare the command in a plugin.json contributions.commands")
        print("  - add a key to the dual-route dict in a *._dual.py module")
        print("  - add to baseline only with justification in commit message")
        return 1

    if missing_raw:
        print()
        print(f"[OK] {len(missing_raw)} known gap(s) covered by baseline; no NEW gaps.")
    else:
        print()
        print("[OK] All FE commands resolve to a backend handler.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
