from app.board_models import BoardResponse
from app.board_repository import BoardRepository, InvalidBoardOperationError


class BoardService:
    def __init__(self, repository: BoardRepository) -> None:
        self._repository = repository

    def get_board(self, username: str) -> BoardResponse:
        return self._repository.get_board(username)

    def rename_column(
        self,
        username: str,
        column_id: str,
        title: str,
    ) -> BoardResponse:
        return self._repository.rename_column(
            username,
            column_id,
            self._required_text(title, "Column title"),
        )

    def create_card(
        self,
        username: str,
        column_id: str,
        title: str,
        details: str,
    ) -> BoardResponse:
        return self._repository.create_card(
            username,
            column_id,
            self._required_text(title, "Card title"),
            details.strip(),
        )

    def update_card(
        self,
        username: str,
        card_id: str,
        title: str | None,
        details: str | None,
    ) -> BoardResponse:
        clean_title = (
            self._required_text(title, "Card title")
            if title is not None
            else None
        )
        clean_details = details.strip() if details is not None else None
        return self._repository.update_card(
            username,
            card_id,
            clean_title,
            clean_details,
        )

    def delete_card(self, username: str, card_id: str) -> BoardResponse:
        return self._repository.delete_card(username, card_id)

    def move_card(
        self,
        username: str,
        card_id: str,
        target_column_id: str,
        target_position: int,
    ) -> BoardResponse:
        return self._repository.move_card(
            username,
            card_id,
            target_column_id,
            target_position,
        )

    @staticmethod
    def _required_text(value: str, field_name: str) -> str:
        clean_value = value.strip()
        if not clean_value:
            raise InvalidBoardOperationError(f"{field_name} cannot be empty")
        return clean_value
