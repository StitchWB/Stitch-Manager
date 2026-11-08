"""ed25519 sign/verify for plugin packages (plan §3.2 item 4, §4.5).

Uses the ``cryptography`` library (already in ``requirements.txt`` for
stitch_backend; no new dependency).  The signing payload is a sha256
digest over the *canonical package content*: the manifest with its
``signature`` field stripped (so signing is idempotent) plus a sorted
list of every other file's relative path and sha256.  The signature
itself lives in the ``plugin.sig`` sidecar, which is excluded from the
payload (it would otherwise cover itself).

The signing private key is OFFLINE, owned by the developer.  The loader
only verifies with the public key.  ``dev_mode`` bypasses verification for
packages sourced from ``plugins-local/`` only (plan §4.5).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from .manifest import (
    MANIFEST_FILENAME,
    SIGNATURE_FILENAME,
    PluginManifest,
    validate_manifest,
)

SIGNATURE_PREFIX = "ed25519:"

# Env var + bundled-file hooks for the verification public key (plan §3.1 item 4).
_PUBKEY_ENV = "STITCH_PLUGIN_PUBKEY"
_PUBKEY_FILENAME = "plugin_pubkey.txt"


# ── Canonical package hash ────────────────────────────────────────────────


def _canonical_manifest_bytes(manifest_path: Path) -> bytes:
    """Return the manifest JSON with ``signature`` stripped, canonicalized.

    Keys sorted, compact separators, no trailing newline — deterministic
    so the same package always hashes to the same value regardless of
    formatting or signature state.
    """
    raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    raw.pop("signature", None)
    return json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


# Client state written into the version dir after install (plugin sync overlay).
_OVERLAY_FILENAMES = frozenset({"selectors_overlay.json", ".selectors_meta.json"})

# Mirrors publish_pack.PACKAGE_EXCLUDE_DIRS: tooling/VCS state, never package content.
_PACKAGE_EXCLUDE_DIRS = frozenset(
    {
        "__pycache__",
        ".git",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        ".venv",
        "node_modules",
    }
)


def _walk_package_files(package_dir: Path) -> list[tuple[str, bytes]]:
    """Return ``[(relative_posix_path, sha256_hexdigest), ...]`` for every
    file in the package except the manifest (which is hashed separately),
    the ``plugin.sig`` signature sidecar (which would otherwise cover
    itself), runtime bytecode caches (``__pycache__`` / ``*.pyc`` — written
    by module execution after installation, not package content), local
    tooling/VCS state directories (``.git`` / ``.pytest_cache`` / ``.venv``
    / ``node_modules`` / ... — created in the package dir by running tools,
    never shipped) and the post-install client-state overlay files.
    """
    out: list[tuple[str, bytes]] = []
    for root, dirs, files in os.walk(package_dir):
        dirs[:] = [d for d in dirs if d not in _PACKAGE_EXCLUDE_DIRS]
        for fname in files:
            if fname.endswith((".pyc", ".pyo")):
                continue
            if fname in _OVERLAY_FILENAMES:
                continue
            full = Path(root) / fname
            rel = full.relative_to(package_dir).as_posix()
            if rel in (MANIFEST_FILENAME, SIGNATURE_FILENAME):
                continue
            digest = hashlib.sha256(full.read_bytes()).hexdigest().encode("ascii")
            out.append((rel, digest))
    out.sort(key=lambda pair: pair[0])
    return out


def compute_package_hash(package_dir: Path) -> bytes:
    """Return the 32-byte sha256 digest of the canonical package content.

    Payload (fed into sha256 incrementally):
        canonical_manifest_bytes
        for each (rel_path, file_hash) sorted by rel_path:
            rel_path + "\\0" + file_hash + "\\0"
    """
    manifest_path = package_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing {MANIFEST_FILENAME} in {package_dir}")

    hasher = hashlib.sha256()
    hasher.update(_canonical_manifest_bytes(manifest_path))
    for rel, file_hash in _walk_package_files(package_dir):
        hasher.update(rel.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(file_hash)
        hasher.update(b"\0")
    return hasher.digest()


# ── Key serialization helpers ─────────────────────────────────────────────


def generate_keypair() -> tuple[bytes, str]:
    """Generate an ed25519 keypair.

    Returns ``(private_pem_bytes, public_key_b64)``.  The private key is
    PKCS8 PEM (no encryption — the developer is expected to store it on
    offline media with restrictive filesystem permissions).  The public
    key is the raw 32 bytes, base64-encoded for compact embedding.
    """
    priv = Ed25519PrivateKey.generate()
    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_raw = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return priv_pem, base64.b64encode(pub_raw).decode("ascii")


def load_private_key(private_key_pem: bytes | str) -> Ed25519PrivateKey:
    """Load an ed25519 private key from PEM bytes/str."""
    data = private_key_pem.encode("utf-8") if isinstance(private_key_pem, str) else private_key_pem
    loaded = serialization.load_pem_private_key(data, password=None)
    if not isinstance(loaded, Ed25519PrivateKey):
        raise TypeError("private key is not an ed25519 key")
    return loaded


def load_public_key(public_key_b64: str) -> Ed25519PublicKey:
    """Load an ed25519 public key from a base64 string (raw 32 bytes)."""
    raw = base64.b64decode(public_key_b64)
    return Ed25519PublicKey.from_public_bytes(raw)


def _pubkey_file_candidates() -> list[Path]:
    """Locations searched for the bundled ``plugin_pubkey.txt``.

    Covers the dev source tree and PyInstaller frozen builds (``sys._MEIPASS``
    temp extraction dir).  The file ships WITH the app — the public key is not
    a secret, so bundling it is safe; security rests on the offline private key.
    """
    here = Path(__file__).resolve().parent  # autoreg/plugin/
    candidates = [here / _PUBKEY_FILENAME]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        base = Path(meipass)
        candidates.append(base / _PUBKEY_FILENAME)
        candidates.append(base / "autoreg" / "plugin" / _PUBKEY_FILENAME)
    return candidates


def load_embedded_pubkey() -> str | None:
    """Return the public key used to verify signed plugins / engine-packs.

    Resolution order:
      1. ``STITCH_PLUGIN_PUBKEY`` env var (base64 raw 32-byte ed25519 pubkey).
         Lets CI / local runs verify without rebuilding the binary.
      2. A ``plugin_pubkey.txt`` bundled next to this module (dev tree and
         frozen builds).
      3. ``None`` — callers must supply a pubkey explicitly or reject the
         signature.

    The public key is NOT a secret; embedding/shipping it is safe.  Security
    comes from the offline private signing key.
    """
    env_val = os.environ.get(_PUBKEY_ENV, "").strip()
    if env_val:
        return env_val

    for candidate in _pubkey_file_candidates():
        try:
            if candidate.is_file():
                val = candidate.read_text(encoding="utf-8").strip()
                if val:
                    return val
        except OSError:
            continue
    return None


# ── Sign / verify ─────────────────────────────────────────────────────────


def sign_package(package_dir: Path, private_key_pem: bytes | str) -> str:
    """Sign a package and return the ``ed25519:<base64>`` signature string.

    Does NOT write anything — the caller persists the signature via
    :func:`write_signature` (the ``plugin.sig`` sidecar).  This keeps the
    function pure and testable.
    """
    priv = load_private_key(private_key_pem)
    digest = compute_package_hash(package_dir)
    sig = priv.sign(digest)
    return f"{SIGNATURE_PREFIX}{base64.b64encode(sig).decode('ascii')}"


def verify_package_verbose(
    package_dir: Path, signature: str, public_key_b64: str
) -> tuple[bool, str]:
    """Verify a package signature, returning ``(ok, reason)``.

    Reasons: ``"ok"``, ``"bad_signature_format"`` (wrong prefix or bad
    base64), ``"bad_pubkey"``, ``"unreadable_package"``,
    ``"signature_mismatch"``.  Never raises — callers use this as a gate
    and surface the reason in logs.
    """
    if not isinstance(signature, str) or not signature.startswith(SIGNATURE_PREFIX):
        return False, "bad_signature_format"
    try:
        sig_bytes = base64.b64decode(signature.removeprefix(SIGNATURE_PREFIX))
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return False, "bad_signature_format"
    try:
        pub = load_public_key(public_key_b64)
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return False, "bad_pubkey"
    try:
        digest = compute_package_hash(package_dir)
    except Exception:  # noqa: BLE001 — unreadable/corrupt package is a gate refusal
        return False, "unreadable_package"
    try:
        pub.verify(sig_bytes, digest)
    except InvalidSignature:
        return False, "signature_mismatch"
    return True, "ok"


def verify_package(package_dir: Path, signature: str, public_key_b64: str) -> bool:
    """Verify a package signature against the canonical content hash.

    Returns ``True`` only if the signature is well-formed AND valid.
    Any malformed input (bad base64, wrong prefix, wrong key) returns
    ``False`` rather than raising — callers use this as a gate.
    """
    return verify_package_verbose(package_dir, signature, public_key_b64)[0]


def read_signature(package_dir: Path) -> str:
    """Return the package signature: the ``plugin.sig`` sidecar when present,
    else the manifest's inline ``signature`` field.

    The inline fallback keeps already-installed cache packages and old signed
    zips (which carry ``signature`` in ``plugin.json`` and no sidecar)
    verifiable after the sidecar migration; it is removable once the fleet
    re-syncs.  An unreadable or corrupt sidecar is treated as absent so one
    bad file cannot disable discovery of every other package.
    """
    sig_path = package_dir / SIGNATURE_FILENAME
    try:
        sidecar = sig_path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        sidecar = ""
    if sidecar:
        return sidecar
    return _inline_signature(package_dir)


def _inline_signature(package_dir: Path) -> str:
    """Return the manifest's inline ``signature`` value, or "" when absent."""
    manifest_path = package_dir / MANIFEST_FILENAME
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, ValueError):
        return ""
    value = raw.get("signature")
    return value.strip() if isinstance(value, str) else ""


def package_is_signed(package_dir: Path) -> bool:
    """True if the package carries a non-empty ``ed25519:`` sidecar signature."""
    signature = read_signature(package_dir)
    return bool(signature) and signature.startswith(SIGNATURE_PREFIX)


def read_manifest(package_dir: Path) -> PluginManifest:
    """Read + validate the manifest from a package dir.

    The signature is taken from the ``plugin.sig`` sidecar when present,
    falling back to a legacy inline ``signature`` field.
    """
    manifest_path = package_dir / MANIFEST_FILENAME
    raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    sidecar = read_signature(package_dir)
    if sidecar:
        raw["signature"] = sidecar
    return validate_manifest(raw)


def write_signature(package_dir: Path, signature: str) -> PluginManifest:
    """Write the signature to the ``plugin.sig`` sidecar (no trailing newline).

    The manifest is left untouched so it stays freely editable.  Returns the
    re-validated manifest with ``signature`` populated from the sidecar.
    """
    (package_dir / SIGNATURE_FILENAME).write_text(signature, encoding="utf-8")
    return read_manifest(package_dir)
