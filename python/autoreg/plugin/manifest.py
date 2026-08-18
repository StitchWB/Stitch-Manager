"""Plugin manifest schema + tolerant reader (plan §4.2).

The manifest is the signed contract between a plugin author and the engine.
``validate_manifest`` parses a raw dict (from ``plugin.json``) into a typed
``PluginManifest`` dataclass.  Unknown fields are silently ignored so that
newer manifests do not break older engines (tolerant reader, plan §3.1 item 1).

Required fields are enforced; missing or invalid values raise
``ManifestValidationError`` carrying the offending field name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

SCHEMA_ID = "stitch.plugin/v1"
MANIFEST_FILENAME = "plugin.json"

# Semver 2.0.0 — MAJOR.MINOR.PATCH with optional prerelease and build metadata.
_SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

# Safe plugin id — a single directory-name component. Blocks path separators,
# "..", and anything outside [A-Za-z0-9_-] so a malicious id cannot escape the
# plugins/ cache directory (path-traversal guard).
_PLUGIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class ManifestValidationError(Exception):
    """Raised when a manifest fails validation.

    ``field`` carries the offending field name so callers can surface a
    precise error in UI / logs.
    """

    def __init__(self, field: str, message: str) -> None:
        self.field = field
        super().__init__(f"{field}: {message}")


@dataclass(frozen=True)
class PluginManifest:
    """Validated plugin manifest (plan §4.2).

    ``kind`` is required to be ``"data"`` in v1 — it is the trust-tier hook
    for v2 (``"code"`` plugins will need manual review + canary).
    ``"engine-pack"`` is the trusted engine module (captcha solvers).
    ``"provider"`` is a code plugin shipping a provider class that
    overrides/extends a built-in reger provider.
    """

    schema: str
    id: str
    name: str
    version: str
    service: str
    kind: str
    engine: dict[str, Any]
    depends: list[str]
    entry: dict[str, Any]
    capabilities: list[str]
    outputs: list[str]
    signature: str = ""

    # Optional alias ids that this package also serves (multi-service manifests).
    # ``service`` is always the canonical id; ``services`` lists additional ids
    # that should resolve to this package.  Absent → empty list (only
    # ``service`` matches).  Duplicates of ``service`` are tolerated.
    services: list[str] = field(default_factory=list)

    # Extra/unknown fields preserved for forward-compat inspection.
    # NOT used by the engine in v1 (tolerant reader ignores them at parse time).
    extras: dict[str, Any] = field(default_factory=dict)

    def service_ids(self) -> list[str]:
        """Return all service ids this package serves.

        Always starts with the canonical ``service``, followed by any
        ``services`` aliases not already seen (deduped, order-preserving).
        Used by the loader to match a requested id against a package's
        declared service surface.
        """
        seen: set[str] = {self.service}
        ids = [self.service]
        for s in self.services:
            if s not in seen:
                seen.add(s)
                ids.append(s)
        return ids

    @property
    def signature_bytes(self) -> bytes | None:
        """Decode the ``ed25519:<base64>`` signature into raw 64 bytes.

        Returns ``None`` when the signature field is empty (unsigned package).
        """
        if not self.signature:
            return None
        if not self.signature.startswith("ed25519:"):
            return None
        import base64

        try:
            return base64.b64decode(self.signature.removeprefix("ed25519:"))
        except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
            return None


def validate_manifest(raw: dict[str, Any]) -> PluginManifest:
    """Parse + validate a raw manifest dict into ``PluginManifest``.

    Tolerant reader: unknown fields are captured in ``extras`` but never
    cause a failure.  Required fields are type-checked and semantically
    validated (schema value, kind value, semver version, engine.api int).
    """
    if not isinstance(raw, dict):
        raise ManifestValidationError("manifest", "must be a JSON object")

    def _require_str(field_name: str) -> str:
        val = raw.get(field_name)
        if val is None:
            raise ManifestValidationError(field_name, "required field missing")
        if not isinstance(val, str) or not val.strip():
            raise ManifestValidationError(field_name, "must be a non-empty string")
        return val

    schema = _require_str("schema")
    if schema != SCHEMA_ID:
        raise ManifestValidationError(
            "schema", f'must be "{SCHEMA_ID}", got "{schema}"'
        )

    plugin_id = _require_str("id")
    if not _PLUGIN_ID_RE.match(plugin_id):
        raise ManifestValidationError(
            "id",
            f'"{plugin_id}" is not a safe plugin id '
            "(must be a single [A-Za-z0-9_-] directory component)",
        )
    name = _require_str("name")
    version = _require_str("version")
    if not _SEMVER_RE.match(version):
        raise ManifestValidationError(
            "version", f'"{version}" is not a valid semver 2.0.0 string'
        )
    service = _require_str("service")

    kind = _require_str("kind")
    # "data" is the v1 trust tier for registration plugins.  "engine-pack" is
    # the trusted engine module (captcha solvers now, hooks-runtime later) that
    # ships through the same gated channel — it is NOT a data-only plugin but
    # is signed with the same offline key, so it validates here too.
    # "provider" is a code plugin that ships a provider class (subclass of
    # BaseProvider) overriding/extending a built-in reger — the entry points
    # at a Python module + class name instead of a scenario file.
    if kind not in ("data", "engine-pack", "provider"):
        raise ManifestValidationError(
            "kind", f'must be "data", "engine-pack" or "provider", got "{kind}"'
        )

    engine_raw = raw.get("engine")
    if not isinstance(engine_raw, dict):
        raise ManifestValidationError("engine", "required field missing or not an object")
    if "min" not in engine_raw or not isinstance(engine_raw["min"], str):
        raise ManifestValidationError("engine.min", "required string missing")
    if "api" not in engine_raw or not isinstance(engine_raw["api"], int):
        raise ManifestValidationError("engine.api", "required integer missing")

    depends_raw = raw.get("depends", [])
    if not isinstance(depends_raw, list) or not all(
        isinstance(d, str) for d in depends_raw
    ):
        raise ManifestValidationError("depends", "must be a list of strings")
    depends = list(depends_raw)

    entry_raw = raw.get("entry")
    if kind == "engine-pack":
        # engine-pack is a code module, not a scenario plugin — entry is optional.
        entry = dict(entry_raw) if isinstance(entry_raw, dict) else {}
    elif kind == "provider":
        # provider plugin: entry points at a Python module + class name.
        # The loader imports the module and finds the class by name.
        if not isinstance(entry_raw, dict):
            raise ManifestValidationError("entry", "required field missing or not an object")
        for key in ("module", "class"):
            if key not in entry_raw or not isinstance(entry_raw[key], str):
                raise ManifestValidationError(
                    f"entry.{key}", "required string missing"
                )
        entry = dict(entry_raw)
    else:
        if not isinstance(entry_raw, dict):
            raise ManifestValidationError("entry", "required field missing or not an object")
        for key in ("scenario", "selectors", "profile"):
            if key not in entry_raw or not isinstance(entry_raw[key], str):
                raise ManifestValidationError(
                    f"entry.{key}", "required string missing"
                )
        entry = dict(entry_raw)

    capabilities_raw = raw.get("capabilities", [])
    if not isinstance(capabilities_raw, list) or not all(
        isinstance(c, str) for c in capabilities_raw
    ):
        raise ManifestValidationError("capabilities", "must be a list of strings")
    capabilities = list(capabilities_raw)

    outputs_raw = raw.get("outputs", [])
    if not isinstance(outputs_raw, list) or not all(
        isinstance(o, str) for o in outputs_raw
    ):
        raise ManifestValidationError("outputs", "must be a list of strings")
    outputs = list(outputs_raw)

    services_raw = raw.get("services", [])
    if not isinstance(services_raw, list) or not all(
        isinstance(s, str) for s in services_raw
    ):
        raise ManifestValidationError("services", "must be a list of strings")
    services = list(services_raw)

    signature = raw.get("signature", "")
    if not isinstance(signature, str):
        raise ManifestValidationError("signature", "must be a string")

    known = {
        "schema", "id", "name", "version", "service", "kind",
        "engine", "depends", "entry", "capabilities", "outputs", "signature",
        "services",
    }
    extras = {k: v for k, v in raw.items() if k not in known}

    return PluginManifest(
        schema=schema,
        id=plugin_id,
        name=name,
        version=version,
        service=service,
        kind=kind,
        engine=dict(engine_raw),
        depends=depends,
        entry=entry,
        capabilities=capabilities,
        outputs=outputs,
        signature=signature,
        services=services,
        extras=extras,
    )


def parse_semver(version: str) -> tuple[int, int, int]:
    """Parse a semver string into a ``(major, minor, patch)`` tuple.

    Prerelease/build metadata are stripped — they only matter for ordering
    between otherwise-equal versions, which the installer does not need
    (monotonicity rejects ``<=`` installed, so equal is rejected anyway).
    Raises ``ValueError`` if the string is not valid semver.
    """
    m = _SEMVER_RE.match(version)
    if not m:
        raise ValueError(f"invalid semver: {version!r}")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
