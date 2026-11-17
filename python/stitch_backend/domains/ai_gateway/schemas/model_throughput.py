from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ListModelThroughputRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    window_minutes: float = Field(60, alias="windowMinutes", gt=0)
    limit: int = Field(50, ge=0)
