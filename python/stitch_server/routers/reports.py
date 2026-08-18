"""POST /reports — accept artifact bundles (multipart or JSON+base64).

Stores the bundle under the reports directory with (plugin_id, version,
step) indexed metadata in the DB. The bundle is scrubbed client-side
before upload (plan §3.4 item 12) — the server does not inspect contents.
"""

from __future__ import annotations

import base64
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.alerting import check_alert_for_group
from stitch_server.auth import require_token
from stitch_server.config import get_settings
from stitch_server.db import get_db
from stitch_server.models import Report, Token

router = APIRouter()


class ReportJSONRequest(BaseModel):
    """JSON+base64 alternative to multipart upload."""

    plugin_id: str
    version: str
    step: str
    bundle: str  # base64-encoded


class ReportResponse(BaseModel):
    id: int
    stored: bool


@router.post("/reports", response_model=ReportResponse)
async def submit_report_multipart(
    plugin_id: Annotated[str, Form()],
    version: Annotated[str, Form()],
    step: Annotated[str, Form()],
    bundle: Annotated[UploadFile, File()],
    token: Annotated[Token, Depends(require_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportResponse:
    data = await bundle.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty bundle")
    path = await _store_bundle(data, "bin", get_settings().reports_path)
    report = Report(
        token_id=token.id,
        plugin_id=plugin_id,
        version=version,
        step=step,
        bundle_path=str(path),
        bundle_format="multipart",
    )
    db.add(report)
    await db.flush()
    await check_alert_for_group(db, plugin_id, version, step)
    return ReportResponse(id=report.id, stored=True)


@router.post("/reports/json", response_model=ReportResponse)
async def submit_report_json(
    req: ReportJSONRequest,
    token: Annotated[Token, Depends(require_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportResponse:
    try:
        data = base64.b64decode(req.bundle)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 bundle: {exc}",
        ) from exc
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty bundle")
    path = await _store_bundle(data, "bin", get_settings().reports_path)
    report = Report(
        token_id=token.id,
        plugin_id=req.plugin_id,
        version=req.version,
        step=req.step,
        bundle_path=str(path),
        bundle_format="json_base64",
    )
    db.add(report)
    await db.flush()
    await check_alert_for_group(db, req.plugin_id, req.version, req.step)
    return ReportResponse(id=report.id, stored=True)


async def _store_bundle(data: bytes, ext: str, reports_dir) -> str:
    """Write bundle bytes to a unique file under reports_dir."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    path = reports_dir / filename
    path.write_bytes(data)
    return str(path)
