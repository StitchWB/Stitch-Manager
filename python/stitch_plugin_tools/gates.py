"""Gate sets for the plugin dev loop: ``check`` / ``verify`` / ``publish --dry-run``.

``check [package_dir] [--json]`` reads the package manifest (or a community
``catalog.json``), runs every gate for the kind, and emits a machine-readable
gate document (``--json``) or a human-readable report.  ``verify`` is a thin
alias over the same engine.  Exit codes: 0 = ok; 1 = a blocking gate failed;
2 = bad package / cannot classify.

Gate matrix (a blocking gate that fails fails the run):

    ruff            block
    manifest-lint   block   (kind=service)
    pytest          block   (when <pkg>/tests exists)
    contract        block   (kind=service; static-AST commands<->handlers)
    engine          warn    (engine.min/api preflight)
    capability      warn    (manifest capabilities preflight, kind=service)
    typegen-drift   warn
    vendor-drift    warn
    classify        block-when-available (skipped on a public checkout)
    distribution    warn    (declared claim vs classify verdict)

classify runs as a live subprocess so the verdict comes from the tree the
tooling was imported from.  On a public checkout the hub-only zone rules are
absent, so the classify gate degrades to ``skipped`` (``classify`` is
``null``); ``publish --dry-run`` refuses instead.
"""

from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING, Any

from autoreg.plugin.manifest import MANIFEST_FILENAME
from stitch_plugin_tools import classify
from stitch_plugin_tools.contract_gate import (
    capability_gate,
    contract_gate,
    distribution_gate,
    engine_gate,
)
from stitch_plugin_tools.gate_runners import (
    catalog_lint_gate,
    classify_gate,
    manifest_lint_gate,
    pytest_gate,
    ruff_gate,
    typegen_drift_gate,
    vendor_drift_gate,
)

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
_WARN = "!"
_SKIP = "-"

# Human-readable labels for the gate names (the JSON document keeps the short names).
_HUMAN_LABELS = {"ruff": "ruff check"}


def _utf8_stdio() -> None:
    # tick/cross marks crash a cp1251 console (skill §3 trap)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


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
        if kind not in ("service", "provider", "data", "catalog"):
            raise ValueError(f"unknown plugin kind: {kind!r}")
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


def _read_manifest(package_dir: Path) -> dict[str, Any] | None:
    manifest_path = package_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def _build_gates(
    package_dir: Path, target: dict, manifest: dict[str, Any] | None
) -> list[dict[str, Any]]:
    kind = target["kind"]
    if kind in ("data", "catalog"):
        return [catalog_lint_gate(package_dir)]
    gates = [ruff_gate(package_dir)]
    if kind == "service":
        gates.append(manifest_lint_gate(package_dir))
    gates.append(pytest_gate(package_dir, provider=(kind == "provider")))
    if kind == "service" and manifest is not None:
        gates.append(contract_gate(package_dir, manifest))
    if manifest is not None:
        gates.append(engine_gate(manifest))
        if kind == "service":
            gates.append(capability_gate(manifest))
    gates.append(typegen_drift_gate(package_dir))
    gates.append(vendor_drift_gate(package_dir))
    return gates


def _print_gate_line(gate: dict[str, Any]) -> None:
    mark = {"pass": _TICK, "fail": _CROSS, "warn": _WARN, "skipped": _SKIP}.get(
        gate["status"], "?"
    )
    label = _HUMAN_LABELS.get(gate["name"], gate["name"])
    suffix = f" — {gate['reason']}" if gate.get("reason") else ""
    print(f"  [{mark}] {label}{suffix}")
    for finding in gate["findings"]:
        print(f"      {finding.get('code', '')}: {finding.get('message', '')}")


