"""POST /heartbeat — returns ``{revoked: bool}``.

Client pings at startup (outside offline grace). ``revoked: true`` →
degraded mode (cache works, no updates). Offline grace and degraded
mode are CLIENT concerns; the server just answers revocation status.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from stitch_server.auth import require_token
from stitch_server.models import Token  # noqa: TC001 — FastAPI resolves at runtime

router = APIRouter()


class HeartbeatResponse(BaseModel):
    revoked: bool


@router.post("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(
    token: Annotated[Token, Depends(require_token)],
) -> HeartbeatResponse:
    return HeartbeatResponse(revoked=token.revoked)
