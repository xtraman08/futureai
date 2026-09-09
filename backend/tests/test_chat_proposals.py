import asyncio
import json
from contextlib import asynccontextmanager, closing
from pathlib import Path

import httpx
from fastapi import FastAPI
from pydantic import SecretStr

from app.board_repository import BoardRepository
from app.chat_routes import get_openrouter_client
from app.database import connect_database, initialize_database, new_id, utc_now
from app.main import create_app
from app.openrouter import OpenRouterClient
from app.settings import Settings


def provider_response(
    assistant_text: str,
    operations: list[dict],
) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "assistant_text": assistant_text,
                                "operations": operations,
                            }
                        ),
                    },
                    "finish_reason": "stop",
                }
            ]
        },
    )


def make_app(
    tmp_path: Path,
    assistant_text: str,
    operations: list[dict],
) -> FastAPI:
    application = create_app(
        Settings(
            static_dir=tmp_path,
            database_path=tmp_path / "project_management.db",
            openrouter_api_key=SecretStr("test-key"),
        )
    )
    application.dependency_overrides[get_openrouter_client] = lambda: (
        OpenRouterClient(
            "test-key",
            transport=httpx.MockTransport(
                lambda _request: provider_response(
                    assistant_text,
                    operations,
                )
            ),
        )
    )
    return application


@asynccontextmanager
async def app_client(
    application: FastAPI,
    *,
    raise_app_exceptions: bool = True,
):
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(
            app=application,
            raise_app_exceptions=raise_app_exceptions,
        )
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            login = await client.post(
                "/api/auth/login",
                json={"username": "user", "password": "password"},
            )
            assert login.status_code == 200
            yield client


async def text_only_chat(tmp_path: Path) -> None:
    application = make_app(tmp_path, "No board changes are needed.", [])
    async with app_client(application) as client:
        initial_board = (await client.get("/api/board")).json()
        response = await client.post(
            "/api/chat",
            json={"message": "Review the board."},
        )
        history = await client.get("/api/chat")
        unchanged_board = (await client.get("/api/board")).json()

    assert response.status_code == 200
    assert response.json()["proposal"] is None
    assert history.status_code == 200
    assert [
        (message["role"], message["content"])
        for message in history.json()["messages"]
    ] == [
        ("user", "Review the board."),
        ("assistant", "No board changes are needed."),
    ]
    assert unchanged_board == initial_board
    with closing(connect_database(tmp_path / "project_management.db")) as connection:
        messages = connection.execute(
            """
            SELECT role, content, proposed_operations_json
            FROM chat_messages
            ORDER BY created_at, id
            """
        ).fetchall()
    assert [(row["role"], row["content"]) for row in messages] == [
        ("user", "Review the board."),
        ("assistant", "No board changes are needed."),
    ]
    assert all(row["proposed_operations_json"] is None for row in messages)


def test_text_only_chat_persists_without_changing_board(tmp_path: Path) -> None:
    asyncio.run(text_only_chat(tmp_path))


