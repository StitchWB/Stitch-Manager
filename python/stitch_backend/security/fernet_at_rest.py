"""Fernet encryption at rest for sensitive SQLite columns.

Key recovery implications:
    Losing the encryption key (env var unset AND key file deleted) means ALL
    encrypted values become permanently unreadable — there is no recovery
    path.  Back up the key (the ``TOKEN_ENCRYPTION_KEY`` env value or the
    ``.db_key`` file) before rotating or migrating machines.  This tradeoff
    is acknowledged in plan §3.5 decision 13 (v1 part).

Key source order:
    1. ``TOKEN_ENCRYPTION_KEY`` env var — a urlsafe-base64 Fernet key.
       Already documented in ``.env.example``; previously unused, now wired.
    2. ``<data_dir>/.db_key`` file — auto-generated on first run.
       ``data_dir`` = ``%LOCALAPPDATA%/stitch-manager``
       (see :func:`stitch_backend.config._app_data_dir`).
       File is ``chmod 0600`` on POSIX; on Windows the directory is already
       user-private under ``%LOCALAPPDATA%`` (best-effort).
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
from functools import lru_cache
from typing import TYPE_CHECKING

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_KEY_FILE_NAME = ".db_key"


class FernetKeyError(RuntimeError):
    """Raised when the Fernet key is missing, invalid, or unpersistable."""


# ── Key management ────────────────────────────────────────────────────────────


def _key_file_path() -> Path:
    """Return the fallback key file path inside the app data directory."""
    from stitch_backend.config import _app_data_dir

    return _app_data_dir() / "stitch-manager" / _KEY_FILE_NAME


def _persist_key(key_path: Path, key: bytes) -> None:
    """Write *key* to *key_path* with owner-only permissions (best-effort)."""
    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_bytes(key)
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass  # Best-effort — Windows chmod is a near no-op


@lru_cache(maxsize=1)
def get_fernet() -> Fernet:
    """Return the process-wide :class:`Fernet` instance.

    Raises:
        FernetKeyError: if the key is set but invalid, or cannot be persisted.
    """
    # 1. Env var
    env_key = os.environ.get("TOKEN_ENCRYPTION_KEY", "").strip()
    if env_key:
        try:
            return Fernet(env_key.encode())
        except (ValueError, TypeError) as exc:
            raise FernetKeyError(
                "TOKEN_ENCRYPTION_KEY is set but is not a valid Fernet key. "
                'Generate one with: python -c "from cryptography.fernet import '
                'Fernet; print(Fernet.generate_key().decode())"',
            ) from exc

    # 2. Existing key file
    key_path = _key_file_path()
    if key_path.exists():
        try:
            return Fernet(key_path.read_bytes().strip())
        except (ValueError, TypeError, OSError) as exc:
            raise FernetKeyError(
                f"Key file {key_path} is unreadable or invalid: {exc}",
            ) from exc

    # 3. Generate + persist
    key = Fernet.generate_key()
    try:
        _persist_key(key_path, key)
    except OSError as exc:
        raise FernetKeyError(
            f"Cannot persist auto-generated key to {key_path}: {exc}. "
            "Set TOKEN_ENCRYPTION_KEY env var instead.",
        ) from exc
    logger.info("Generated new Fernet key at %s", key_path)
    return Fernet(key)


# ── Encrypt / decrypt helpers ─────────────────────────────────────────────────


def encrypt(plaintext: str) -> str:
    """Encrypt *plaintext* to a urlsafe-base64 Fernet token string."""
    return get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str) -> str:
    """Decrypt a Fernet token back to the original UTF-8 string.

    Raises:
        cryptography.fernet.InvalidToken: if the token is malformed or was
            encrypted with a different key.
    """
    return get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")


# ── SQLAlchemy TypeDecorator ──────────────────────────────────────────────────

# Smallest possible Fernet token: 1 (version) + 8 (timestamp) + 16 (IV)
# + 0 (payload) + 32 (HMAC) = 57 bytes before base64.
_MIN_FERNET_BYTES = 57


def _looks_like_fernet_token(value: str) -> bool:
    """Cheap structural check that *value* is a Fernet token.

    Used to tell legacy plaintext apart from ciphertext on the read path
    WITHOUT attempting decryption, so plaintext rows that predate the
    at-rest migration do not crash ORM reads.  A genuine Fernet token is
    urlsafe-base64 and decodes to >=57 bytes starting with version 0x80.
    """
    try:
        data = base64.urlsafe_b64decode(value.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError):
        return False
    return len(data) >= _MIN_FERNET_BYTES and data[0] == 0x80


class EncryptedText(TypeDecorator):
    """``Text`` column transparently encrypted at rest with Fernet.

    - ``process_bind_param``: plaintext → Fernet token (stored in DB).
    - ``process_result_value``: Fernet token → plaintext (returned to Python).

    ``NULL`` values pass through unchanged.  Encryption is transparent to
    service-layer code — callers read and write plaintext strings.

    Legacy plaintext rows (written before the at-rest migration ran) are
    returned as-is instead of raising, so reads never break mid-migration.
    A value that *looks like* a Fernet token but fails to decrypt (wrong key,
    or a rare false-positive of the structural discriminator) is also returned
    as-is rather than raising — a read must never crash on an undecryptable
    value.  Such events are logged so a wrong-key situation is diagnosable.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: object) -> str | None:
        if value is None:
            return None
        return encrypt(value)

    def process_result_value(self, value: str | None, dialect: object) -> str | None:
        if value is None:
            return None
        if not _looks_like_fernet_token(value):
            return value  # Legacy plaintext (migration pending) — pass through.
        try:
            return decrypt(value)
        except InvalidToken:
            # Wrong key or a false-positive discriminator.  Returning the raw
            # value (instead of raising) keeps reads alive; log for diagnosis.
            logger.warning(
                "EncryptedText: value looked like a Fernet token but failed to "
                "decrypt (wrong key or false positive); returning raw value."
            )
            return value


