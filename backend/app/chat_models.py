from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

ColumnTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]
CardTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]
CardDetails = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=2000),
]
AssistantText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=8000),
]
ProposalStatus = Literal["pending", "confirmed", "rejected", "stale"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateCardOperation(StrictModel):
    type: Literal["create_card"]
    column_id: UUID
    title: CardTitle
    details: CardDetails


class EditCardOperation(StrictModel):
    type: Literal["edit_card"]
    card_id: UUID
    title: CardTitle | None
    details: CardDetails | None

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if self.title is None and self.details is None:
            raise ValueError("At least one card field is required")
        return self


class MoveCardOperation(StrictModel):
    type: Literal["move_card"]
    card_id: UUID
    target_column_id: UUID
    target_position: int = Field(ge=0)


class DeleteCardOperation(StrictModel):
    type: Literal["delete_card"]
    card_id: UUID


class RenameColumnOperation(StrictModel):
    type: Literal["rename_column"]
    column_id: UUID
    title: ColumnTitle


BoardOperation = Annotated[
    CreateCardOperation
    | EditCardOperation
    | MoveCardOperation
    | DeleteCardOperation
    | RenameColumnOperation,
    Field(discriminator="type"),
]


class AiBoardResponse(StrictModel):
    assistant_text: AssistantText
    operations: list[BoardOperation] = Field(max_length=20)


class ChatRequest(BaseModel):
    message: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000),
    ]


class ProposalResponse(BaseModel):
    id: str
    status: ProposalStatus = "pending"
    base_board_version: int
    operations: list[BoardOperation]


class ChatResponse(BaseModel):
    id: str
    message: str
    model: str
    proposal: ProposalResponse | None


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class StoredChatMessageResponse(ChatHistoryMessage):
    id: str
    created_at: str
    proposal: ProposalResponse | None


class ChatHistoryResponse(BaseModel):
    messages: list[StoredChatMessageResponse]
