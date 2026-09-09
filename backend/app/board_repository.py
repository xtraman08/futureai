import sqlite3
from contextlib import closing
from pathlib import Path

from app.board_models import BoardResponse, CardResponse, ColumnResponse
from app.database import connect_database, new_id, utc_now


class BoardNotFoundError(Exception):
    pass


class InvalidBoardOperationError(Exception):
    pass


class BoardRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def get_board(self, username: str) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            board = connection.execute(
                """
                SELECT boards.id, boards.title, boards.version
                FROM boards
                JOIN users ON users.id = boards.user_id
                WHERE users.username = ?
                ORDER BY boards.created_at, boards.id
                LIMIT 1
                """,
                (username,),
            ).fetchone()
            if not board:
                raise BoardNotFoundError("Board not found")

            column_rows = connection.execute(
                """
                SELECT id, title, position
                FROM board_columns
                WHERE board_id = ?
                ORDER BY position, id
                """,
                (board["id"],),
            ).fetchall()
            card_rows = connection.execute(
                """
                SELECT cards.id, cards.column_id, cards.title,
                       cards.details, cards.position
                FROM cards
                JOIN board_columns ON board_columns.id = cards.column_id
                WHERE board_columns.board_id = ?
                ORDER BY board_columns.position, cards.position, cards.id
                """,
                (board["id"],),
            ).fetchall()

        cards_by_column: dict[str, list[CardResponse]] = {
            row["id"]: [] for row in column_rows
        }
        for row in card_rows:
            cards_by_column[row["column_id"]].append(
                CardResponse(
                    id=row["id"],
                    title=row["title"],
                    details=row["details"],
                    position=row["position"],
                )
            )

        return BoardResponse(
            id=board["id"],
            title=board["title"],
            version=board["version"],
            columns=[
                ColumnResponse(
                    id=row["id"],
                    title=row["title"],
                    position=row["position"],
                    cards=cards_by_column[row["id"]],
                )
                for row in column_rows
            ],
        )

    def rename_column(
        self,
        username: str,
        column_id: str,
        title: str,
    ) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                column = self._owned_column(connection, username, column_id)
                timestamp = utc_now()
                connection.execute(
                    """
                    UPDATE board_columns
                    SET title = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (title, timestamp, column_id),
                )
                self._touch_board(connection, column["board_id"], timestamp)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.get_board(username)

    def create_card(
        self,
        username: str,
        column_id: str,
        title: str,
        details: str,
    ) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                column = self._owned_column(connection, username, column_id)
                position = connection.execute(
                    """
                    SELECT COALESCE(MAX(position) + 1, 0)
                    FROM cards
                    WHERE column_id = ?
                    """,
                    (column_id,),
                ).fetchone()[0]
                timestamp = utc_now()
                connection.execute(
                    """
                    INSERT INTO cards
                        (id, column_id, title, details, position,
                         created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id(),
                        column_id,
                        title,
                        details,
                        position,
                        timestamp,
                        timestamp,
                    ),
                )
                self._touch_board(connection, column["board_id"], timestamp)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.get_board(username)

    def update_card(
        self,
        username: str,
        card_id: str,
        title: str | None,
        details: str | None,
    ) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                card = self._owned_card(connection, username, card_id)
                next_title = title if title is not None else card["title"]
                next_details = details if details is not None else card["details"]
                timestamp = utc_now()
                connection.execute(
                    """
                    UPDATE cards
                    SET title = ?, details = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (next_title, next_details, timestamp, card_id),
                )
                self._touch_board(connection, card["board_id"], timestamp)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.get_board(username)

    def delete_card(self, username: str, card_id: str) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                card = self._owned_card(connection, username, card_id)
                remaining_ids = [
                    row["id"]
                    for row in connection.execute(
                        """
                        SELECT id FROM cards
                        WHERE column_id = ? AND id != ?
                        ORDER BY position, id
                        """,
                        (card["column_id"], card_id),
                    )
                ]
                connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
                timestamp = utc_now()
                self._reorder_cards(
                    connection,
                    card["column_id"],
                    remaining_ids,
                    timestamp,
                )
                self._touch_board(connection, card["board_id"], timestamp)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.get_board(username)

    def move_card(
        self,
        username: str,
        card_id: str,
        target_column_id: str,
        target_position: int,
    ) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                card = self._owned_card(connection, username, card_id)
                target_column = self._owned_column(
                    connection,
                    username,
                    target_column_id,
                )
                if card["board_id"] != target_column["board_id"]:
                    raise InvalidBoardOperationError(
                        "Cards cannot move between boards"
                    )

                source_column_id = card["column_id"]
                source_ids = self._card_ids(connection, source_column_id)
                source_ids.remove(card_id)

                if source_column_id == target_column_id:
                    next_position = min(target_position, len(source_ids))
                    source_ids.insert(next_position, card_id)
                    timestamp = utc_now()
                    self._reorder_cards(
                        connection,
                        source_column_id,
                        source_ids,
                        timestamp,
                    )
                else:
                    target_ids = self._card_ids(connection, target_column_id)
                    next_position = min(target_position, len(target_ids))
                    target_ids.insert(next_position, card_id)
                    temporary_position = (
                        len(source_ids) + len(target_ids) + 1_000_000
                    )
                    connection.execute(
                        """
                        UPDATE cards
                        SET position = ?, column_id = ?
                        WHERE id = ?
                        """,
                        (temporary_position, target_column_id, card_id),
                    )
                    timestamp = utc_now()
                    self._reorder_cards(
                        connection,
                        source_column_id,
                        source_ids,
                        timestamp,
                    )
                    self._reorder_cards(
                        connection,
                        target_column_id,
                        target_ids,
                        timestamp,
                    )

                self._touch_board(connection, card["board_id"], timestamp)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.get_board(username)

    @staticmethod
    def _owned_column(
        connection: sqlite3.Connection,
        username: str,
        column_id: str,
    ) -> sqlite3.Row:
        column = connection.execute(
            """
            SELECT board_columns.*, boards.id AS board_id
            FROM board_columns
            JOIN boards ON boards.id = board_columns.board_id
            JOIN users ON users.id = boards.user_id
            WHERE board_columns.id = ? AND users.username = ?
            """,
            (column_id, username),
        ).fetchone()
        if not column:
            raise BoardNotFoundError("Column not found")
        return column

    @staticmethod
    def _owned_card(
        connection: sqlite3.Connection,
        username: str,
        card_id: str,
    ) -> sqlite3.Row:
        card = connection.execute(
            """
            SELECT cards.*, boards.id AS board_id
            FROM cards
            JOIN board_columns ON board_columns.id = cards.column_id
            JOIN boards ON boards.id = board_columns.board_id
            JOIN users ON users.id = boards.user_id
            WHERE cards.id = ? AND users.username = ?
            """,
            (card_id, username),
        ).fetchone()
        if not card:
            raise BoardNotFoundError("Card not found")
        return card

    @staticmethod
    def _card_ids(
        connection: sqlite3.Connection,
        column_id: str,
    ) -> list[str]:
        return [
            row["id"]
            for row in connection.execute(
                """
                SELECT id FROM cards
                WHERE column_id = ?
                ORDER BY position, id
                """,
                (column_id,),
            )
        ]

    @staticmethod
    def _reorder_cards(
        connection: sqlite3.Connection,
        column_id: str,
        card_ids: list[str],
        timestamp: str,
    ) -> None:
        if not card_ids:
            return

        max_position = connection.execute(
            "SELECT COALESCE(MAX(position), 0) FROM cards WHERE column_id = ?",
            (column_id,),
        ).fetchone()[0]
        offset = max_position + len(card_ids) + 1
        connection.execute(
            """
            UPDATE cards
            SET position = position + ?
            WHERE column_id = ?
            """,
            (offset, column_id),
        )
        for position, card_id in enumerate(card_ids):
            connection.execute(
                """
                UPDATE cards
                SET position = ?, updated_at = ?
                WHERE id = ?
                """,
                (position, timestamp, card_id),
            )

    @staticmethod
    def _touch_board(
        connection: sqlite3.Connection,
        board_id: str,
        timestamp: str,
    ) -> None:
        connection.execute(
            """
            UPDATE boards
            SET version = version + 1, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, board_id),
        )
