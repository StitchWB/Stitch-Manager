"""Dependency resolution for plugin packages (plan §3.3).

When a plugin package declares ``depends: ["aws-builder-id@^1.0"]``, the
engine resolves each dependency via the SAME :class:`PluginLoader` instance
(pinning contract) and loads its scenario.  Dependencies are executed in
declared order before the main package's scenario (see
:class:`~autoreg.plugin.provider_adapter.PluginScenarioProvider`).

v1 semantics (tolerant-reader):
    * Range mismatches log a WARNING and proceed anyway — do not hard-fail.
    * Unresolvable dependencies FAIL the run with a clear error before any
      browser is opened.

v2 service-plugin variant (:func:`resolve_service_dependencies`):
    * PRESENCE check only — does NOT load scenarios.  Service plugins are
      started by :mod:`stitch_backend` discovery, which skips plugins whose
      deps are not installed rather than crashing startup.
    * Range suffixes (``@^1.0``) are stripped via :func:`parse_dep_entry`;
      only the dependency id is checked against the loader.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from ..scenario.parse_v2 import parse_scenario_v2

if TYPE_CHECKING:
    from ..scenario.schema import ScenarioV2
    from .loader import PluginLoader
    from .manifest import PluginManifest

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedDependency:
    """A dependency package resolved to its manifest + scenario."""

    manifest: PluginManifest
    scenario: ScenarioV2
    package_dir: Path


class DependencyResolutionError(Exception):
    """Raised when a dependency cannot be resolved (not installed or unreadable)."""

    def __init__(self, dep_id: str, message: str = "") -> None:
        self.dep_id = dep_id
        super().__init__(message or f"dependency not installed: {dep_id}")


def resolve_dependencies(
    manifest: PluginManifest,
    loader: PluginLoader,
) -> list[ResolvedDependency]:
    """Resolve all dependencies declared in ``manifest.depends``.

    Returns a list in declared order.  Raises :class:`DependencyResolutionError`
    if a dependency cannot be resolved at all (not installed) or its
    scenario cannot be loaded.  Range mismatches log a warning and proceed
    (tolerant-reader v1).
    """
    resolved: list[ResolvedDependency] = []
    for dep_entry in manifest.depends:
        dep_id, dep_range = parse_dep_entry(dep_entry)
        dep_dir = loader.resolve(dep_id)
        if dep_dir is None:
            raise DependencyResolutionError(dep_id)
        dep_manifest = _read_manifest(dep_dir)
        if dep_manifest is None:
            raise DependencyResolutionError(
                dep_id, f"dependency manifest unreadable: {dep_id}"
            )
        if dep_range and not _satisfies_range(dep_manifest.version, dep_range):
            logger.warning(
                "dependency %s version %s does not satisfy range %s; "
                "proceeding anyway (v1 tolerant-reader)",
                dep_id, dep_manifest.version, dep_range,
            )
        try:
            scenario = _load_scenario(dep_dir, dep_manifest)
        except (OSError, ValueError) as exc:
            raise DependencyResolutionError(
                dep_id, f"dependency scenario unreadable: {dep_id}: {exc}"
            ) from exc
        resolved.append(ResolvedDependency(dep_manifest, scenario, dep_dir))
    return resolved


def resolve_service_dependencies(
    manifest: PluginManifest,
    loader: PluginLoader,
) -> list[str]:
    """Check PRESENCE of each declared dependency for a v2 service plugin.

    Returns a list of missing dependency ids (empty when all installed).
    Unlike :func:`resolve_dependencies`, this is a PRESENCE check only —
    it does NOT load scenarios or validate ranges.  Range suffixes
    (``@^1.0``) are stripped via :func:`parse_dep_entry`; only the
    dependency id is checked against the loader.

    v2 service plugins are started by :mod:`stitch_backend` discovery,
    which calls this to skip plugins whose deps are not installed rather
    than crashing startup.
    """
    missing: list[str] = []
    for dep_entry in manifest.depends:
        dep_id, _range = parse_dep_entry(dep_entry)
        if loader.resolve(dep_id) is None:
            missing.append(dep_id)
    return missing


def parse_dep_entry(entry: str) -> tuple[str, str]:
    """Split an ``id@range`` dependency entry into (id, range).

    ``id`` is the dependency's SERVICE id (matched by PluginLoader.resolve).
    ``range`` is optional (empty string when absent).
    """
    if "@" not in entry:
        return entry.strip(), ""
    id_part, _, range_part = entry.partition("@")
    return id_part.strip(), range_part.strip()


# ── internals ─────────────────────────────────────────────────────────────


def _read_manifest(package_dir: Path) -> PluginManifest | None:
    """Read + validate a manifest from a package dir, returning None on failure."""
    from .manifest import validate_manifest

    manifest_path = package_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except (OSError, ValueError):
        return None


def _load_scenario(package_dir: Path, manifest: PluginManifest) -> ScenarioV2:
    """Load + parse a dependency's scenario file via its manifest entry."""
    scenario_rel = manifest.entry.get("scenario", "scenario.json")
    scenario_path = package_dir / scenario_rel
    raw = json.loads(scenario_path.read_text(encoding="utf-8"))
    return parse_scenario_v2(raw)


