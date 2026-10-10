"""``stitch_plugin_tools validate`` — manifest + UI cross-check gate.

Loads ``plugin.json``, runs :func:`autoreg.plugin.manifest.validate_manifest`
(schema + ``commands[].params``), then cross-checks the declarative UI
contributions via :func:`stitch_plugin_tools.ui_manifest.lint_contributions`:
i18n key coverage in both the ``ru`` and ``en`` bundles, command references
(button / source / rowActions / card actions), ``paramsFrom`` field
bindings, and ``paramsFromRow`` column bindings.  Findings print one per
line on stderr, prefixed with the manifest path; a clean package exits 0.

``paramsFromRow`` targets outside the declared columns surface as
warnings, not findings: the renderer resolves them against the row
objects returned by the source command, which may carry more keys than
the table displays (see schema.ts ``RowAction.paramsFromRow``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from autoreg.plugin.manifest import (
    MANIFEST_FILENAME,
    ManifestValidationError,
    validate_manifest,
)
from stitch_plugin_tools.ui_manifest import lint_contributions

if TYPE_CHECKING:
    from pathlib import Path


@dataclass
class ValidateReport:
    """Outcome of validating one package directory.

    ``label`` is ``<id>@<version>`` for a parsed manifest, else the
    package dir name.  ``findings`` fail the run; ``warnings`` never do.
    """

    label: str
    checks_passed: int = 0
    findings: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_package(package_dir: Path) -> ValidateReport:
    """Validate one package dir: manifest schema, command params, UI
    contributions cross-checks.  Never raises — every failure is a
    finding on the report."""
    manifest_path = package_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        return ValidateReport(
            label=package_dir.name,
            findings=[f"{manifest_path}: manifest not found"],
        )
    try:
        raw: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return ValidateReport(
            label=package_dir.name,
            findings=[f"{manifest_path}: {exc}"],
        )

    plugin_id = raw.get("id") if isinstance(raw, dict) else None
    lint_id = plugin_id if isinstance(plugin_id, str) else package_dir.name
    report = ValidateReport(label=lint_id)

    try:
        manifest = validate_manifest(raw)
    except ManifestValidationError as exc:
        report.findings.append(f"{manifest_path}: {exc}")
    else:
        report.label = f"{manifest.id}@{manifest.version}"
        report.checks_passed += 2

    if isinstance(raw, dict):
        errors, warnings = lint_contributions(
            lint_id, raw.get("contributions", {})
        )
        report.findings.extend(f"{manifest_path}: {error}" for error in errors)
        report.warnings.extend(f"{manifest_path}: {w}" for w in warnings)
        if not errors:
            report.checks_passed += 1

    return report
