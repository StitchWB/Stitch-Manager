"""Artifact encryption for the public build pipeline (open-core).

Compiled provider plugins are produced on the PUBLIC ``stitch-build`` repo
(free runner minutes) and must travel through a publicly readable artifact
channel before the private monorepo signs + publishes them.  To stop anyone
from pulling a compiled plugin off the public channel and using it outside the
entitled distribution, each artifact is ENCRYPTED here with a public key and
can only be decrypted in the monorepo (which holds the private key).

Scheme: hybrid RSA-OAEP(SHA-256) + AES-256-GCM.
    * A random 32-byte AES-256 key encrypts the payload (fast, any size).
    * The AES key is wrapped with the recipient RSA public key (OAEP/SHA-256).
    * Payload format is JSON with base64 fields (see ``_FORMAT``), so it is
      trivial to ship as a ``.enc`` file / release asset.

Security notes:
    * The PUBLIC key may live anywhere (it is public), including committed to
      the ``stitch-build`` repo.  Only the PRIVATE key must stay secret, and it
      is stored ONLY as a monorepo Actions secret.
    * AES-GCM provides confidentiality + integrity; a tampered ciphertext fails
      to decrypt (authenticated encryption).

CLI:
    python -m stitch_plugin_tools.artifact_crypto genkey  --out-dir keys/
    python -m stitch_plugin_tools.artifact_crypto encrypt --pubkey pub.pem --in pkg.zip --out pkg.zip.enc
    python -m stitch_plugin_tools.artifact_crypto decrypt --privkey priv.pem --in pkg.zip.enc --out pkg.zip
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Bump if the payload format ever changes.
_FORMAT_VERSION = 1
_RSA_BITS = 3072
_AES_KEY_BYTES = 32      # AES-256
_GCM_NONCE_BYTES = 12    # standard GCM nonce size


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def _oaep() -> padding.OAEP:
    return padding.OAEP(
        mgf=padding.MGF1(algorithm=hashes.SHA256()),
        algorithm=hashes.SHA256(),
        label=None,
    )


# ── Key management ─────────────────────────────────────────────────────


def generate_keypair(bits: int = _RSA_BITS) -> tuple[bytes, bytes]:
    """Generate an RSA keypair.

    Returns ``(private_pem, public_pem)``.  The private key is unencrypted
    PKCS#8 PEM (wrap/protect it at rest as a CI secret); the public key is
    SubjectPublicKeyInfo PEM.
    """
    key = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def load_public_key(path: Path):
    return serialization.load_pem_public_key(Path(path).read_bytes())


def load_private_key(path: Path):
    return serialization.load_pem_private_key(Path(path).read_bytes(), password=None)


# ── Encrypt / decrypt ──────────────────────────────────────────────────


def encrypt_bytes(data: bytes, public_key) -> bytes:
    """Encrypt ``data`` with a fresh AES-256-GCM key wrapped by ``public_key``.

    Returns the JSON payload as bytes.
    """
    aes_key = os.urandom(_AES_KEY_BYTES)
    nonce = os.urandom(_GCM_NONCE_BYTES)
    ciphertext = AESGCM(aes_key).encrypt(nonce, data, None)
    wrapped_key = public_key.encrypt(aes_key, _oaep())
    payload = {
        "v": _FORMAT_VERSION,
        "alg": "RSA-OAEP-SHA256+AES-256-GCM",
        "k": _b64(wrapped_key),
        "n": _b64(nonce),
        "c": _b64(ciphertext),
    }
    return json.dumps(payload).encode("utf-8")


def decrypt_bytes(payload: bytes, private_key) -> bytes:
    """Decrypt a payload produced by :func:`encrypt_bytes`.

    Raises ``ValueError`` on a malformed/tampered payload (GCM auth failure).
    """
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"artifact payload is not valid JSON: {exc}") from exc

    if doc.get("v") != _FORMAT_VERSION:
        raise ValueError(f"unsupported artifact format version: {doc.get('v')!r}")

    try:
        aes_key = private_key.decrypt(_unb64(doc["k"]), _oaep())
        return AESGCM(aes_key).decrypt(_unb64(doc["n"]), _unb64(doc["c"]), None)
    except (KeyError, TypeError) as exc:
        raise ValueError(f"artifact payload missing field: {exc}") from exc
    except Exception as exc:  # cryptography raises various on bad key/tamper
        raise ValueError(f"artifact decryption failed (wrong key or tampered): {exc}") from exc


def encrypt_file(src: Path, pubkey_path: Path, dst: Path) -> None:
    public_key = load_public_key(pubkey_path)
    data = Path(src).read_bytes()
    Path(dst).write_bytes(encrypt_bytes(data, public_key))


def decrypt_file(src: Path, privkey_path: Path, dst: Path) -> None:
    private_key = load_private_key(privkey_path)
    data = decrypt_bytes(Path(src).read_bytes(), private_key)
    Path(dst).write_bytes(data)


# ── CLI ────────────────────────────────────────────────────────────────


def _main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Artifact encryption (open-core build pipeline)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("genkey", help="generate an RSA keypair")
    p_gen.add_argument("--out-dir", required=True, help="dir to write priv.pem + pub.pem")
    p_gen.add_argument("--bits", type=int, default=_RSA_BITS)

    p_enc = sub.add_parser("encrypt", help="encrypt a file with the public key")
    p_enc.add_argument("--pubkey", required=True)
    p_enc.add_argument("--in", dest="src", required=True)
    p_enc.add_argument("--out", dest="dst", required=True)

    p_dec = sub.add_parser("decrypt", help="decrypt a file with the private key")
    p_dec.add_argument("--privkey", required=True)
    p_dec.add_argument("--in", dest="src", required=True)
    p_dec.add_argument("--out", dest="dst", required=True)

    args = parser.parse_args(argv)

    if args.cmd == "genkey":
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        priv, pub = generate_keypair(args.bits)
        priv_path = out_dir / "artifact-priv.pem"
        pub_path = out_dir / "artifact-pub.pem"
        priv_path.write_bytes(priv)
        pub_path.write_bytes(pub)
        print(f"wrote {priv_path} and {pub_path}")
        print("KEEP artifact-priv.pem SECRET (monorepo Actions secret only).")
        return 0

    if args.cmd == "encrypt":
        encrypt_file(Path(args.src), Path(args.pubkey), Path(args.dst))
        print(f"encrypted {args.src} -> {args.dst}")
        return 0

    if args.cmd == "decrypt":
        decrypt_file(Path(args.src), Path(args.privkey), Path(args.dst))
        print(f"decrypted {args.src} -> {args.dst}")
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
