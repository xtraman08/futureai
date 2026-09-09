import json

import pytest
from pydantic import ValidationError

from app.board_models import BoardResponse, CardResponse, ColumnResponse
from app.chat_models import AiBoardResponse, ChatHistoryMessage
from app.chat_service import (
    MAX_HISTORY_CHARACTERS,
    MAX_HISTORY_MESSAGES,
    InvalidAiResponseError,
    build_openrouter_messages,
    truncate_history,
    validate_operations,
)

COLUMN_ONE = "00000000-0000-7000-8000-000000000001"
COLUMN_TWO = "00000000-0000-7000-8000-000000000002"
CARD_ONE = "00000000-0000-7000-8000-000000000003"
CARD_TWO = "00000000-0000-7000-8000-000000000004"
UNKNOWN_ID = "00000000-0000-7000-8000-000000000099"


def board_fixture() -> BoardResponse:
    return BoardResponse(
        id="00000000-0000-7000-8000-000000000000",
        title="Test board",
        version=4,
        columns=[
            ColumnResponse(
                id=COLUMN_ONE,
                title="Backlog",
                position=0,
                cards=[
                    CardResponse(
                        id=CARD_ONE,
                        title="First",
                        details="",
                        position=0,
                    ),
                    CardResponse(
                        id=CARD_TWO,
                        title="Second",
                        details="",
                        position=1,
                    ),
                ],
            ),
            ColumnResponse(
                id=COLUMN_TWO,
                title="Done",
                position=1,
                cards=[],
            ),
        ],
    )


def parse_operations(operations: list[dict]):
    return AiBoardResponse.model_validate(
        {"assistant_text": "Proposed changes.", "operations": operations}
    ).operations


def test_structured_response_supports_every_operation_type() -> None:
    response = AiBoardResponse.model_validate(
        {
            "assistant_text": "I prepared five changes.",
            "operations": [
                {
                    "type": "create_card",
                    "column_id": COLUMN_ONE,
                    "title": "New",
                    "details": "Details",
                },
                {
                    "type": "edit_card",
                    "card_id": CARD_ONE,
                    "title": "Edited",
                    "details": None,
                },
                {
                    "type": "move_card",
                    "card_id": CARD_ONE,
                    "target_column_id": COLUMN_TWO,
                    "target_position": 0,
                },
                {"type": "delete_card", "card_id": CARD_TWO},
                {
                    "type": "rename_column",
                    "column_id": COLUMN_TWO,
                    "title": "Complete",
                },
            ],
        }
    )

    assert [operation.type for operation in response.operations] == [
        "create_card",
        "edit_card",
        "move_card",
        "delete_card",
        "rename_column",
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {
            "assistant_text": "Unknown.",
            "operations": [{"type": "archive_card", "card_id": CARD_ONE}],
        },
        {
            "assistant_text": "No actual edit.",
            "operations": [
                {
                    "type": "edit_card",
                    "card_id": CARD_ONE,
                    "title": None,
                    "details": None,
                }
            ],
        },
        {
            "assistant_text": "Extra data.",
            "operations": [],
            "unexpected": True,
        },
    ],
)
def test_structured_response_rejects_malformed_output(payload: dict) -> None:
    with pytest.raises(ValidationError):
        AiBoardResponse.model_validate(payload)


def test_history_and_board_prompt_are_bounded_and_grounded() -> None:
    history = [
        ChatHistoryMessage(
            role="user" if index % 2 == 0 else "assistant",
            content=f"{index}:" + ("x" * 700),
        )
        for index in range(20)
    ]

    selected = truncate_history(history)
    messages = build_openrouter_messages(
        board_fixture(),
        history,
        "What should move?",
    )

    assert len(selected) <= MAX_HISTORY_MESSAGES
    assert sum(len(message.content) for message in selected) <= (
        MAX_HISTORY_CHARACTERS
    )
    assert selected[-1].content.startswith("19:")
    assert messages[0]["role"] == "system"
    latest = messages[-1]["content"]
    assert "What should move?" in latest
    board_json = latest.split("Current board JSON:\n", maxsplit=1)[1].split(
        "\n\nUser request:",
        maxsplit=1,
    )[0]
    assert json.loads(board_json)["version"] == 4


@pytest.mark.parametrize(
    "operations",
    [
        [
            {
                "type": "create_card",
                "column_id": UNKNOWN_ID,
                "title": "Foreign",
                "details": "",
            }
        ],
        [
            {
                "type": "move_card",
                "card_id": CARD_ONE,
                "target_column_id": UNKNOWN_ID,
                "target_position": 0,
            }
        ],
        [
            {"type": "delete_card", "card_id": CARD_ONE},
            {
                "type": "edit_card",
                "card_id": CARD_ONE,
                "title": "Conflict",
                "details": None,
            },
        ],
        [
            {
                "type": "rename_column",
                "column_id": COLUMN_ONE,
                "title": "First name",
            },
            {
                "type": "rename_column",
                "column_id": COLUMN_ONE,
                "title": "Second name",
            },
        ],
    ],
)
def test_operation_validation_rejects_unknown_or_conflicting_changes(
    operations: list[dict],
) -> None:
    with pytest.raises(InvalidAiResponseError):
        validate_operations(board_fixture(), parse_operations(operations))
