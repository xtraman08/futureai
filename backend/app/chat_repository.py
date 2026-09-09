import sqlite3
from contextlib import closing
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.board_models import BoardResponse
from app.board_repository import (
    BoardNotFoundError,
    BoardRepository,
    InvalidBoardOperationError,
)
from app.chat_models import (
    BoardOperation,
    ChatHistoryMessage,
    CreateCardOperation,
    DeleteCardOperation,
    EditCardOperation,
    MoveCardOperation,
    ProposalResponse,
    RenameColumnOperation,
    StoredChatMessageResponse,
)
from app.database import connect_database, new_id, utc_now

OPERATIONS_ADAPTER = TypeAdapter(list[BoardOperation])


class ProposalNotFoundError(Exception):
    pass


class InvalidProposalStateError(Exception):
    pass


class StaleProposalError(Exception):
    pass


class ChatRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def get_history(
        self,
        username: str,
        limit: int = 20,
    ) -> list[ChatHistoryMessage]:
        with closing(connect_database(self._database_path)) as connection:
            board = self._owned_board(connection, username)
            rows = connection.execute(
                """
                SELECT role, content
                FROM chat_messages
                WHERE board_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (board["id"], limit),
            ).fetchall()
        return [
            ChatHistoryMessage(role=row["role"], content=row["content"])
            for row in reversed(rows)
        ]

    def list_messages(
        self,
        username: str,
        limit: int = 100,
    ) -> list[StoredChatMessageResponse]:
        with closing(connect_database(self._database_path)) as connection:
            board = self._owned_board(connection, username)
            rows = connection.execute(
                """
                SELECT id, role, content, proposed_operations_json,
                       proposal_status, base_board_version, created_at
                FROM chat_messages
                WHERE board_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (board["id"], limit),
            ).fetchall()

        messages: list[StoredChatMessageResponse] = []
        for row in reversed(rows):
            proposal = None
            if row["proposed_operations_json"] is not None:
                proposal = ProposalResponse(
                    id=row["id"],
                    status=row["proposal_status"],
                    base_board_version=row["base_board_version"],
                    operations=OPERATIONS_ADAPTER.validate_json(
                        row["proposed_operations_json"]
                    ),
                )
            messages.append(
                StoredChatMessageResponse(
                    id=row["id"],
                    role=row["role"],
                    content=row["content"],
                    created_at=row["created_at"],
                    proposal=proposal,
                )
            )
        return messages

    def save_exchange(
        self,
        username: str,
        user_message: str,
        assistant_message: str,
        operations: list[BoardOperation],
        base_board_version: int,
    ) -> tuple[str, bool]:
        """Persist a chat exchange and report whether the board moved.

        Both messages are always persisted, even if the board changed while
        the assistant reply was generated - discarding a paid-for model
        response and the user's own question is worse than showing a
        proposal that is immediately marked stale. Returns the assistant
        message id and whether ``base_board_version`` is now out of date.
        """
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                board = self._owned_board(connection, username)
                board_changed = board["version"] != base_board_version

                user_message_id = new_id()
                assistant_message_id = new_id()
                connection.execute(
                    """
                    INSERT INTO chat_messages
                        (id, board_id, role, content, created_at)
                    VALUES (?, ?, 'user', ?, ?)
                    """,
                    (user_message_id, board["id"], user_message, utc_now()),
                )

                proposed_operations_json = (
                    OPERATIONS_ADAPTER.dump_json(operations).decode()
                    if operations
                    else None
                )
                proposal_status = None
                proposal_version = None
                if operations:
                    proposal_status = "stale" if board_changed else "pending"
                    proposal_version = base_board_version
                connection.execute(
                    """
                    INSERT INTO chat_messages
                        (id, board_id, role, content,
                         proposed_operations_json, proposal_status,
                         base_board_version, created_at)
                    VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
                    """,
                    (
                        assistant_message_id,
                        board["id"],
                        assistant_message,
                        proposed_operations_json,
                        proposal_status,
                        proposal_version,
                        utc_now(),
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return assistant_message_id, board_changed

    def confirm_proposal(
        self,
        username: str,
        proposal_id: str,
    ) -> BoardResponse:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute(
                """
                SELECT chat_messages.proposed_operations_json,
                       chat_messages.proposal_status,
                       chat_messages.base_board_version,
                       boards.id AS board_id,
                       boards.version AS board_version
                FROM chat_messages
                JOIN boards ON boards.id = chat_messages.board_id
                JOIN users ON users.id = boards.user_id
                WHERE chat_messages.id = ? AND users.username = ?
                """,
                (proposal_id, username),
            ).fetchone()
            if not proposal:
                connection.rollback()
                raise ProposalNotFoundError("Proposal not found")
            if proposal["proposal_status"] != "pending":
                connection.rollback()
                raise InvalidProposalStateError("Proposal is not pending")
            if proposal["board_version"] != proposal["base_board_version"]:
                connection.execute(
                    """
                    UPDATE chat_messages
                    SET proposal_status = 'stale'
                    WHERE id = ?
                    """,
                    (proposal_id,),
                )
                connection.commit()
                raise StaleProposalError("Proposal is stale")

            try:
                operations = OPERATIONS_ADAPTER.validate_json(
                    proposal["proposed_operations_json"]
                )
            except ValidationError as error:
                connection.rollback()
                raise InvalidProposalStateError(
                    "Proposal contains invalid operations"
                ) from error

            try:
                timestamp = utc_now()
                for operation in operations:
                    self._apply_operation(
                        connection,
                        username,
                        operation,
                        timestamp,
                    )
                self._touch_board(connection, proposal["board_id"], timestamp)
                connection.execute(
                    """
                    UPDATE chat_messages
                    SET proposal_status = 'confirmed'
                    WHERE id = ?
                    """,
                    (proposal_id,),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return BoardRepository(self._database_path).get_board(username)

    def reject_proposal(
        self,
        username: str,
        proposal_id: str,
    ) -> None:
        with closing(connect_database(self._database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute(
                """
                SELECT chat_messages.proposal_status
                FROM chat_messages
                JOIN boards ON boards.id = chat_messages.board_id
                JOIN users ON users.id = boards.user_id
                WHERE chat_messages.id = ? AND users.username = ?
                """,
                (proposal_id, username),
            ).fetchone()
            if not proposal:
                connection.rollback()
                raise ProposalNotFoundError("Proposal not found")
            if proposal["proposal_status"] != "pending":
                connection.rollback()
                raise InvalidProposalStateError("Proposal is not pending")
            connection.execute(
                """
                UPDATE chat_messages
                SET proposal_status = 'rejected'
                WHERE id = ?
                """,
                (proposal_id,),
            )
            connection.commit()

    def _apply_operation(
        self,
        connection: sqlite3.Connection,
        username: str,
        operation: BoardOperation,
        timestamp: str,
    ) -> None:
        if isinstance(operation, RenameColumnOperation):
            column_id = str(operation.column_id)
            self._owned_column(connection, username, column_id)
            connection.execute(
                """
                UPDATE board_columns
                SET title = ?, updated_at = ?
                WHERE id = ?
                """,
                (operation.title, timestamp, column_id),
            )
            return

        if isinstance(operation, CreateCardOperation):
            column_id = str(operation.column_id)
            self._owned_column(connection, username, column_id)
            position = connection.execute(
                """
                SELECT COALESCE(MAX(position) + 1, 0)
                FROM cards
                WHERE column_id = ?
                """,
                (column_id,),
            ).fetchone()[0]
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
                    operation.title,
                    operation.details,
                    position,
                    timestamp,
                    timestamp,
                ),
            )
            return

        card_id = str(operation.card_id)
        card = self._owned_card(connection, username, card_id)

        if isinstance(operation, EditCardOperation):
            title = operation.title if operation.title is not None else card["title"]
            details = (
                operation.details
                if operation.details is not None
                else card["details"]
            )
            connection.execute(
                """
                UPDATE cards
                SET title = ?, details = ?, updated_at = ?
                WHERE id = ?
                """,
                (title, details, timestamp, card_id),
            )
            return

        if isinstance(operation, DeleteCardOperation):
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
            self._reorder_cards(
                connection,
                card["column_id"],
                remaining_ids,
                timestamp,
            )
            return

        if isinstance(operation, MoveCardOperation):
            target_column_id = str(operation.target_column_id)
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
                position = min(operation.target_position, len(source_ids))
                source_ids.insert(position, card_id)
                self._reorder_cards(
                    connection,
                    source_column_id,
                    source_ids,
                    timestamp,
                )
                return

            target_ids = self._card_ids(connection, target_column_id)
            position = min(operation.target_position, len(target_ids))
            target_ids.insert(position, card_id)
            temporary_position = len(source_ids) + len(target_ids) + 1_000_000
            connection.execute(
                """
                UPDATE cards
                SET position = ?, column_id = ?
                WHERE id = ?
                """,
                (temporary_position, target_column_id, card_id),
            )
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

    @staticmethod
    def _owned_board(
        connection: sqlite3.Connection,
        username: str,
    ) -> sqlite3.Row:
        board = connection.execute(
            """
            SELECT boards.id, boards.version
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
        return board

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
