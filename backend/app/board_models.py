from typing import Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CardResponse(BaseModel):
    id: str
    title: str
    details: str
    position: int


class ColumnResponse(BaseModel):
    id: str
    title: str
    position: int
    cards: list[CardResponse]


class BoardResponse(BaseModel):
    id: str
    title: str
    version: int
    columns: list[ColumnResponse]


class RenameColumnRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class CreateCardRequest(BaseModel):
    column_id: UUID
    title: str = Field(min_length=1, max_length=200)
    details: str = Field(default="", max_length=2000)


class UpdateCardRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if self.title is None and self.details is None:
            raise ValueError("At least one card field is required")
        return self


class MoveCardRequest(BaseModel):
    target_column_id: UUID
    target_position: int = Field(ge=0)
