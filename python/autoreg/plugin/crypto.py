"""ed25519 sign/verify for plugin packages (plan §3.2 item 4, §4.5).

Uses the ``cryptography`` library (already in ``requirements.txt`` for
stitch_backend; no new dependency).  The signing payload is a sha256
digest over the *canonical package content*: the manifest with its
``signature`` field stripped (so signing is idempotent) plus a sorted
list of every other file's relative path and sha256.

The signing private key is OFFLINE, owned by the developer.  The loader
only verifies with the public key.  ``dev_mode`` bypasses verification for
packages sourced from ``plugins-local/`` only (plan §4.5).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from .manifest import MANIFEST_FILENAME, PluginManifest, validate_manifest

SIGNATURE_PREFIX = "ed25519:"


# ── Canonical package hash ────────────────────────────────────────────────


def _canonical_manifest_bytes(manifest_path: Path) -> bytes:
    """Return the manifest JSON with ``signature`` stripped, canonicalized.

    Keys sorted, compact separators, no trailing newline — deterministic
    so the same package always hashes to the same value regardless of
    formatting or signature state.
    """
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    raw.pop("signature", None)
    return json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _walk_package_files(package_dir: Path) -> list[tuple[str, bytes]]:
    """Return ``[(relative_posix_path, sha256_hexdigest), ...]`` for every
    file in the package except the manifest (which is hashed separately).
    """
    out: list[tuple[str, bytes]] = []
    for root, _dirs, files in os.walk(package_dir):
        for fname in files:
            full = Path(root) / fname
            rel = full.relative_to(package_dir).as_posix()
            if rel == MANIFEST_FILENAME:
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


def load_embedded_pubkey() -> str | None:
    """Return the public key embedded in the binary at build time.

    Stub — real embedding (plan §3.1 item 4) lands when the binary build
    pipeline exists.  Returns ``None`` until then; callers must supply the
    pubkey explicitly via config / env.
    """
    return None


# ── Sign / verify ─────────────────────────────────────────────────────────


def sign_package(package_dir: Path, private_key_pem: bytes | str) -> str:
    """Sign a package and return the ``ed25519:<base64>`` signature string.

    Does NOT write the manifest — the caller (CLI or installer) updates the
    manifest's ``signature`` field.  This keeps the function pure and
    testable.
    """
    priv = load_private_key(private_key_pem)
    digest = compute_package_hash(package_dir)
    sig = priv.sign(digest)
    return f"{SIGNATURE_PREFIX}{base64.b64encode(sig).decode('ascii')}"


def verify_package(package_dir: Path, signature: str, public_key_b64: str) -> bool:
    """Verify a package signature against the canonical content hash.

    Returns ``True`` only if the signature is well-formed AND valid.
    Any malformed input (bad base64, wrong prefix, wrong key) returns
    ``False`` rather than raising — callers use this as a gate.
    """
    if not isinstance(signature, str) or not signature.startswith(SIGNATURE_PREFIX):
        return False
    try:
        sig_bytes = base64.b64decode(signature.removeprefix(SIGNATURE_PREFIX))
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return False
    try:
        pub = load_public_key(public_key_b64)
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return False
    try:
        digest = compute_package_hash(package_dir)
    except Exception:  # noqa: BLE001 — unreadable/corrupt package is a gate refusal
        return False
    try:
        pub.verify(sig_bytes, digest)
    except InvalidSignature:
        return False
    return True


def package_is_signed(manifest: PluginManifest) -> bool:
    """True if the manifest carries a non-empty ``ed25519:`` signature."""
    return bool(manifest.signature) and manifest.signature.startswith(SIGNATURE_PREFIX)


def read_manifest(package_dir: Path) -> PluginManifest:
    """Read + validate the manifest from a package dir."""
    manifest_path = package_dir / MANIFEST_FILENAME
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    return validate_manifest(raw)


def write_signature(package_dir: Path, signature: str) -> PluginManifest:
    """Write the signature into the manifest's ``signature`` field.

    Preserves all other fields and key ordering as much as possible.
    Returns the re-validated manifest.
    """
    manifest_path = package_dir / MANIFEST_FILENAME
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    raw["signature"] = signature
    manifest_path.write_text(
        json.dumps(raw, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return validate_manifest(raw)
