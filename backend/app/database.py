import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

SEED_COLUMNS = (
    "Backlog",
    "Discovery",
    "In Progress",
    "Review",
    "Done",
)

SEED_CARDS = (
    (
        "Backlog",
        "Align roadmap themes",
        "Draft quarterly themes with impact statements and metrics.",
    ),
    (
        "Backlog",
        "Gather customer signals",
        "Review support tags, sales notes, and churn feedback.",
    ),
    (
        "Discovery",
        "Prototype analytics view",
        "Sketch initial dashboard layout and key drill-downs.",
    ),
    (
        "In Progress",
        "Refine status language",
        "Standardize column labels and tone across the board.",
    ),
    (
        "In Progress",
        "Design card layout",
        "Add hierarchy and spacing for scanning dense lists.",
    ),
    (
        "Review",
        "QA micro-interactions",
        "Verify hover, focus, and loading states.",
    ),
    (
        "Done",
        "Ship marketing page",
        "Final copy approved and asset pack delivered.",
    ),
    (
        "Done",
        "Close onboarding sprint",
        "Document release notes and share internally.",
    ),
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid.uuid7())


def connect_database(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def apply_migrations(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    applied_versions = {
        row["version"]
        for row in connection.execute("SELECT version FROM schema_migrations")
    }

    for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = int(migration_path.name.split("_", maxsplit=1)[0])
        if version in applied_versions:
            continue

        name = migration_path.stem.replace("'", "''")
        applied_at = utc_now().replace("'", "''")
        script = migration_path.read_text(encoding="utf-8")
        try:
            connection.executescript(
                "BEGIN IMMEDIATE;\n"
                f"{script}\n"
                "INSERT INTO schema_migrations (version, name, applied_at) "
                f"VALUES ({version}, '{name}', '{applied_at}');\n"
                "COMMIT;"
            )
        except sqlite3.Error:
            connection.rollback()
            raise


def seed_mvp_data(connection: sqlite3.Connection, username: str) -> None:
    existing_user = connection.execute(
        "SELECT id FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if existing_user:
        return

    timestamp = utc_now()
    user_id = new_id()
    board_id = new_id()

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            """
            INSERT INTO users (id, username, password_hash, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            """,
            (user_id, username, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO boards (id, user_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (board_id, user_id, "Kanban Studio", timestamp, timestamp),
        )

        column_ids: dict[str, str] = {}
        for position, title in enumerate(SEED_COLUMNS):
            column_id = new_id()
            column_ids[title] = column_id
            connection.execute(
                """
                INSERT INTO board_columns
                    (id, board_id, title, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (column_id, board_id, title, position, timestamp, timestamp),
            )

        card_positions: dict[str, int] = {}
        for column_title, title, details in SEED_CARDS:
            position = card_positions.get(column_title, 0)
            connection.execute(
                """
                INSERT INTO cards
                    (id, column_id, title, details, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    column_ids[column_title],
                    title,
                    details,
                    position,
                    timestamp,
                    timestamp,
                ),
            )
            card_positions[column_title] = position + 1

        connection.commit()
    except sqlite3.Error:
        connection.rollback()
        raise


def initialize_database(database_path: Path, username: str) -> None:
    with closing(connect_database(database_path)) as connection:
        apply_migrations(connection)
        seed_mvp_data(connection, username)
