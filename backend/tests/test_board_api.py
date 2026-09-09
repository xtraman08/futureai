import asyncio
from contextlib import asynccontextmanager, closing
from pathlib import Path

import httpx
from fastapi import FastAPI

from app.database import connect_database, new_id, utc_now
from app.main import create_app
from app.settings import Settings

MISSING_ID = "00000000-0000-7000-8000-000000000000"


def make_app(tmp_path: Path) -> FastAPI:
    static_dir = tmp_path / "static"
    static_dir.mkdir(exist_ok=True)
    return create_app(
        Settings(
            static_dir=static_dir,
            database_path=tmp_path / "project_management.db",
        )
    )


@asynccontextmanager
async def app_client(application: FastAPI):
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            yield client


async def login(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


async def board_lifecycle(tmp_path: Path) -> None:
    application = make_app(tmp_path)
    async with app_client(application) as client:
        assert (await client.get("/api/board")).status_code == 401
        await login(client)

        initial = (await client.get("/api/board")).json()
        assert initial["title"] == "Kanban Studio"
        assert initial["version"] == 0
        assert [column["title"] for column in initial["columns"]] == [
            "Backlog",
            "Discovery",
            "In Progress",
            "Review",
            "Done",
        ]
        assert sum(len(column["cards"]) for column in initial["columns"]) == 8

        source_column = initial["columns"][0]
        target_column = initial["columns"][3]
        renamed = await client.patch(
            f"/api/board/columns/{source_column['id']}",
            json={"title": "Ideas"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["columns"][0]["title"] == "Ideas"
        assert renamed.json()["version"] == 1

        created = await client.post(
            "/api/board/cards",
            json={
                "column_id": source_column["id"],
                "title": "  Persistent card  ",
                "details": "  Stored in SQLite  ",
            },
        )
        assert created.status_code == 200
        created_board = created.json()
        new_card = next(
            card
            for card in created_board["columns"][0]["cards"]
            if card["title"] == "Persistent card"
        )
        assert new_card["details"] == "Stored in SQLite"
        assert created_board["version"] == 2

        updated = await client.patch(
            f"/api/board/cards/{new_card['id']}",
            json={"title": "Updated card", "details": "Updated details"},
        )
        assert updated.status_code == 200
        assert updated.json()["version"] == 3

        moved = await client.post(
            f"/api/board/cards/{new_card['id']}/move",
            json={
                "target_column_id": target_column["id"],
                "target_position": 0,
            },
        )
        assert moved.status_code == 200
        moved_board = moved.json()
        moved_target = next(
            column
            for column in moved_board["columns"]
            if column["id"] == target_column["id"]
        )
        assert moved_target["cards"][0]["id"] == new_card["id"]
        assert moved_board["version"] == 4

        reordered = await client.post(
            f"/api/board/cards/{new_card['id']}/move",
            json={
                "target_column_id": target_column["id"],
                "target_position": 99,
            },
        )
        reordered_target = next(
            column
            for column in reordered.json()["columns"]
            if column["id"] == target_column["id"]
        )
        assert reordered_target["cards"][-1]["id"] == new_card["id"]
        assert reordered.json()["version"] == 5

        deleted = await client.delete(f"/api/board/cards/{new_card['id']}")
        assert deleted.status_code == 200
        assert deleted.json()["version"] == 6
        assert all(
            card["id"] != new_card["id"]
            for column in deleted.json()["columns"]
            for card in column["cards"]
        )

        deleted_board = deleted.json()
        discovery = deleted_board["columns"][1]
        sole_discovery_card = discovery["cards"][0]
        emptied = await client.post(
            f"/api/board/cards/{sole_discovery_card['id']}/move",
            json={
                "target_column_id": source_column["id"],
                "target_position": 99,
            },
        )
        assert emptied.status_code == 200
        emptied_board = emptied.json()
        assert emptied_board["columns"][1]["cards"] == []
        assert [
            card["position"] for card in emptied_board["columns"][0]["cards"]
        ] == list(range(len(emptied_board["columns"][0]["cards"])))
        assert emptied_board["version"] == 7

    restarted_app = make_app(tmp_path)
    async with app_client(restarted_app) as restarted_client:
        await login(restarted_client)
        persisted = (await restarted_client.get("/api/board")).json()
        assert persisted["version"] == 7
        assert persisted["columns"][0]["title"] == "Ideas"


def test_authenticated_board_lifecycle_persists(tmp_path: Path) -> None:
    asyncio.run(board_lifecycle(tmp_path))


async def invalid_operations(tmp_path: Path) -> None:
    async with app_client(make_app(tmp_path)) as client:
        await login(client)
        board = (await client.get("/api/board")).json()
        column_id = board["columns"][0]["id"]
        card_id = board["columns"][0]["cards"][0]["id"]

        responses = [
            await client.patch(
                f"/api/board/columns/{column_id}",
                json={"title": "   "},
            ),
            await client.patch(
                f"/api/board/columns/{MISSING_ID}",
                json={"title": "Name"},
            ),
            await client.post(
                "/api/board/cards",
                json={"column_id": MISSING_ID, "title": "Card"},
            ),
            await client.patch(f"/api/board/cards/{card_id}", json={}),
            await client.patch(
                f"/api/board/cards/{card_id}",
                json={"title": "   "},
            ),
            await client.patch(
                f"/api/board/cards/{MISSING_ID}",
                json={"title": "Name"},
            ),
            await client.post(
                f"/api/board/cards/{card_id}/move",
                json={"target_column_id": MISSING_ID, "target_position": 0},
            ),
            await client.delete(f"/api/board/cards/{MISSING_ID}"),
            await client.post(
                f"/api/board/cards/{card_id}/move",
                json={"target_column_id": column_id, "target_position": -1},
            ),
            await client.patch(
                "/api/board/cards/not-a-uuid",
                json={"title": "Name"},
            ),
            await client.post(
                "/api/board/cards",
                json={"column_id": "not-a-uuid", "title": "Card"},
            ),
        ]

        assert [response.status_code for response in responses] == [
            400,
            404,
            404,
            422,
            400,
            404,
            404,
            404,
            422,
            422,
            422,
        ]


def test_board_api_rejects_invalid_operations(tmp_path: Path) -> None:
    asyncio.run(invalid_operations(tmp_path))


async def ownership_check(tmp_path: Path) -> None:
    application = make_app(tmp_path)
    async with app_client(application) as client:
        timestamp = utc_now()
        other_user_id = new_id()
        other_board_id = new_id()
        other_column_id = new_id()
        other_card_id = new_id()
        same_user_board_id = new_id()
        same_user_column_id = new_id()
        with closing(
            connect_database(application.state.settings.database_path)
        ) as connection, connection:
            primary_user_id = connection.execute(
                "SELECT id FROM users WHERE username = 'user'"
            ).fetchone()["id"]
            connection.execute(
                """
                    INSERT INTO users
                        (id, username, password_hash, created_at, updated_at)
                    VALUES (?, 'other', NULL, ?, ?)
                    """,
                (other_user_id, timestamp, timestamp),
            )
            connection.execute(
                """
                    INSERT INTO boards
                        (id, user_id, title, created_at, updated_at)
                    VALUES (?, ?, 'Other board', ?, ?)
                    """,
                (other_board_id, other_user_id, timestamp, timestamp),
            )
            connection.execute(
                """
                    INSERT INTO board_columns
                        (id, board_id, title, position, created_at, updated_at)
                    VALUES (?, ?, 'Private', 0, ?, ?)
                    """,
                (other_column_id, other_board_id, timestamp, timestamp),
            )
            connection.execute(
                """
                    INSERT INTO cards
                        (id, column_id, title, details, position,
                         created_at, updated_at)
                    VALUES (?, ?, 'Private card', '', 0, ?, ?)
                    """,
                (other_card_id, other_column_id, timestamp, timestamp),
            )
            connection.execute(
                """
                INSERT INTO boards
                    (id, user_id, title, created_at, updated_at)
                VALUES (?, ?, 'Second board', ?, ?)
                """,
                (same_user_board_id, primary_user_id, timestamp, timestamp),
            )
            connection.execute(
                """
                INSERT INTO board_columns
                    (id, board_id, title, position, created_at, updated_at)
                VALUES (?, ?, 'Second board column', 0, ?, ?)
                """,
                (same_user_column_id, same_user_board_id, timestamp, timestamp),
            )

        await login(client)
        owned_board = (await client.get("/api/board")).json()
        owned_card_id = owned_board["columns"][0]["cards"][0]["id"]
        response = await client.patch(
            f"/api/board/cards/{other_card_id}",
            json={"title": "Unauthorized change"},
        )
        assert response.status_code == 404
        cross_board_move = await client.post(
            f"/api/board/cards/{owned_card_id}/move",
            json={
                "target_column_id": same_user_column_id,
                "target_position": 0,
            },
        )
        assert cross_board_move.status_code == 400

        with closing(
            connect_database(application.state.settings.database_path)
        ) as connection:
            title = connection.execute(
                "SELECT title FROM cards WHERE id = ?",
                (other_card_id,),
            ).fetchone()["title"]
            owned_column_id = connection.execute(
                "SELECT column_id FROM cards WHERE id = ?",
                (owned_card_id,),
            ).fetchone()["column_id"]
        assert title == "Private card"
        assert owned_column_id == owned_board["columns"][0]["id"]


def test_board_api_enforces_user_ownership(tmp_path: Path) -> None:
    asyncio.run(ownership_check(tmp_path))
