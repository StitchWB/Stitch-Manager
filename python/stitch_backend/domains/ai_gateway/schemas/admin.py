"""Legacy admin tool schemas (gateway_claim_legacy / gateway_set_instance_shared)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GatewayClaimLegacyRequest(BaseModel):
    """Request body for ``gateway_claim_legacy`` (admin only).

    ``kind`` selects the target table (``credential`` | ``endpoint`` |
    ``public_model``); ``id`` is the row PK.  ``assignToUserId`` sets a
    specific new owner; when omitted, the caller's uid is used.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    kind: str  # "credential" | "endpoint" | "public_model"
    id: str
    assign_to_user_id: int | None = Field(None, alias="assignToUserId")

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, v: str) -> str:
        allowed = {"credential", "endpoint", "public_model"}
        if v not in allowed:
            raise ValueError(f"kind must be one of {sorted(allowed)}")
        return v


class GatewaySetInstanceSharedRequest(BaseModel):
    """Request body for ``gateway_set_instance_shared`` (admin only).

    ``kind`` is ``credential`` | ``endpoint`` | ``public_model``.
    ``shared=True`` sets ``owner_id=NULL`` (instance-shared);
    ``shared=False`` sets ``owner_id`` to ``ownerId`` (or the caller's
    uid when ``ownerId`` is omitted).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    kind: str  # "credential" | "endpoint" | "public_model"
    id: str
    shared: bool
    owner_id: int | None = Field(None, alias="ownerId")

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, v: str) -> str:
        allowed = {"credential", "endpoint", "public_model"}
        if v not in allowed:
            raise ValueError(f"kind must be one of {sorted(allowed)}")
        return v