async def proposal_lifecycle(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")

    initial = BoardRepository(database_path).get_board("user")
    backlog, discovery, in_progress = initial.columns[:3]
    edited_card = backlog.cards[0]
    moved_card = backlog.cards[1]
    deleted_card = discovery.cards[0]
    operations = [
        {
            "type": "rename_column",
            "column_id": str(backlog.id),
            "title": "Ideas",
        },
        {
            "type": "create_card",
            "column_id": str(discovery.id),
            "title": "AI-created card",
            "details": "Created only after confirmation.",
        },
        {
            "type": "edit_card",
            "card_id": str(edited_card.id),
            "title": "AI-edited card",
            "details": None,
        },
        {
            "type": "move_card",
            "card_id": str(moved_card.id),
            "target_column_id": str(in_progress.id),
            "target_position": 0,
        },
        {"type": "delete_card", "card_id": str(deleted_card.id)},
    ]
    application = make_app(
        tmp_path,
        "I prepared five board changes.",
        operations,
    )

    async with app_client(application) as client:
        proposed = await client.post(
            "/api/chat",
            json={"message": "Please update the board."},
        )
        before_confirmation = (await client.get("/api/board")).json()
        proposal = proposed.json()["proposal"]
        confirmed = await client.post(
            f"/api/chat/proposals/{proposal['id']}/confirm"
        )
        history = await client.get("/api/chat")
        duplicate_confirmation = await client.post(
            f"/api/chat/proposals/{proposal['id']}/confirm"
        )

    assert proposed.status_code == 200
    assert proposal["status"] == "pending"
    assert proposal["base_board_version"] == initial.version
    assert len(proposal["operations"]) == 5
    assert before_confirmation == initial.model_dump(mode="json")

    assert confirmed.status_code == 200
    board = confirmed.json()
    assert board["version"] == initial.version + 1
    assert board["columns"][0]["title"] == "Ideas"
    assert any(
        card["title"] == "AI-created card"
        for card in board["columns"][1]["cards"]
    )
    assert board["columns"][0]["cards"][0]["title"] == "AI-edited card"
    assert board["columns"][2]["cards"][0]["id"] == moved_card.id
    assert all(
        card["id"] != deleted_card.id
        for column in board["columns"]
        for card in column["cards"]
    )
    assert duplicate_confirmation.status_code == 409
    assert duplicate_confirmation.json() == {
        "detail": "Proposal is not pending"
    }
    assistant_history = history.json()["messages"][-1]
    assert assistant_history["proposal"]["status"] == "confirmed"
    assert len(assistant_history["proposal"]["operations"]) == 5

    with closing(connect_database(database_path)) as connection:
        status_value = connection.execute(
            "SELECT proposal_status FROM chat_messages WHERE id = ?",
            (proposal["id"],),
        ).fetchone()[0]
    assert status_value == "confirmed"


def test_proposal_requires_confirmation_and_applies_atomically(
    tmp_path: Path,
) -> None:
    asyncio.run(proposal_lifecycle(tmp_path))


async def stale_proposal(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")

    initial = BoardRepository(database_path).get_board("user")
    column = initial.columns[0]
    application = make_app(
        tmp_path,
        "I can rename that column.",
        [
            {
                "type": "rename_column",
                "column_id": column.id,
                "title": "AI name",
            }
        ],
    )
    async with app_client(application) as client:
        proposed = await client.post(
            "/api/chat",
            json={"message": "Rename the first column."},
        )
        proposal_id = proposed.json()["proposal"]["id"]
        manual_change = await client.patch(
            f"/api/board/columns/{column.id}",
            json={"title": "Manual name"},
        )
        confirmation = await client.post(
            f"/api/chat/proposals/{proposal_id}/confirm"
        )
        board = (await client.get("/api/board")).json()

    assert manual_change.status_code == 200
    assert confirmation.status_code == 409
    assert confirmation.json() == {"detail": "Proposal is stale"}
    assert board["columns"][0]["title"] == "Manual name"
    with closing(connect_database(database_path)) as connection:
        status_value = connection.execute(
            "SELECT proposal_status FROM chat_messages WHERE id = ?",
            (proposal_id,),
        ).fetchone()[0]
    assert status_value == "stale"


def test_confirmation_rejects_stale_proposal(tmp_path: Path) -> None:
    asyncio.run(stale_proposal(tmp_path))


async def rejected_proposal(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")
    initial = BoardRepository(database_path).get_board("user")
    column = initial.columns[0]
    application = make_app(
        tmp_path,
        "I can rename that column.",
        [
            {
                "type": "rename_column",
                "column_id": column.id,
                "title": "Rejected name",
            }
        ],
    )
    async with app_client(application) as client:
        proposed = await client.post(
            "/api/chat",
            json={"message": "Rename the first column."},
        )
        proposal_id = proposed.json()["proposal"]["id"]
        rejected = await client.post(
            f"/api/chat/proposals/{proposal_id}/reject"
        )
        duplicate_rejection = await client.post(
            f"/api/chat/proposals/{proposal_id}/reject"
        )
        history = await client.get("/api/chat")

    assert rejected.status_code == 204
    assert duplicate_rejection.status_code == 409
    assert BoardRepository(database_path).get_board("user") == initial
    assert history.json()["messages"][-1]["proposal"]["status"] == "rejected"


def test_rejection_persists_without_changing_board(tmp_path: Path) -> None:
    asyncio.run(rejected_proposal(tmp_path))


def add_foreign_column(database_path: Path) -> str:
    timestamp = utc_now()
    user_id = new_id()
    board_id = new_id()
    column_id = new_id()
    with closing(connect_database(database_path)) as connection, connection:
        connection.execute(
            """
            INSERT INTO users
                (id, username, password_hash, created_at, updated_at)
            VALUES (?, 'other', NULL, ?, ?)
            """,
            (user_id, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO boards
                (id, user_id, title, created_at, updated_at)
            VALUES (?, ?, 'Other board', ?, ?)
            """,
            (board_id, user_id, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO board_columns
                (id, board_id, title, position, created_at, updated_at)
            VALUES (?, ?, 'Private', 0, ?, ?)
            """,
            (column_id, board_id, timestamp, timestamp),
        )
    return column_id


async def foreign_operation(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")
    foreign_column_id = add_foreign_column(database_path)
    application = make_app(
        tmp_path,
        "I prepared a card.",
        [
            {
                "type": "create_card",
                "column_id": foreign_column_id,
                "title": "Unauthorized",
                "details": "",
            }
        ],
    )
    async with app_client(application) as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Create a card."},
        )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "AI service returned invalid board changes"
    }
    with closing(connect_database(database_path)) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM chat_messages"
        ).fetchone()[0] == 0


def test_chat_rejects_operation_on_another_users_board(tmp_path: Path) -> None:
    asyncio.run(foreign_operation(tmp_path))


async def board_change_during_generation(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")
    repository = BoardRepository(database_path)
    column = repository.get_board("user").columns[0]
    application = make_app(tmp_path, "This response is stale.", [])

    def change_board(_request: httpx.Request) -> httpx.Response:
        repository.rename_column("user", column.id, "Changed concurrently")
        return provider_response("This response is stale.", [])

    application.dependency_overrides[get_openrouter_client] = lambda: (
        OpenRouterClient(
            "test-key",
            transport=httpx.MockTransport(change_board),
        )
    )

    async with app_client(application) as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Describe the board."},
        )
        history = await client.get("/api/chat")

    assert response.status_code == 200
    assert response.json()["message"] == "This response is stale."
    assert response.json()["proposal"] is None
    assert [
        (message["role"], message["content"])
        for message in history.json()["messages"]
    ] == [
        ("user", "Describe the board."),
        ("assistant", "This response is stale."),
    ]
    with closing(connect_database(database_path)) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM chat_messages"
        ).fetchone()[0] == 2


def test_chat_preserves_response_if_board_changed_during_generation(
    tmp_path: Path,
) -> None:
    asyncio.run(board_change_during_generation(tmp_path))


async def proposal_marked_stale_if_board_changes_during_generation(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")
    repository = BoardRepository(database_path)
    column = repository.get_board("user").columns[0]
    operations = [
        {
            "type": "rename_column",
            "column_id": column.id,
            "title": "Renamed by the assistant",
        }
    ]
    application = make_app(tmp_path, "I renamed the column.", operations)

    def change_board(_request: httpx.Request) -> httpx.Response:
        repository.rename_column("user", column.id, "Changed concurrently")
        return provider_response("I renamed the column.", operations)

    application.dependency_overrides[get_openrouter_client] = lambda: (
        OpenRouterClient(
            "test-key",
            transport=httpx.MockTransport(change_board),
        )
    )

    async with app_client(application) as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Rename the first column."},
        )
        body = response.json()
        confirmation = await client.post(
            f"/api/chat/proposals/{body['proposal']['id']}/confirm",
        )

    assert response.status_code == 200
    assert body["message"] == "I renamed the column."
    assert body["proposal"]["status"] == "stale"
    assert confirmation.status_code == 409

    with closing(connect_database(database_path)) as connection:
        stored_status = connection.execute(
            "SELECT proposal_status FROM chat_messages WHERE role = 'assistant'"
        ).fetchone()[0]
    assert stored_status == "stale"


def test_proposal_marked_stale_if_board_changes_during_generation(
    tmp_path: Path,
) -> None:
    asyncio.run(proposal_marked_stale_if_board_changes_during_generation(tmp_path))


async def confirmation_rollback(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")

    initial = BoardRepository(database_path).get_board("user")
    column = initial.columns[0]
    card = column.cards[0]
    application = make_app(
        tmp_path,
        "I prepared two changes.",
        [
            {
                "type": "rename_column",
                "column_id": column.id,
                "title": "Rolled back name",
            },
            {
                "type": "edit_card",
                "card_id": card.id,
                "title": "Rolled back card",
                "details": None,
            },
        ],
    )
    async with app_client(
        application,
        raise_app_exceptions=False,
    ) as client:
        proposed = await client.post(
            "/api/chat",
            json={"message": "Prepare changes."},
        )
        proposal_id = proposed.json()["proposal"]["id"]
        with closing(connect_database(database_path)) as connection:
            connection.execute(
                """
                CREATE TRIGGER prevent_ai_confirmation
                BEFORE UPDATE ON boards
                BEGIN
                    SELECT RAISE(ABORT, 'blocked for rollback test');
                END
                """
            )
            connection.commit()
        confirmation = await client.post(
            f"/api/chat/proposals/{proposal_id}/confirm"
        )

    assert confirmation.status_code == 500
    unchanged = BoardRepository(database_path).get_board("user")
    assert unchanged == initial
    with closing(connect_database(database_path)) as connection:
        status_value = connection.execute(
            "SELECT proposal_status FROM chat_messages WHERE id = ?",
            (proposal_id,),
        ).fetchone()[0]
    assert status_value == "pending"


def test_failed_confirmation_rolls_back_every_operation(tmp_path: Path) -> None:
    asyncio.run(confirmation_rollback(tmp_path))
