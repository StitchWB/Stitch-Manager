"""Request schema for the read-only ``list_model_health`` registry query."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ListModelHealthRequest(BaseModel):
    """Query the persisted model-health registry.

    Rows come from what ``refresh_endpoint_models`` wrote (``UpstreamModel`` +
    ``CredentialModelAccess``); nothing is probed here. Filters are tri-state
    (``None`` = don't care) so ``alive``/``usable``/``vision``/``tools`` can be
    asserted or negated.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    endpoint_id: str | None = Field(None, alias="endpointId")
    prefix: str | None = None
    alive: bool | None = None
    usable: bool | None = None
    vision: bool | None = None
    tools: bool | None = None
    changed_since: str | None = Field(None, alias="changedSince")
    sort: Literal["model", "latency"] = "model"
    top_k: int = Field(0, alias="topK", ge=0)
    fields: list[str] | None = None
    limit: int = Field(100, ge=0)
    offset: int = Field(0, ge=0)
