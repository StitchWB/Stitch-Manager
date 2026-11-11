"""Static-AST contract gate + engine/capability preflight for ``check``.

The contract gate compares the commands a service plugin DECLARES in
``plugin.json`` (``contributions.commands[].name``) with the handlers it
REGISTERS in code (literal ``server.register("<name>", ...)`` calls).  It is
a static AST scan — no spawn, no re-vendor — so it runs in milliseconds and
never executes plugin code.

The engine and capability preflights compare the manifest against the host
constants.  Both are best-effort: the host modules pull heavy dependencies,
so an import failure degrades the check to ``skipped`` instead of failing
the run.
"""

from __future__ import annotations

import ast
from typing import TYPE_CHECKING, Any

from autoreg.plugin.manifest import semver_sort_key

if TYPE_CHECKING:
    from pathlib import Path

# Host-injected command names a plugin may register without declaring them.
RESERVED_COMMANDS = frozenset(
    {"_migrate_db", "list_jobs", "get_job", "cancel_job", "metrics"}
)

_SKIP_DIRS = frozenset({"_vendor", "__pycache__", "tests"})


def _skipped(name: str, reason: str) -> dict[str, Any]:
    return {
        "name": name,
        "status": "skipped",
        "blocking": False,
        "findings": [],
        "reason": reason,
    }


def _declared_commands(manifest: dict[str, Any]) -> set[str]:
    contributions = manifest.get("contributions")
    if not isinstance(contributions, dict):
        return set()
    commands = contributions.get("commands")
    if not isinstance(commands, list):
        return set()
    out: set[str] = set()
    for entry in commands:
        if isinstance(entry, dict):
            name = entry.get("name")
            if isinstance(name, str) and name:
                out.add(name)
    return out


