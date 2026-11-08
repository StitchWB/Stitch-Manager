"""Wrap an existing local directory as a kind=service plugin package.

``stitch_plugin_tools wrap <repo-dir> --id <id>`` generates a service
plugin skeleton whose ``adapter.py`` delegates to the wrapped program (an
opaque child) and whose ``commands.py`` is the author region.  Only a
LOCAL directory is accepted — no git fetch (that is ``install-from``).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from autoreg.plugin.manifest import MANIFEST_FILENAME, SCHEMA_ID_V2
from stitch_plugin_tools.scaffold_common import (
    CANONICAL_ENGINE,
    _pkg_name,
    _validate_plugin_id,
    generated_by_field,
)
from stitch_plugin_tools.wrap_detect import (
    RUNTIMES,
    cli_argv,
    detect_runtime,
    explicit_source,
)
from stitch_plugin_tools.wrap_templates import (
    _ADAPTER_TEMPLATE,
    _COMMANDS_TEMPLATE,
    _MAIN_TEMPLATE,
    _README_TEMPLATE,
    _TEST_TEMPLATE,
    WRAP_VERSION,
)


def _upstream_module(runtime: str, source: Path) -> str:
    return source.name if runtime == "python-module" else ""


def _upstream_cwd(runtime: str, source: Path) -> Path:
    if runtime == "cli":
        return source if source.is_dir() else source.parent
    return source.parent


def _upstream_argv(runtime: str, repo_dir: Path, source: Path) -> list[str] | None:
    if runtime == "cli":
        return cli_argv(repo_dir)
    if runtime == "native":
        return [str(source)] if source.is_file() else None
    return None


def _build_manifest(
    *,
    plugin_id: str,
    display_name: str,
    upstream_path: Path,
    runtime: str,
    version: str,
    description: str,
    category: str,
    status: str,
    icon: str,
    author: str,
) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "schema": SCHEMA_ID_V2,
        "id": plugin_id,
        "name": display_name,
        "version": version,
        "service": plugin_id,
        "kind": "service",
        "engine": dict(CANONICAL_ENGINE),
        "depends": [],
        "entry": {"module": _pkg_name(plugin_id)},
        "capabilities": [],
        "outputs": [],
        "signature": "",
        "description": description
        or f"Wraps {upstream_path} as a Stitch service plugin.",
        "category": category,
        "status": status,
        "icon": icon,
        "features": [{"title": f"{display_name} commands", "status": "beta"}],
        "changelog": [
            {
                "version": version,
                "date": date.today().isoformat(),
                "changes": ["Initial release"],
            },
        ],
        "generated_by": generated_by_field(),
        "upstream": {"path": str(upstream_path), "runtime": runtime},
        "contributions": {
            "commands": [
                {"name": "health_check", "readonly": True},
                {"name": "invoke", "readonly": False},
            ],
        },
    }
    if author:
        manifest["author"] = author
    return manifest


def _render_main(plugin_id: str, pkg_name: str) -> str:
    return (
        _MAIN_TEMPLATE.replace("__PLUGIN_ID__", plugin_id)
        .replace("__PKG_NAME__", pkg_name)
        .replace("__WRAP_VERSION__", str(WRAP_VERSION))
    )


def _render_adapter(runtime: str, source: Path, argv: list[str] | None) -> str:
    return (
        _ADAPTER_TEMPLATE.replace("__WRAP_VERSION__", str(WRAP_VERSION))
        .replace("__UPSTREAM_PATH__", repr(str(source)))
        .replace("__UPSTREAM_RUNTIME__", repr(runtime))
        .replace("__UPSTREAM_MODULE__", repr(_upstream_module(runtime, source)))
        .replace("__UPSTREAM_CWD__", repr(str(_upstream_cwd(runtime, source))))
        .replace("__UPSTREAM_ARGV__", repr(argv))
    )


def _render_commands() -> str:
    return _COMMANDS_TEMPLATE.replace("__WRAP_VERSION__", str(WRAP_VERSION))


def _render_test(plugin_id: str, pkg_name: str) -> str:
    return _TEST_TEMPLATE.replace("__PLUGIN_ID__", plugin_id).replace(
        "__PKG_NAME__", pkg_name
    )


def _render_readme(
    plugin_id: str, pkg_name: str, display_name: str, runtime: str, source: Path
) -> str:
    return (
        _README_TEMPLATE.replace("__PLUGIN_ID__", plugin_id)
        .replace("__PKG_NAME__", pkg_name)
        .replace("__DISPLAY_NAME__", display_name)
        .replace("__RUNTIME__", runtime)
        .replace("__UPSTREAM_PATH__", str(source))
    )


def wrap_repo(
    repo_dir: Path,
    *,
    plugin_id: str,
    name: str = "",
    out_dir: Path | None = None,
    runtime: str = "auto",
    version: str = "0.1.0",
    description: str = "",
    category: str = "productivity",
    status: str = "beta",
    icon: str = "🧩",
    author: str = "",
) -> Path:
    """Generate a kind=service plugin package wrapping ``repo_dir``.

    ``runtime="auto"`` detects the wrapped program's shape; an explicit
    runtime records that kind and resolves the source path best-effort.
    The output directory defaults to ``./<plugin_id>``.  Returns the
    assembled package directory.
    """
    _validate_plugin_id(plugin_id)
    if runtime not in RUNTIMES:
        raise ValueError(f"unknown runtime {runtime!r}: choose from {RUNTIMES}")

    repo_dir = repo_dir.resolve()
    if not repo_dir.is_dir():
        raise ValueError(f"repo dir not found: {repo_dir}")

    if runtime == "auto":
        detected_runtime, source = detect_runtime(repo_dir)
    else:
        detected_runtime = runtime
        source = explicit_source(repo_dir, runtime)

    upstream_argv = _upstream_argv(detected_runtime, repo_dir, source)

    out_dir = (out_dir or Path(plugin_id)).resolve()
    pkg_name = _pkg_name(plugin_id)
    display_name = name or plugin_id

    out_dir.mkdir(parents=True, exist_ok=True)
    pkg_dir = out_dir / pkg_name
    pkg_dir.mkdir(exist_ok=True)

    manifest = _build_manifest(
        plugin_id=plugin_id,
        display_name=display_name,
        upstream_path=source,
        runtime=detected_runtime,
        version=version,
        description=description,
        category=category,
        status=status,
        icon=icon,
        author=author,
    )
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    (pkg_dir / "__init__.py").write_text(
        f'"""{display_name} wrapped service plugin."""\n',
        encoding="utf-8",
    )
    (pkg_dir / "__main__.py").write_text(
        _render_main(plugin_id, pkg_name), encoding="utf-8"
    )

    from stitch_plugin_tools.vendoring import vendor_all

    vendor_all(pkg_dir)

    (pkg_dir / "adapter.py").write_text(
        _render_adapter(detected_runtime, source, upstream_argv), encoding="utf-8"
    )
    (pkg_dir / "commands.py").write_text(_render_commands(), encoding="utf-8")

    if detected_runtime in ("cli", "native") and upstream_argv is None:
        print(
            "note: adapter.upstream_argv not configured — edit "
            f"{pkg_dir / 'adapter.py'}",
            file=sys.stderr,
        )

    tests_dir = out_dir / "tests"
    tests_dir.mkdir(exist_ok=True)
    (tests_dir / "__init__.py").write_text(
        f'"""Test package for the {plugin_id} wrapped plugin."""\n',
        encoding="utf-8",
    )
    (tests_dir / "test_plugin_protocol.py").write_text(
        _render_test(plugin_id, pkg_name), encoding="utf-8"
    )

    (out_dir / "README.md").write_text(
        _render_readme(plugin_id, pkg_name, display_name, detected_runtime, source),
        encoding="utf-8",
    )

    return out_dir
