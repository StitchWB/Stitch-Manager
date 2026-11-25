"""Install-key material planning/provisioning for Model Sync targets.

Preview is strictly read-only: it may compare the hash of a key already
present in a target config with enabled install-key metadata, but it never
creates rows.  Apply provisions through the ai_gateway install-key service and
receives the raw key exactly once; the raw value is held only in memory for the
subsequent file rewrite.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, field
from typing import Any, cast

KEY_SENTINEL = "__MODEL_SYNC_KEY_PENDING__"
KEY_PURPOSE = "model-sync"
KEY_LABEL = "Stitch Model Sync"


class KeyMaterialUnavailable(RuntimeError):
    """Install-key service/DB is unavailable or rejected provisioning."""


@dataclass
class KeyMaterial:
    target: str
    action: str  # reuse | create | missing
    raw: str | None = None
    fingerprint: str | None = None
    key_id: str | None = None
    legacy_local_token_detected: bool = False
    error: str | None = None
    created_key_id: str | None = None
    superseded_key_ids: list[str] = field(default_factory=list)
    stale_key_hashes: set[str] = field(default_factory=set)

    def public_plan(self) -> dict[str, Any]:
        """Metadata-only keyPlan fragment — never includes raw key material."""
        out: dict[str, Any] = {
            "action": self.action,
            "legacyLocalTokenDetected": self.legacy_local_token_detected,
        }
        if self.fingerprint:
            out["fingerprint"] = self.fingerprint[:8]
        if self.error:
            out["error"] = self.error
        return out


def sha256_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _install_service() -> Any:
    try:
        from stitch_backend.domains.ai_gateway import install_key_service
    except Exception as exc:  # Dev1 integration may not be present in unit-test checkouts
        raise KeyMaterialUnavailable("install key service unavailable") from exc
    return install_key_service


def _matching_enabled_row(rows: list[Any], extracted_hash: str) -> Any | None:
    for row in rows:
        token_hash = _row_attr(row, "token_hash")
        if not _row_attr(row, "enabled") or not isinstance(token_hash, str):
            continue
        if hmac.compare_digest(token_hash, extracted_hash):
            return row
    return None


def _row_attr(row: Any, name: str) -> Any:
    if isinstance(row, dict):
        return row.get(name)
    return getattr(row, name, None)


async def _service_list(service: Any, session: Any, target: str) -> list[Any]:
    # Canonical interface is module-level list_install_keys(session, ...)
    # returning rows with token_hash for exact key reuse.  A transitional
    # class-based Dev1 implementation exposes only fingerprinted public dicts;
    # in that case read the ORM rows directly inside the same session so reuse
    # still compares full hashes exactly (hashes only — never raw keys).
    if hasattr(service, "list_install_keys"):
        return cast(
            "list[Any]",
            await service.list_install_keys(session, purpose=KEY_PURPOSE, target=target),
        )
    from sqlalchemy import select

    from stitch_backend.domains.ai_gateway.models import InstallProxyKey

    result = await session.execute(
        select(InstallProxyKey)
        .where(InstallProxyKey.purpose == KEY_PURPOSE, InstallProxyKey.target == target)
        .order_by(InstallProxyKey.created_at.asc())
    )
    return list(result.scalars().all())


async def _service_create(service: Any, session: Any, target: str) -> tuple[Any, str]:
    if hasattr(service, "create_install_key"):
        return cast(
            "tuple[Any, str]",
            await service.create_install_key(
                session,
                purpose=KEY_PURPOSE,
                target=target,
                label=KEY_LABEL,
            ),
        )
    return cast(
        "tuple[Any, str]",
        await service.InstallKeyService(session).create_install_key(
            purpose=KEY_PURPOSE,
            target=target,
            label=KEY_LABEL,
        ),
    )


async def _service_revoke(service: Any, session: Any, key_id: str) -> bool:
    if hasattr(service, "revoke_install_key"):
        return cast("bool", await service.revoke_install_key(session, key_id))
    return cast("bool", await service.InstallKeyService(session).revoke_install_key(key_id))


def _row_fingerprint(row: Any) -> str | None:
    token_hash = _row_attr(row, "token_hash")
    return token_hash if isinstance(token_hash, str) else None


def _enabled_other_ids(rows: list[Any], keep_id: str | None) -> list[str]:
    ids: list[str] = []
    for row in rows:
        row_id = _row_attr(row, "id")
        if _row_attr(row, "enabled") and isinstance(row_id, str) and row_id != keep_id:
            ids.append(row_id)
    return ids


def _all_other_hashes(rows: list[Any], keep_id: str | None) -> set[str]:
    hashes: set[str] = set()
    for row in rows:
        row_id = _row_attr(row, "id")
        token_hash = _row_attr(row, "token_hash")
        if row_id != keep_id and isinstance(token_hash, str):
            hashes.add(token_hash)
    return hashes


async def _list_rows_readonly(target: str) -> list[Any]:
    service = _install_service()
    try:
        from stitch_backend.database import run_in_read_session
    except Exception as exc:
        raise KeyMaterialUnavailable("database session factory unavailable") from exc

    async def _load(session: Any) -> list[Any]:
        return await _service_list(service, session, target)

    try:
        return await run_in_read_session(_load)
    except Exception as exc:
        raise KeyMaterialUnavailable(f"install key lookup failed: {type(exc).__name__}") from exc


async def list_key_rows_readonly(target: str) -> list[Any]:
    """Internal metadata rows for status surfaces (hashes/metadata, never raw keys)."""
    return await _list_rows_readonly(target)


async def plan_key_material(
    target: str,
    extracted_raw: str | None,
    *,
    legacy_local_token: str | None = None,
) -> KeyMaterial:
    """Read-only key plan for preview.

    ``reuse`` is possible only when the raw key already configured in the
    target exactly matches an enabled install-key hash.  Otherwise the plan is
    ``create`` (or ``missing`` when metadata cannot be read), and generated
    preview content must use :data:`KEY_SENTINEL` instead of a real key.
    """
    legacy_detected = bool(
        extracted_raw and legacy_local_token and extracted_raw == legacy_local_token
    )
    try:
        rows = await _list_rows_readonly(target)
    except KeyMaterialUnavailable as exc:
        return KeyMaterial(
            target=target,
            action="missing",
            legacy_local_token_detected=legacy_detected,
            error=str(exc)[:180],
        )

    if extracted_raw:
        extracted_hash = sha256_key(extracted_raw)
        row = _matching_enabled_row(rows, extracted_hash)
        if row is not None:
            row_id = _row_attr(row, "id")
            return KeyMaterial(
                target=target,
                action="reuse",
                raw=extracted_raw,
                fingerprint=extracted_hash,
                key_id=row_id if isinstance(row_id, str) else None,
                legacy_local_token_detected=legacy_detected,
                superseded_key_ids=_enabled_other_ids(
                    rows, row_id if isinstance(row_id, str) else None
                ),
                stale_key_hashes=_all_other_hashes(
                    rows, row_id if isinstance(row_id, str) else None
                ),
            )
    return KeyMaterial(
        target=target,
        action="create",
        legacy_local_token_detected=legacy_detected,
        superseded_key_ids=_enabled_other_ids(rows, None),
        stale_key_hashes=_all_other_hashes(rows, None),
    )


async def provision_key_material(
    target: str,
    extracted_raw: str | None,
    *,
    legacy_local_token: str | None = None,
) -> KeyMaterial:
    """Reuse or create the per-target install key for apply.

    Creation happens only after file-sha validation has succeeded (the caller
    owns that ordering).  Returns raw key material in memory plus metadata
    needed for post-success revocation of superseded keys.
    """
    service = _install_service()
    try:
        from stitch_backend.database import run_in_session
    except Exception as exc:
        raise KeyMaterialUnavailable("database session factory unavailable") from exc

    legacy_detected = bool(
        extracted_raw and legacy_local_token and extracted_raw == legacy_local_token
    )

    async def _provision(session: Any) -> KeyMaterial:
        rows = await _service_list(service, session, target)
        if extracted_raw:
            extracted_hash = sha256_key(extracted_raw)
            row = _matching_enabled_row(rows, extracted_hash)
            if row is not None:
                row_id = _row_attr(row, "id")
                keep = row_id if isinstance(row_id, str) else None
                return KeyMaterial(
                    target=target,
                    action="reuse",
                    raw=extracted_raw,
                    fingerprint=extracted_hash,
                    key_id=keep,
                    legacy_local_token_detected=legacy_detected,
                    superseded_key_ids=_enabled_other_ids(rows, keep),
                    stale_key_hashes=_all_other_hashes(rows, keep),
                )

        row, raw = await _service_create(service, session, target)
        row_id = _row_attr(row, "id")
        keep = row_id if isinstance(row_id, str) else None
        return KeyMaterial(
            target=target,
            action="create",
            raw=raw,
            fingerprint=sha256_key(raw),
            key_id=keep,
            legacy_local_token_detected=legacy_detected,
            created_key_id=keep,
            superseded_key_ids=_enabled_other_ids(rows, keep),
            stale_key_hashes=_all_other_hashes(rows, keep),
        )

    try:
        return await run_in_session(_provision)
    except Exception as exc:
        raise KeyMaterialUnavailable(
            f"install key provisioning failed: {type(exc).__name__}"
        ) from exc


async def revoke_install_keys(key_ids: list[str]) -> list[str]:
    """Best-effort revoke helper; returns metadata-only error strings."""
    if not key_ids:
        return []
    service = _install_service()
    try:
        from stitch_backend.database import run_in_session
    except Exception:
        return ["database session factory unavailable while revoking install keys"]

    errors: list[str] = []

    async def _revoke(session: Any) -> None:
        for key_id in key_ids:
            try:
                await _service_revoke(service, session, key_id)
            except Exception as exc:
                errors.append(f"install key {key_id}: {type(exc).__name__}")

    try:
        await run_in_session(_revoke)
    except Exception as exc:
        errors.append(f"install key revocation failed: {type(exc).__name__}")
    return errors