def _registered_handlers(package_dir: Path) -> tuple[set[str], bool]:
    names: set[str] = set()
    dynamic = False
    for path in sorted(package_dir.rglob("*.py")):
        if _SKIP_DIRS.intersection(path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError, ValueError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not isinstance(func, ast.Attribute) or func.attr != "register":
                continue
            if not node.args:
                continue
            first = node.args[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                names.add(first.value)
            else:
                dynamic = True
    return names, dynamic


def _spi_exempt_commands(manifest: dict[str, Any]) -> set[str]:
    """Commands a plugin may register without declaring (SPI-only convention)."""
    contributions = manifest.get("contributions")
    if not isinstance(contributions, dict):
        return set()
    spi_names = contributions.get("spi")
    if not isinstance(spi_names, list) or not spi_names:
        return set()
    try:
        from stitch_backend.domains.plugin_runtime.spi_bridge import SPI_METHOD_MAP
    except ImportError:
        return set()
    exempt: set[str] = set()
    for methods in SPI_METHOD_MAP.values():
        for spec in methods.values():
            cmd = spec.get("cmd")
            if isinstance(cmd, str) and cmd:
                exempt.add(cmd)
    return exempt


def contract_gate(package_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Static-AST commands<->handlers contract gate (kind=service)."""
    entry = manifest.get("entry")
    if isinstance(entry, dict) and "command" in entry:
        return _skipped("contract", "non-Python entry")
    declared = _declared_commands(manifest)
    handlers, dynamic = _registered_handlers(package_dir)
    exempt = _spi_exempt_commands(manifest)
    findings: list[dict[str, Any]] = []
    has_fail = False
    for name in sorted(declared - handlers - RESERVED_COMMANDS):
        if dynamic:
            findings.append({
                "code": "contract.command.unknown_handler",
                "command": name,
                "message": (
                    f"command {name!r} is declared in contributions.commands "
                    "but no literal server.register handler was found "
                    "(dynamic registration present)"
                ),
            })
        else:
            findings.append({
                "code": "contract.command.no_handler",
                "command": name,
                "message": (
                    f"command {name!r} is declared in contributions.commands "
                    "but no server.register handler was found"
                ),
            })
            has_fail = True
    for name in sorted(handlers - declared - RESERVED_COMMANDS - exempt):
        findings.append({
            "code": "contract.command.undeclared_handler",
            "command": name,
            "message": (
                f"handler {name!r} is registered but not declared in "
                "contributions.commands"
            ),
        })
        has_fail = True
    status = "fail" if has_fail else ("warn" if findings else "pass")
    return {
        "name": "contract",
        "status": status,
        "blocking": True,
        "findings": findings,
    }


def _service_engine_version() -> str | None:
    try:
        from stitch_backend.domains.plugin_runtime.discovery import (
            SERVICE_ENGINE_VERSION,
        )
    except Exception:
        return None
    return SERVICE_ENGINE_VERSION


def engine_gate(manifest: dict[str, Any]) -> dict[str, Any]:
    """Compare ``engine.min``/``engine.api`` against the host constants."""
    engine = manifest.get("engine")
    if not isinstance(engine, dict):
        return _skipped("engine", "no engine block in the manifest")
    try:
        from autoreg.scenario.schema import ENGINE_API, ENGINE_HOST_VERSION
    except ImportError:
        return _skipped("engine", "host engine constants unavailable")

    findings: list[dict[str, Any]] = []
    api = engine.get("api")
    if isinstance(api, int) and api > ENGINE_API:
        findings.append({
            "code": "contract.engine.api_too_new",
            "message": f"engine.api {api} is newer than host ENGINE_API {ENGINE_API}",
        })
    min_ver = engine.get("min")
    if isinstance(min_ver, str):
        bounds = [("ENGINE_HOST_VERSION", ENGINE_HOST_VERSION)]
        service_version = _service_engine_version()
        if service_version is not None:
            bounds.append(("SERVICE_ENGINE_VERSION", service_version))
        for label, bound in bounds:
            try:
                if semver_sort_key(min_ver) > semver_sort_key(bound):
                    findings.append({
                        "code": "contract.engine.min_too_new",
                        "message": (
                            f"engine.min {min_ver} is newer than host "
                            f"{label} {bound}"
                        ),
                    })
            except ValueError:
                pass
    return {
        "name": "engine",
        "status": "warn" if findings else "pass",
        "blocking": False,
        "findings": findings,
    }


def capability_gate(manifest: dict[str, Any]) -> dict[str, Any]:
    """Compare manifest ``capabilities`` with the host's supported set."""
    caps = manifest.get("capabilities")
    if not isinstance(caps, list) or not caps:
        return _skipped("capability", "no capabilities declared")
    try:
        from stitch_backend.domains.plugin_runtime.host_capabilities import (
            SUPPORTED_CAPABILITIES,
        )
    except Exception:
        return _skipped("capability", "host capabilities unavailable")
    supported = set(SUPPORTED_CAPABILITIES)
    findings = [
        {
            "code": "contract.capability.unknown",
            "capability": cap,
            "message": f"capability {cap!r} is not in SUPPORTED_CAPABILITIES",
        }
        for cap in caps
        if isinstance(cap, str) and cap and cap not in supported
    ]
    return {
        "name": "capability",
        "status": "warn" if findings else "pass",
        "blocking": False,
        "findings": findings,
    }


def distribution_gate(
    manifest: dict[str, Any] | None, verdict: dict | None
) -> dict[str, Any]:
    """Warn-only reconciliation of the declared distribution claim vs classify."""
    if manifest is None:
        return _skipped("distribution", "no manifest")
    declared = manifest.get("distribution")
    if not isinstance(declared, dict) or not declared:
        return _skipped("distribution", "no distribution declared")
    if verdict is None:
        return _skipped("distribution", "classify skipped")
    findings: list[dict[str, Any]] = []
    for key in ("channel", "class"):
        claimed = declared.get(key)
        actual = verdict.get(key)
        if claimed is not None and actual is not None and claimed != actual:
            findings.append({
                "code": "distribution.mismatch",
                "field": key,
                "message": (
                    f"declared distribution.{key} {claimed!r} disagrees with "
                    f"classifier verdict {actual!r}"
                ),
            })
    return {
        "name": "distribution",
        "status": "warn" if findings else "pass",
        "blocking": False,
        "findings": findings,
    }
