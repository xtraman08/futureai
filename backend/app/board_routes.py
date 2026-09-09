from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth import require_user
from app.board_models import (
    BoardResponse,
    CreateCardRequest,
    MoveCardRequest,
    RenameColumnRequest,
    UpdateCardRequest,
)
from app.board_repository import (
    BoardNotFoundError,
    BoardRepository,
    InvalidBoardOperationError,
)
from app.board_service import BoardService

router = APIRouter(prefix="/board", tags=["board"])

AuthenticatedUser = Annotated[str, Depends(require_user)]


def get_board_service(request: Request) -> BoardService:
    return BoardService(BoardRepository(request.app.state.settings.database_path))


BoardServiceDependency = Annotated[BoardService, Depends(get_board_service)]


def execute(action: Callable[[], BoardResponse]) -> BoardResponse:
    try:
        return action()
    except BoardNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    except InvalidBoardOperationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.get("", response_model=BoardResponse)
def get_board(
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(lambda: service.get_board(username))


@router.patch("/columns/{column_id}", response_model=BoardResponse)
def rename_column(
    column_id: UUID,
    payload: RenameColumnRequest,
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(
        lambda: service.rename_column(username, str(column_id), payload.title)
    )


@router.post("/cards", response_model=BoardResponse)
def create_card(
    payload: CreateCardRequest,
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(
        lambda: service.create_card(
            username,
            str(payload.column_id),
            payload.title,
            payload.details,
        )
    )


@router.patch("/cards/{card_id}", response_model=BoardResponse)
def update_card(
    card_id: UUID,
    payload: UpdateCardRequest,
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(
        lambda: service.update_card(
            username,
            str(card_id),
            payload.title,
            payload.details,
        )
    )


@router.delete("/cards/{card_id}", response_model=BoardResponse)
def delete_card(
    card_id: UUID,
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(lambda: service.delete_card(username, str(card_id)))


@router.post("/cards/{card_id}/move", response_model=BoardResponse)
def move_card(
    card_id: UUID,
    payload: MoveCardRequest,
    username: AuthenticatedUser,
    service: BoardServiceDependency,
) -> BoardResponse:
    return execute(
        lambda: service.move_card(
            username,
            str(card_id),
            str(payload.target_column_id),
            payload.target_position,
        )
    )
