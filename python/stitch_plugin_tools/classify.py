"""Publication classifier: zone verdict for a path or plugin id.

``python -m stitch_plugin_tools classify <path-or-id>`` returns the
class / channel / repo / submodule verdict for a file, directory, provider
id or service-plugin id, per docs/PUBLICATION-POLICY.md.  The verdict is
derived from the same rules the export gates enforce — the allow-list and
deny rules of scripts/export_public_zone.py plus the content-level P0
signatures of scripts/scan_public_capabilities.py — so the classifier
cannot drift from the gates.  Path-level rules are primary; content
patterns are a backstop that overrides an open-core verdict to prohibited.

The zone-rule scripts exist only in the hub tree (they are not part of the
open-core export), so on a public checkout the command fails with a clear
error instead of guessing.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import argparse

_REPO_ROOT = Path(__file__).resolve().parents[2]
_EXPORT_ZONE_SCRIPT = _REPO_ROOT / "scripts" / "export_public_zone.py"
_SCAN_CAPABILITIES_SCRIPT = _REPO_ROOT / "scripts" / "scan_public_capabilities.py"

PROHIBITED = "prohibited"
METHOD = "method"
OPEN_CORE = "open-core"

PUBLIC_REPO = "StitchWB/Stitch-Manager"


def _load_script_module(name: str, path: Path) -> Any:
    if name in sys.modules:
        return sys.modules[name]
    if not path.is_file():
        raise RuntimeError(
            f"zone rules not found: {path} (classify needs the hub tree; "
            "an open-core checkout has no scripts/export_public_zone.py)"
        )
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _zone_rules() -> tuple[Any, Any]:
    export = _load_script_module("export_public_zone", _EXPORT_ZONE_SCRIPT)
    scan = _load_script_module("scan_public_capabilities", _SCAN_CAPABILITIES_SCRIPT)
    return export, scan


def _verdict(
    cls: str, channel: str, repo: str | None, submodule: str | None, reason: str
) -> dict:
    return {
        "class": cls,
        "channel": channel,
        "repo": repo,
        "submodule": submodule,
        "reason": reason,
    }


def _submodule_repos() -> dict[str, str]:
    """Map submodule path → "Owner/name" from .gitmodules."""
    repos: dict[str, str] = {}
    gitmodules = _REPO_ROOT / ".gitmodules"
    if not gitmodules.is_file():
        return repos
    sub_path: str | None = None
    for line in gitmodules.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("path = "):
            sub_path = line[len("path = "):].strip()
        elif line.startswith("url = ") and sub_path:
            tail = line[len("url = "):].strip().removesuffix(".git")
            seg = tail.rsplit("/", 2)
            if len(seg) >= 2:
                repos[sub_path] = "/".join(seg[-2:])
            sub_path = None
    return repos


def _manifest_kind(package_dir: Path) -> str | None:
    manifest = package_dir / "plugin.json"
    if not manifest.is_file():
        return None
    try:
        raw = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    kind = raw.get("kind")
    return kind if isinstance(kind, str) else None


def _in_export_set(posix: str, export: Any) -> bool:
    if posix in export.ZONE_FILES:
        return True
    return any(posix == d or posix.startswith(d + "/") for d in export.ZONE_DIRS)


def _package_files(root: Path) -> list[Path]:
    """Files whose content decides a directory verdict.

    Inside the hub tree, files excluded by _is_forbidden never ship, so
    their content is irrelevant to the verdict.
    """
    export, _ = _zone_rules()
    inside = root.is_relative_to(_REPO_ROOT)
    out: list[Path] = []
    for f in sorted(root.rglob("*")):
        if not f.is_file() or f.suffix in (".pyc", ".log"):
            continue
        if "__pycache__" in f.parts:
            continue
        if inside:
            if not f.is_relative_to(_REPO_ROOT):
                continue
            if export._is_forbidden(f.relative_to(_REPO_ROOT)):
                continue
        out.append(f)
    return out


def _content_backstop(verdict: dict, target: Path, scan: Any) -> dict:
    """Override an open-core verdict to prohibited on P0 content signatures."""
    if not target.exists():
        return verdict
    files = [target] if target.is_file() else _package_files(target)
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for pat in scan.P0_CONTENT_PATTERNS:
            if pat.search(text):
                try:
                    where: Path | str = f.relative_to(_REPO_ROOT)
                except ValueError:
                    where = str(f)
                return _verdict(
                    PROHIBITED,
                    "none",
                    None,
                    None,
                    f"P0 content signature {pat.pattern!r} in {where}",
                )
    return verdict


def _classify_provider(parts: tuple[str, ...]) -> dict:
    if len(parts) == 3 or Path(parts[3]).suffix:
        return _verdict(
            METHOD, "gated", None, None,
            "autoreg/providers is the closed P1 method zone",
        )
    sub_path = "/".join(parts[:4])
    repo = _submodule_repos().get(sub_path, f"StitchWB/stitch-provider-{parts[3]}")
    return _verdict(
        METHOD,
        "gated",
        repo,
        sub_path,
        "provider method source (P1); compiled+signed on the farm, source "
        "stays closed",
    )


def _classify_service_plugin(parts: tuple[str, ...]) -> dict:
    if len(parts) == 1:
        return _verdict(
            PROHIBITED, "none", None, None,
            "plugins-src is not in the Zone-1 export allow-list; closed by "
            "default",
        )
    sub_path = "/".join(parts[:2])
    repo = _submodule_repos().get(sub_path, f"StitchWB/{parts[1]}")
    if _manifest_kind(_REPO_ROOT / sub_path) == "provider":
        return _verdict(
            METHOD, "gated", repo, sub_path, "kind=provider package (P1 method)"
        )
    _, scan = _zone_rules()
    verdict = _verdict(
        OPEN_CORE,
        "public",
        repo,
        sub_path,
        "service plugin source (P3); ships as a signed service plugin",
    )
    return _content_backstop(verdict, _REPO_ROOT / Path(*parts), scan)


def classify_path(rel_path: Path) -> dict:
    """Classify a repo-relative path (file or directory) by the zone rules."""
    export, scan = _zone_rules()
    rel = Path(rel_path)
    if rel.is_absolute():
        if not rel.is_relative_to(_REPO_ROOT):
            raise ValueError(f"{rel} is outside the hub tree")
        rel = rel.relative_to(_REPO_ROOT)
    posix = rel.as_posix()
    parts = rel.parts

    if posix.startswith("python/autoreg/plugin/"):
        if any(part.endswith("-autoreg") for part in parts):
            return _verdict(
                METHOD,
                "gated",
                None,
                None,
                "provider wrapper package (PEP 562); closed method zone, "
                "open-core runs providers via plugins",
            )
        if rel.name in export._METHOD_PLUGIN_FILES:
            return _verdict(
                METHOD,
                "gated",
                None,
                None,
                "registration method glue (_METHOD_PLUGIN_FILES); ships only "
                "inside signed gated plugins",
            )

    marker = next((m for m in export.P0_NAME_MARKERS if m in rel.name), None)
    if marker:
        return _verdict(
            PROHIBITED, "none", None, None,
            f"P0 capability name marker '{marker}' (P0_NAME_MARKERS)",
        )

    if parts[:3] == ("python", "autoreg", "providers"):
        return _classify_provider(parts)

    if parts[:3] == ("python", "autoreg", "captcha"):
        return _verdict(
            METHOD, "gated", None, None,
            "captcha solver source; ships only inside the signed engine-pack",
        )

    if parts[:3] == ("python", "autoreg", "spoofers"):
        return _verdict(
            PROHIBITED, "none", None, None,
            "fingerprint spoofing is P0 (anti-detect)",
        )

    if posix.startswith("python/stitch_backend/domains/registration/"):
        return _verdict(
            PROHIBITED, "none", None, None,
            "registration automation domain is P0 (plan WS-E); only the "
            "plugin-based core ships",
        )

    if "engine-pack" in parts:
        return _verdict(
            METHOD, "gated", None, None,
            "engine-pack source; the pack is a signed gated artifact",
        )

    if posix.startswith("extension/stitch-toolkit/test/"):
        return _verdict(
            PROHIBITED, "none", None, None,
            "test fixtures for removed P0 features (stripe filler)",
        )

    forbidden = next((m for m in export.FORBIDDEN_MARKERS if m in parts), None)
    if forbidden:
        return _verdict(
            PROHIBITED, "none", None, None,
            f"Zone-3/private marker '{forbidden}' (FORBIDDEN_MARKERS)",
        )

    if parts[:1] == ("plugins-src",):
        return _classify_service_plugin(parts)

    if export._is_forbidden(rel):
        return _verdict(
            PROHIBITED, "none", None, None,
            "excluded from the export set by _is_forbidden (closed zone)",
        )

    if _in_export_set(posix, export):
        verdict = _verdict(
            OPEN_CORE, "public", PUBLIC_REPO, None,
            "in the Zone-1 export allow-list (open-core)",
        )
        return _content_backstop(verdict, _REPO_ROOT / rel, scan)

    return _verdict(
        PROHIBITED, "none", None, None,
        "outside the Zone-1 export allow-list; closed by default "
        "(PUBLICATION-POLICY rule 1)",
    )


def _classify_external_package(package_dir: Path) -> dict:
    _, scan = _zone_rules()
    if _manifest_kind(package_dir) == "provider":
        return _verdict(
            METHOD, "gated", None, None,
            "kind=provider package (P1 method); compiled+signed distribution",
        )
    verdict = _verdict(
        OPEN_CORE, "public", None, None,
        "plugin package outside the hub tree; classified by manifest and "
        "content only",
    )
    return _content_backstop(verdict, package_dir, scan)


def _resolve_installed(name: str) -> Path | None:
    try:
        from autoreg.plugin.loader import PluginLoader

        return PluginLoader().resolve(name)
    except Exception:
        return None


def _classify_plugin_id(name: str) -> dict | None:
    stripped = name.removesuffix("-autoreg")
    candidates: list[Path] = []
    if stripped != name:
        candidates.append(_REPO_ROOT / "python" / "autoreg" / "plugin" / name)
    candidates.append(_REPO_ROOT / "python" / "autoreg" / "providers" / stripped)
    candidates.append(_REPO_ROOT / "python" / "autoreg" / "providers" / stripped.replace("-", "_"))
    candidates.append(_REPO_ROOT / "plugins-src" / name)
    candidates.append(_REPO_ROOT / "plugins-src" / f"stitch-{stripped}")
    for d in candidates:
        if d.is_dir():
            return classify_path(d.relative_to(_REPO_ROOT))
    installed = _resolve_installed(name)
    if installed is not None:
        return _classify_external_package(installed)
    return None


def classify(target: str | Path) -> dict:
    """Resolve a path or plugin id and return its publication verdict."""
    p = Path(target)
    for candidate in (p, _REPO_ROOT / p):
        if candidate.exists():
            abs_path = candidate.resolve()
            if abs_path.is_relative_to(_REPO_ROOT):
                return classify_path(abs_path.relative_to(_REPO_ROOT))
            return _classify_external_package(abs_path)
    verdict = _classify_plugin_id(str(target).strip())
    if verdict is not None:
        return verdict
    raise ValueError(
        f"cannot resolve {target!r}: no such path (cwd or repo root) and no "
        "provider / service plugin matches the id"
    )


def _cmd_classify(args: argparse.Namespace) -> int:
    try:
        result = classify(args.target)
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0
