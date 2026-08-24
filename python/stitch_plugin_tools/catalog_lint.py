"""Offline catalog validator for the stitch-plugin-catalog repo CI.

``stitch_plugin_tools catalog-lint <catalog.json>`` validates a catalog
file **offline** — it never fetches anything.  The catalog repo's CI
calls this on every PR to catch malformed entries before merge.

Rules:
  1. JSON must parse and be a dict with a ``plugins`` list.
  2. Each entry must be a dict with ``id`` (str) and ``version`` (str).
  3. Version must be semver (``MAJOR.MINOR.PATCH`` with optional pre-release).
  4. If ``source`` is present:
     - Must be a dict with ``type`` ∈ {``"git"``, ``"release"``}.
     - git: ``url`` required (str); ``ref`` optional, when present must be
       a non-empty string not starting with ``-`` (git injection hardening,
       mirrors ``sources._git_clone``).
     - release: ``url`` required (str) + ``sha256`` required (hex64).
     - Unknown ``type`` → error.
  5. Legacy entries (no ``source``): ``path`` (non-empty str) +
     ``sha256`` (hex64) required — the documented zip-era shape.
  6. Duplicate ``id`` + ``version`` pairs → error.
  7. ``i18n`` (optional): when present must be a dict of locale → bundle.
     Each bundle must be a dict.  A top-level key in a bundle that
     contains ``.`` is rejected as a *flat key* — the FE
     ``i18nPluginBundles.ts`` walkBundle walks dot-paths through nested
     objects, so a flat top-level key like ``"my.plugin.title"`` silently
     never resolves.  Authors must nest: ``{"my": {"plugin": {"title": …}}}``.
  8. ``attestation`` (optional): when present, must be a dict with
     ``reviewed_by`` (non-empty str), ``reviewed_at`` (ISO 8601 datetime),
     ``sha256`` (hex64), and ``signature`` (``"ed25519:<base64>"``).
     When the env var ``STITCH_CATALOG_PUBKEY`` is set to a base64 ed25519
     public key, the signature is verified over
     ``f"{reviewed_by}|{reviewed_at}|{sha256}"``; otherwise only the
     shape is validated (so offline CI without the maintainer key still
     passes).

Exit 0 on success, 1 on any error.  A per-entry report is printed to stdout.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Semver: MAJOR.MINOR.PATCH with optional -prerelease (simplified).
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")

# ISO 8601 datetime (accepts ``2026-08-24T10:30:00[+/-]HH:MM`` and
# ``2026-08-24T10:30:00Z`` and date-only forms).  ``datetime.fromisoformat``
# is the source of truth in :func:`lint_attestation`; this regex is a fast
# pre-filter so malformed strings don't reach the parser.
_ISO8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}"
    r"(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?"
    r"(?:Z|[+-]\d{2}:?\d{2})?$"
)

# Env var: base64 ed25519 public key for attestation signature verification.
# Absent → only shape is validated (offline CI without the maintainer key).
_ATTESTATION_PUBKEY_ENV = "STITCH_CATALOG_PUBKEY"

_ATTESTATION_SIG_PREFIX = "ed25519:"


def _is_hex64(s: str) -> bool:
    return len(s) == 64 and all(c in "0123456789abcdef" for c in s.lower())


def lint_i18n(entry: Any) -> list[str]:
    """Validate the optional ``i18n`` field of a catalog entry.

    The FE ``i18nPluginBundles.ts`` ``walkBundle`` walks dot-paths through
    nested objects — a flat top-level key containing ``.`` (e.g.
    ``"my.plugin.title"``) silently never resolves.  Authors must nest
    locale bundles under the plugin id and use nested objects for any
    dotted keys.

    Returns a list of error messages (empty when valid).  Only runs when
    the entry has an ``i18n`` field; entries without ``i18n`` are
    untouched (i18n is optional).
    """
    if "i18n" not in entry:
        return []
    errors: list[str] = []
    i18n = entry.get("i18n")
    if not isinstance(i18n, dict):
        errors.append("i18n must be an object of locale → bundle")
        return errors
    for locale, bundle in i18n.items():
        if not isinstance(bundle, dict):
            errors.append(
                f"i18n.{locale} bundle must be an object, got "
                f"{type(bundle).__name__}"
            )
            continue
        for key in bundle:
            if isinstance(key, str) and "." in key:
                errors.append(
                    f"i18n.{locale}.{key} looks like a flat key — "
                    f"nest it (FE walkBundle walks dot-paths through "
                    f"nested objects; flat top-level keys never resolve)"
                )
    return errors


def _verify_attestation_signature(
    reviewed_by: str, reviewed_at: str, sha256: str, signature: str,
) -> bool:
    """Verify the attestation signature using the env-var maintainer key.

    Returns ``True`` only if ``STITCH_CATALOG_PUBKEY`` is set AND the
    signature verifies over ``f"{reviewed_by}|{reviewed_at}|{sha256}"``.
    Returns ``True`` when the env var is absent (shape-only mode —
    offline CI without the maintainer key still passes).  Returns
    ``False`` only when the key is present AND verification fails.
    """
    pubkey_b64 = os.environ.get(_ATTESTATION_PUBKEY_ENV, "").strip()
    if not pubkey_b64:
        # No maintainer key configured → shape-only mode (do not fail).
        return True
    # Lazy import: crypto lives in autoreg (not a catalog-lint dependency
    # for offline CI without a key configured).
    from autoreg.plugin import crypto

    payload = f"{reviewed_by}|{reviewed_at}|{sha256}".encode()
    try:
        pub = crypto.load_public_key(pubkey_b64)
        sig_b64 = signature.removeprefix(_ATTESTATION_SIG_PREFIX)
        import base64
        sig_bytes = base64.b64decode(sig_b64)
        pub.verify(sig_bytes, payload)
        return True
    except Exception:
        return False


def lint_attestation(entry: Any) -> list[str]:
    """Validate the optional ``attestation`` field of a catalog entry.

    When ``attestation`` is absent, returns ``[]`` (attestation is
    optional).  When present, must be a dict with:

    - ``reviewed_by``: non-empty str
    - ``reviewed_at``: ISO 8601 datetime (parsed via
      ``datetime.fromisoformat``; a regex pre-filters obvious garbage)
    - ``sha256``: hex64
    - ``signature``: starts with ``"ed25519:"``

    When ``STITCH_CATALOG_PUBKEY`` is set to a base64 ed25519 public key,
    the signature is additionally verified over
    ``f"{reviewed_by}|{reviewed_at}|{sha256}"``.  When the env var is
    absent, only shape is validated (offline CI without the maintainer
    key still passes).
    """
    if "attestation" not in entry:
        return []
    errors: list[str] = []
    att = entry.get("attestation")
    if not isinstance(att, dict):
        errors.append("attestation must be an object")
        return errors

    reviewed_by = att.get("reviewed_by")
    if not isinstance(reviewed_by, str) or not reviewed_by:
        errors.append("attestation 'reviewed_by' must be a non-empty string")

    reviewed_at = att.get("reviewed_at")
    if not isinstance(reviewed_at, str) or not reviewed_at:
        errors.append("attestation 'reviewed_at' must be a non-empty string")
    elif not _ISO8601_RE.match(reviewed_at):
        errors.append(
            f"attestation 'reviewed_at' must be ISO 8601, got {reviewed_at!r}"
        )
    else:
        try:
            datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
        except ValueError:
            errors.append(
                f"attestation 'reviewed_at' is not a valid ISO 8601 "
                f"datetime: {reviewed_at!r}"
            )

    sha256 = att.get("sha256")
    if not isinstance(sha256, str) or not sha256:
        errors.append("attestation 'sha256' must be a non-empty string")
    elif not _is_hex64(sha256):
        errors.append("attestation 'sha256' must be hex64")

    signature = att.get("signature")
    if not isinstance(signature, str) or not signature:
        errors.append("attestation 'signature' must be a non-empty string")
    elif not signature.startswith(_ATTESTATION_SIG_PREFIX):
        errors.append(
            f"attestation 'signature' must start with "
            f"{_ATTESTATION_SIG_PREFIX!r}"
        )

    # Signature verification (only when shape is valid + key is configured).
    if not errors:
        if not _verify_attestation_signature(
            reviewed_by, reviewed_at, sha256, signature,
        ):
            errors.append(
                "attestation signature does not verify against "
                f"{_ATTESTATION_PUBKEY_ENV} maintainer public key"
            )

    return errors


def lint_entry(entry: Any) -> list[str]:
    """Return a list of error messages for a single catalog entry.

    An empty list means the entry is valid.  ``entry`` is the raw JSON
    value (not yet type-checked).
    """
    errors: list[str] = []

    if not isinstance(entry, dict):
        return [f"entry is not an object (got {type(entry).__name__})"]

    # Required fields.
    eid = entry.get("id")
    if not eid or not isinstance(eid, str):
        errors.append("missing or non-string 'id'")
    version = entry.get("version")
    if not version or not isinstance(version, str):
        errors.append("missing or non-string 'version'")
    elif not _SEMVER_RE.match(version):
        errors.append(f"version {version!r} is not semver (MAJOR.MINOR.PATCH)")

    # Source field (optional — legacy entries have none).
    source = entry.get("source")
    if source is None:
        # Legacy entry (zip-era, backward compatible).
        # Documented shape: path (non-empty str) + sha256 (hex64).
        path = entry.get("path")
        if not path or not isinstance(path, str):
            errors.append("legacy entry requires 'path'")
        sha256 = entry.get("sha256")
        if not sha256 or not isinstance(sha256, str):
            errors.append("legacy entry requires 'sha256'")
        elif not _is_hex64(sha256):
            errors.append("legacy entry 'sha256' must be hex64")
    elif not isinstance(source, dict):
        errors.append("'source' must be an object")
    else:
        stype = source.get("type")
        if stype == "git":
            url = source.get("url")
            if not url or not isinstance(url, str):
                errors.append("git source requires 'url'")
            # ref validation: when present, must be a non-empty string and
            # must not start with "-" (git argument injection hardening,
            # mirrors sources._git_clone).
            ref = source.get("ref")
            if ref is not None:
                if not isinstance(ref, str) or not ref:
                    errors.append("git source 'ref' must be a non-empty string")
                elif ref.startswith("-"):
                    errors.append("git source 'ref' must not start with '-'")
        elif stype == "release":
            url = source.get("url")
            if not url or not isinstance(url, str):
                errors.append("release source requires 'url'")
            sha256 = source.get("sha256")
            if not sha256 or not isinstance(sha256, str):
                errors.append("release source requires 'sha256'")
            elif not _is_hex64(sha256):
                errors.append("release source 'sha256' must be hex64")
        else:
            errors.append(f"unknown source type: {stype!r}")

    # i18n (optional) — flat-key check (FE walkBundle walks dot-paths).
    errors.extend(lint_i18n(entry))

    # attestation (optional) — shape + optional signature verification.
    errors.extend(lint_attestation(entry))

    return errors


def lint_catalog(catalog_path: str | Path) -> int:
    """Validate a catalog file offline.  Returns exit code (0=ok, 1=error).

    Prints a per-entry report to stdout and errors to stderr.
    """
    path = Path(catalog_path)
    if not path.is_file():
        print(f"error: catalog file not found: {path}", file=sys.stderr)
        return 1

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: JSON parse failed: {exc}", file=sys.stderr)
        return 1

    if not isinstance(raw, dict):
        print("error: catalog root must be an object", file=sys.stderr)
        return 1

    plugins = raw.get("plugins")
    if not isinstance(plugins, list):
        print("error: catalog must have a 'plugins' array", file=sys.stderr)
        return 1

    seen: dict[str, int] = {}  # "id@version" → entry index
    total_errors = 0
    entries_ok = 0

    for i, entry in enumerate(plugins):
        label = f"entry[{i}]"
        if isinstance(entry, dict) and entry.get("id") and entry.get("version"):
            label = f"entry[{i}] {entry['id']}@{entry['version']}"

        errs = lint_entry(entry)
        if errs:
            for e in errs:
                print(f"  FAIL  {label}: {e}")
            total_errors += len(errs)
        else:
            print(f"  OK    {label}")
            entries_ok += 1

        # Duplicate check (only when id+version are valid strings).
        if isinstance(entry, dict):
            eid = entry.get("id")
            ver = entry.get("version")
            if isinstance(eid, str) and isinstance(ver, str):
                key = f"{eid}@{ver}"
                if key in seen:
                    print(
                        f"  FAIL  {label}: duplicate id@version "
                        f"(also at entry[{seen[key]}])"
                    )
                    total_errors += 1
                else:
                    seen[key] = i

    print(f"\n{entries_ok} ok, {total_errors} error(s) in {len(plugins)} entries")
    return 0 if total_errors == 0 else 1