# ── semver range check (minimal — caret, tilde, exact, wildcard) ────────────

_SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def _parse_semver(version: str) -> tuple[int, int, int] | None:
    m = _SEMVER_RE.match(version)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def _parse_range_base(spec: str) -> tuple[int, int, int] | None:
    """Parse a (possibly partial) semver base into (major, minor, patch).

    Missing components default to 0: ``"1"`` -> (1,0,0), ``"1.2"`` -> (1,2,0).
    Returns ``None`` if the string is not a valid (partial) semver.
    """
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", spec)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0))


def _satisfies_range(version: str, range_spec: str) -> bool:
    """Check if ``version`` satisfies a minimal semver range.

    Supported: ``^x.y`` (caret), ``~x.y`` (tilde), ``x.y.z`` (exact),
    ``x.y`` (>=x.y.0, <x.(y+1).0), ``*`` or empty (any).  Unknown formats
    return True (tolerant-reader — never hard-fail on ranges in v1).
    """
    range_spec = range_spec.strip()
    if not range_spec or range_spec == "*":
        return True
    ver = _parse_semver(version)
    if ver is None:
        return True
    if range_spec.startswith("^"):
        return _caret_satisfies(ver, range_spec[1:])
    if range_spec.startswith("~"):
        return _tilde_satisfies(ver, range_spec[1:])
    return _exact_satisfies(ver, range_spec)


def _caret_satisfies(ver: tuple[int, int, int], base: str) -> bool:
    """Caret: >=base, <next-major (or next-minor for 0.x, next-patch for 0.0.x)."""
    parts = _parse_range_base(base)
    if parts is None:
        return True
    major, minor, _patch = parts
    if ver < parts:
        return False
    if major > 0:
        return ver[0] == major
    if minor > 0:
        return ver[0] == 0 and ver[1] == minor
    return ver[0] == 0 and ver[1] == 0


def _tilde_satisfies(ver: tuple[int, int, int], base: str) -> bool:
    """Tilde: >=base, <next-minor."""
    parts = _parse_range_base(base)
    if parts is None:
        return True
    if ver < parts:
        return False
    return ver[0] == parts[0] and ver[1] == parts[1]


def _exact_satisfies(ver: tuple[int, int, int], range_spec: str) -> bool:
    """Exact x.y.z or x.y (>=x.y.0, <x.(y+1).0)."""
    parts = _parse_semver(range_spec)
    if parts is not None:
        return ver == parts
    base = _parse_range_base(range_spec)
    if base is not None:
        return ver[0] == base[0] and ver[1] == base[1]
    return True
