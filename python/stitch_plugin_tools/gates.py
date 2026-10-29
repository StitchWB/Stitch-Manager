"""Gate sets for the plugin dev loop: ``verify`` and ``publish --dry-run``.

``python -m stitch_plugin_tools verify [package_dir]`` reads the package
manifest (or a community ``catalog.json``), picks the gate set for the kind
and runs every gate as a live subprocess, streaming its output:

    kind=service              ruff check, manifest-lint, pytest (if tests/)
    kind=provider             ruff check
    kind=data / catalog dir   catalog-lint
    every kind                classify — the authoritative publication verdict

``publish --dry-run`` reuses the same gate set as a pre-flight checklist and
prints the lane, the hub submodule path and the farm workflow dispatch line
instead of publishing.  Both commands exit non-zero when a gate fails or the
classify verdict is ``prohibited``.

classify always runs as a ``python -m stitch_plugin_tools classify``
subprocess so the verdict comes from the live zone rules of the tree the
tooling was imported from — never from a stale in-process copy.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

from autoreg.plugin.manifest import MANIFEST_FILENAME

if TYPE_CHECKING:
    from pathlib import Path

CATALOG_FILENAME = "catalog.json"

FARM_REPO = "StitchWB/stitch-ci"
LANE_WORKFLOWS = {
    "provider": "publish-provider-plugins.yml",
    "service": "publish-service-plugins.yml",
}

_TICK = "✓"
_CROSS = "✗"


def _utf8_stdio() -> None:
    # tick/cross marks crash a cp1251 console (skill §3 trap)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


@dataclass
class _Gate:
    label: str
    argv: list[str] | None = None
    cwd: Path | None = None
    note: str | None = None


def _resolve_target(package_dir: Path) -> dict:
    """Read ``plugin.json`` (kind) or fall back to a community catalog.json."""
    manifest_path = package_dir / MANIFEST_FILENAME
    if manifest_path.is_file():
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise ValueError(f"failed to parse {manifest_path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise ValueError(f"{manifest_path} is not a JSON object")
        kind = raw.get("kind")
        if not isinstance(kind, str) or not kind:
            raise ValueError(f"{manifest_path} has no kind field")
        return {
            "kind": kind,
            "plugin_id": raw.get("id"),
            "version": raw.get("version"),
        }
    if (package_dir / CATALOG_FILENAME).is_file():
        return {"kind": "catalog", "plugin_id": None, "version": None}
    raise ValueError(
        f"no {MANIFEST_FILENAME} or {CATALOG_FILENAME} in {package_dir}"
    )


def _gates_for(package_dir: Path, kind: str) -> list[_Gate]:
    py = sys.executable
    if kind in ("data", "catalog"):
        catalog_path = package_dir / CATALOG_FILENAME
        if not catalog_path.is_file():
            raise ValueError(f"kind={kind!r} requires a {catalog_path}")
        return [
            _Gate(
                "catalog-lint",
                [py, "-m", "stitch_plugin_tools", "catalog-lint", str(catalog_path)],
            ),
        ]
    gates: list[_Gate] = [
        # _vendor/ is regenerated, never hand-linted (template CI convention)
        _Gate(
            "ruff check",
            [py, "-m", "ruff", "check", str(package_dir), "--extend-exclude", "_vendor"],
        ),
    ]
    if kind == "service":
        gates.append(
            _Gate(
                "manifest-lint",
                [
                    py,
                    "-m",
                    "stitch_plugin_tools",
                    "manifest-lint",
                    str(package_dir / MANIFEST_FILENAME),
                ],
            )
        )
        tests_dir = package_dir / "tests"
        if tests_dir.is_dir():
            gates.append(
                _Gate(
                    "pytest",
                    [py, "-m", "pytest", str(tests_dir), "-q", "--timeout=60"],
                    cwd=package_dir,
                )
            )
        else:
            gates.append(_Gate("pytest", note="no tests/ directory"))
    elif kind != "provider":
        # provider tests run from the hub python/ dir (autoreg imports), not here
        raise ValueError(f"unknown plugin kind: {kind!r}")
    return gates


def _run_gate(gate: _Gate) -> bool:
    if gate.argv is None:
        print(f"  [-] {gate.label} — {gate.note}")
        return True
    proc = subprocess.run(gate.argv, cwd=str(gate.cwd) if gate.cwd else None)
    ok = proc.returncode == 0
    mark = _TICK if ok else _CROSS
    suffix = "" if ok else f" (exit {proc.returncode})"
    print(f"  [{mark}] {gate.label}{suffix}")
    return ok


def _run_classify(package_dir: Path) -> tuple[dict | None, str]:
    """Run classify as a live subprocess; return (verdict, stderr)."""
    proc = subprocess.run(
        [sys.executable, "-m", "stitch_plugin_tools", "classify", str(package_dir)],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    verdict: dict | None = None
    if proc.returncode == 0:
        try:
            parsed = json.loads(proc.stdout.strip())
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            verdict = parsed
    return verdict, proc.stderr.strip()


def _classify_passed(verdict: dict | None) -> bool:
    return verdict is not None and verdict.get("class") != "prohibited"


def _print_classify_gate(verdict: dict | None, stderr: str) -> bool:
    ok = _classify_passed(verdict)
    mark = _TICK if ok else _CROSS
    print(f"  [{mark}] classify")
    if verdict is not None:
        print(json.dumps(verdict, ensure_ascii=False))
    elif stderr:
        print(stderr, file=sys.stderr)
    return ok


def _resolve_target_and_gates(package_dir: Path) -> tuple[dict, list[_Gate]]:
    if not package_dir.is_dir():
        raise ValueError(f"package dir not found: {package_dir}")
    target = _resolve_target(package_dir)
    gates = _gates_for(package_dir, target["kind"])
    return target, gates


def run_verify(package_dir: Path) -> int:
    """Run every gate for the plugin kind; 0 = all green."""
    _utf8_stdio()
    package_dir = package_dir.resolve()
    try:
        target, gates = _resolve_target_and_gates(package_dir)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    label = target["plugin_id"] or package_dir.name
    print(f"verify {label} kind={target['kind']} at {package_dir}")
    results = [_run_gate(gate) for gate in gates]
    verdict, stderr = _run_classify(package_dir)
    results.append(_print_classify_gate(verdict, stderr))
    if all(results):
        print("verify OK")
        return 0
    print("verify FAILED", file=sys.stderr)
    return 1


def _default_submodule(kind: str, plugin_id: str | None) -> str:
    if kind == "provider":
        return f"autoreg/providers/{(plugin_id or '').removesuffix('-autoreg')}"
    return f"plugins-src/{plugin_id}"


def publish_dry_run(package_dir: Path) -> int:
    """Print the publication plan + pre-flight gate checklist; publish nothing."""
    _utf8_stdio()
    package_dir = package_dir.resolve()
    try:
        target, gates = _resolve_target_and_gates(package_dir)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    verdict, stderr = _run_classify(package_dir)
    if verdict is not None and verdict.get("class") == "prohibited":
        print(
            "REFUSED: class=prohibited — this package must never be published "
            f"({verdict.get('reason')}); see docs/PUBLICATION-POLICY.md",
            file=sys.stderr,
        )
        return 2
    if verdict is None:
        print(f"error: classify failed — {stderr or 'no verdict'}", file=sys.stderr)
        return 2

    kind = target["kind"]
    plugin_id = target["plugin_id"]
    if kind in ("data", "catalog"):
        channel = "catalog"
        submodule = "community"
        dispatch = (
            "no farm dispatch — catalog entries ship via catalog-lint + "
            "catalog-snapshot + a commit to the catalog repo"
        )
    else:
        channel = verdict.get("channel")
        submodule = verdict.get("submodule") or _default_submodule(kind, plugin_id)
        lane = "provider" if kind == "provider" else "service"
        dispatch = (
            f"gh workflow run {LANE_WORKFLOWS[lane]} --repo {FARM_REPO} "
            f"-f version={target['version']}"
        )

    print(f"Plugin: {plugin_id or package_dir.name} kind={kind} class={verdict.get('class')}")
    print(f"Channel: {channel}")
    print(f"Submodule path: {submodule}")
    print(f"CI workflow to dispatch: {dispatch}")
    print("Pre-flight checklist:")
    results = [_run_gate(gate) for gate in gates]
    results.append(_print_classify_gate(verdict, stderr))
    if all(results):
        print("dry-run OK: nothing was published — dispatch the workflow above")
        return 0
    print("dry-run FAILED: fix the gates above before dispatching", file=sys.stderr)
    return 1