# ── Legacy plaintext migration ─────────────────────────────────────────────────


def _encrypted_columns() -> list[tuple[str, str]]:
    """Return ``(table_name, column_name)`` pairs declared as :class:`EncryptedText`."""
    from stitch_backend.database import Base

    cols: list[tuple[str, str]] = []
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, EncryptedText):
                cols.append((table.name, column.name))
    return cols


async def migrate_plaintext_to_encrypted() -> None:
    """Detect and re-encrypt plaintext rows in :class:`EncryptedText` columns.

    Idempotent: rows already holding valid Fernet tokens are skipped.
    Called from the app lifespan after table creation so existing databases
    keep working without manual intervention.
    """
    from sqlalchemy import text

    from stitch_backend.database import _get_write_engine

    cols = _encrypted_columns()
    if not cols:
        return

    engine = _get_write_engine()
    total_migrated = 0

    async with engine.begin() as conn:
        for table_name, column_name in cols:
            exists = await conn.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name=:t",
                ),
                {"t": table_name},
            )
            if exists.fetchone() is None:
                continue

            rows = (
                await conn.execute(
                    text(
                        f'SELECT rowid, "{column_name}" '
                        f'FROM "{table_name}" '
                        f'WHERE "{column_name}" IS NOT NULL',
                    ),
                )
            ).fetchall()

            for row_id, raw_value in rows:
                if not isinstance(raw_value, str) or raw_value == "":
                    continue
                try:
                    decrypt(raw_value)
                except InvalidToken:
                    pass  # Plaintext — needs encryption
                except Exception:  # noqa: BLE001 — skip non-string/unexpected
                    continue
                else:
                    continue  # Already encrypted — skip

                encrypted = encrypt(raw_value)
                await conn.execute(
                    text(
                        f'UPDATE "{table_name}" '
                        f'SET "{column_name}" = :val '
                        f"WHERE rowid = :rid",
                    ),
                    {"val": encrypted, "rid": row_id},
                )
                total_migrated += 1

    if total_migrated:
        logger.info(
            "Encrypted-at-rest migration: re-encrypted %d plaintext value(s)",
            total_migrated,
        )
