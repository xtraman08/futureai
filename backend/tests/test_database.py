import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from app.board_repository import BoardRepository
from app.database import connect_database, initialize_database


def test_initialization_creates_migrates_and_seeds_database(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "nested" / "project_management.db"

    initialize_database(database_path, "user")

    assert database_path.is_file()
    with closing(connect_database(database_path)) as connection:
        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert {
            "schema_migrations",
            "users",
            "boards",
            "board_columns",
            "cards",
            "chat_messages",
        }.issubset(tables)
        assert connection.execute(
            "SELECT COUNT(*) FROM schema_migrations"
        ).fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM board_columns"
        ).fetchone()[0] == 5
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 8
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_initialization_is_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"

    initialize_database(database_path, "user")
    initialize_database(database_path, "user")

    with closing(connect_database(database_path)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 8


def test_foreign_key_cascade_removes_owned_board_data(tmp_path: Path) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")

    with closing(connect_database(database_path)) as connection:
        with connection:
            connection.execute("DELETE FROM users WHERE username = 'user'")

        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM board_columns"
        ).fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0


def test_board_mutation_rolls_back_when_transaction_fails(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "project_management.db"
    initialize_database(database_path, "user")
    repository = BoardRepository(database_path)
    board = repository.get_board("user")
    column = board.columns[0]

    with closing(connect_database(database_path)) as connection:
        connection.execute(
            """
            CREATE TRIGGER prevent_board_update
            BEFORE UPDATE ON boards
            BEGIN
                SELECT RAISE(ABORT, 'blocked for rollback test');
            END
            """
        )
        connection.commit()

    with pytest.raises(sqlite3.IntegrityError):
        repository.rename_column("user", column.id, "Should roll back")

    unchanged = repository.get_board("user")
    assert unchanged.columns[0].title == column.title
    assert unchanged.version == board.version