def _print_human(doc: dict[str, Any], *, command: str, package_dir: Path) -> None:
    label = doc["plugin_id"] or "catalog"
    print(f"{command} {label} kind={doc['kind']} at {package_dir}")
    for gate in doc["gates"]:
        _print_gate_line(gate)
    if doc["classify"] is not None:
        print(json.dumps(doc["classify"], ensure_ascii=False))
    if doc["ok"]:
        print(f"{command} OK")
    else:
        print(f"{command} FAILED", file=sys.stderr)


def _emit_bad_package(exc: Exception, json_output: bool) -> int:
    if json_output:
        doc = {
            "schema_version": 1, "ok": False, "kind": None, "plugin_id": None,
            "version": None, "gates": [], "classify": None, "error": str(exc),
        }
        print(json.dumps(doc, ensure_ascii=False))
    else:
        print(f"error: {exc}", file=sys.stderr)
    return 2


def _run_check(package_dir: Path, *, json_output: bool, command: str) -> int:
    _utf8_stdio()
    package_dir = package_dir.resolve()
    try:
        target = _resolve_target(package_dir)
    except ValueError as exc:
        return _emit_bad_package(exc, json_output)

    manifest = _read_manifest(package_dir)
    gates = _build_gates(package_dir, target, manifest)
    classify_result, verdict, cannot_classify = classify_gate(package_dir)
    gates.append(classify_result)
    gates.append(distribution_gate(manifest, verdict))

    ok = not any(g["status"] == "fail" and g["blocking"] for g in gates)
    doc = {
        "schema_version": 1,
        "ok": ok,
        "kind": target["kind"],
        "plugin_id": target["plugin_id"],
        "version": target["version"],
        "gates": gates,
        "classify": verdict,
    }
    if json_output:
        print(json.dumps(doc, ensure_ascii=False))
    else:
        _print_human(doc, command=command, package_dir=package_dir)
    if cannot_classify:
        return 2
    return 0 if ok else 1


def run_check(package_dir: Path, *, json_output: bool) -> int:
    """Run every gate for the plugin kind; emit the gate document.

    Returns 0 when no blocking gate failed, 1 when one did, 2 for a bad
    package or a classify that could not run.
    """
    return _run_check(package_dir, json_output=json_output, command="check")


def run_verify(package_dir: Path) -> int:
    """Back-compat alias for :func:`run_check` (human-readable output)."""
    return _run_check(package_dir, json_output=False, command="verify")


def _default_submodule(kind: str, plugin_id: str | None) -> str:
    if kind == "provider":
        return f"autoreg/providers/{(plugin_id or '').removesuffix('-autoreg')}"
    return f"plugins-src/{plugin_id}"


def publish_dry_run(package_dir: Path) -> int:
    """Print the publication plan + pre-flight gate checklist; publish nothing."""
    _utf8_stdio()
    package_dir = package_dir.resolve()
    if not classify.zone_rules_available():
        print(
            "REFUSED: publish --dry-run needs the hub tree to classify the "
            "publication lane (scripts/export_public_zone.py is absent on a "
            "public checkout)",
            file=sys.stderr,
        )
        return 2
    try:
        target = _resolve_target(package_dir)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    manifest = _read_manifest(package_dir)
    classify_result, verdict, cannot_classify = classify_gate(package_dir)
    if cannot_classify:
        print(
            f"error: classify failed — {classify_result['findings'][0]['message']}",
            file=sys.stderr,
        )
        return 2
    if verdict is not None and verdict.get("class") == "prohibited":
        print(
            "REFUSED: class=prohibited — this package must never be published "
            f"({verdict.get('reason')}); see docs/PUBLICATION-POLICY.md",
            file=sys.stderr,
        )
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
    gates = _build_gates(package_dir, target, manifest)
    gates.append(classify_result)
    for gate in gates:
        _print_gate_line(gate)
    ok = not any(g["status"] == "fail" and g["blocking"] for g in gates)
    if ok:
        print("dry-run OK: nothing was published — dispatch the workflow above")
        return 0
    print("dry-run FAILED: fix the gates above before dispatching", file=sys.stderr)
    return 1
