import json

from pydantic import ValidationError

from app.board_models import BoardResponse
from app.board_repository import BoardRepository
from app.chat_models import (
    AiBoardResponse,
    BoardOperation,
    ChatHistoryMessage,
    ChatResponse,
    CreateCardOperation,
    DeleteCardOperation,
    EditCardOperation,
    MoveCardOperation,
    ProposalResponse,
    RenameColumnOperation,
)
from app.chat_repository import ChatRepository
from app.openrouter import OPENROUTER_MODEL, OpenRouterClient

MAX_HISTORY_MESSAGES = 12
MAX_HISTORY_CHARACTERS = 6000

SYSTEM_PROMPT = """You are the assistant for a project-management board.
Answer the user and optionally propose board changes using only the supplied
structured response schema. Use IDs exactly as they appear in the current board.
Return an empty operations list for a text-only answer. For create_card use an
empty details string when no details are needed. For edit_card use null for each
field that should remain unchanged.
Never claim that proposed changes have already been applied. Keep the response
concise."""

AI_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "board_assistant_response",
        "strict": True,
        "schema": AiBoardResponse.model_json_schema(),
    },
}


class InvalidAiResponseError(Exception):
    pass


def truncate_history(
    history: list[ChatHistoryMessage],
) -> list[ChatHistoryMessage]:
    selected: list[ChatHistoryMessage] = []
    remaining_characters = MAX_HISTORY_CHARACTERS
    for message in reversed(history[-MAX_HISTORY_MESSAGES:]):
        if remaining_characters == 0:
            break
        content = message.content[:remaining_characters]
        selected.append(
            ChatHistoryMessage(role=message.role, content=content)
        )
        remaining_characters -= len(content)
    selected.reverse()
    return selected


def build_openrouter_messages(
    board: BoardResponse,
    history: list[ChatHistoryMessage],
    question: str,
) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(
        {"role": message.role, "content": message.content}
        for message in truncate_history(history)
    )
    board_json = json.dumps(
        board.model_dump(mode="json"),
        separators=(",", ":"),
    )
    messages.append(
        {
            "role": "user",
            "content": (
                f"Current board JSON:\n{board_json}\n\n"
                f"User request:\n{question}"
            ),
        }
    )
    return messages


def validate_operations(
    board: BoardResponse,
    operations: list[BoardOperation],
) -> None:
    column_ids = {column.id for column in board.columns}
    card_ids = {
        card.id
        for column in board.columns
        for card in column.cards
    }
    card_actions: dict[str, set[str]] = {}
    renamed_columns: set[str] = set()

    for operation in operations:
        if isinstance(operation, CreateCardOperation):
            if str(operation.column_id) not in column_ids:
                raise InvalidAiResponseError("Unknown board column")
            continue

        if isinstance(operation, RenameColumnOperation):
            column_id = str(operation.column_id)
            if column_id not in column_ids or column_id in renamed_columns:
                raise InvalidAiResponseError("Invalid column rename")
            renamed_columns.add(column_id)
            continue

        card_id = str(operation.card_id)
        if card_id not in card_ids:
            raise InvalidAiResponseError("Unknown board card")

        if isinstance(operation, MoveCardOperation):
            if str(operation.target_column_id) not in column_ids:
                raise InvalidAiResponseError("Unknown target column")
            action = "move"
        elif isinstance(operation, EditCardOperation):
            action = "edit"
        elif isinstance(operation, DeleteCardOperation):
            action = "delete"
        else:
            raise InvalidAiResponseError("Unknown board operation")

        actions = card_actions.setdefault(card_id, set())
        if action in actions or "delete" in actions or (
            action == "delete" and actions
        ):
            raise InvalidAiResponseError("Conflicting card operations")
        actions.add(action)


class ChatService:
    def __init__(
        self,
        board_repository: BoardRepository,
        chat_repository: ChatRepository,
        openrouter_client: OpenRouterClient,
    ) -> None:
        self._board_repository = board_repository
        self._chat_repository = chat_repository
        self._openrouter_client = openrouter_client

    async def respond(self, username: str, question: str) -> ChatResponse:
        board = self._board_repository.get_board(username)
        history = self._chat_repository.get_history(username)
        raw_response = await self._openrouter_client.complete(
            build_openrouter_messages(board, history, question),
            response_format=AI_RESPONSE_FORMAT,
        )
        try:
            ai_response = AiBoardResponse.model_validate_json(raw_response)
        except ValidationError as error:
            raise InvalidAiResponseError(
                "AI service returned an invalid structured response"
            ) from error

        validate_operations(board, ai_response.operations)
        message_id, board_changed = self._chat_repository.save_exchange(
            username,
            question,
            ai_response.assistant_text,
            ai_response.operations,
            board.version,
        )

        proposal = (
            ProposalResponse(
                id=message_id,
                status="stale" if board_changed else "pending",
                base_board_version=board.version,
                operations=ai_response.operations,
            )
            if ai_response.operations
            else None
        )
        return ChatResponse(
            id=message_id,
            message=ai_response.assistant_text,
            model=OPENROUTER_MODEL,
            proposal=proposal,
        )
