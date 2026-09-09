from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import require_user
from app.board_models import BoardResponse
from app.board_repository import (
    BoardNotFoundError,
    BoardRepository,
    InvalidBoardOperationError,
)
from app.chat_models import ChatHistoryResponse, ChatRequest, ChatResponse
from app.chat_repository import (
    ChatRepository,
    InvalidProposalStateError,
    ProposalNotFoundError,
    StaleProposalError,
)
from app.chat_service import ChatService, InvalidAiResponseError
from app.openrouter import OpenRouterClient, OpenRouterError

router = APIRouter(tags=["chat"])

AuthenticatedUser = Annotated[str, Depends(require_user)]


def get_openrouter_client(request: Request) -> OpenRouterClient:
    api_key = request.app.state.settings.openrouter_api_key
    if api_key is None or not api_key.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service is not configured",
        )
    return OpenRouterClient(api_key.get_secret_value())


OpenRouterClientDependency = Annotated[
    OpenRouterClient,
    Depends(get_openrouter_client),
]


def get_chat_repository(request: Request) -> ChatRepository:
    return ChatRepository(request.app.state.settings.database_path)


ChatRepositoryDependency = Annotated[
    ChatRepository,
    Depends(get_chat_repository),
]


def get_chat_service(
    request: Request,
    client: OpenRouterClientDependency,
    chat_repository: ChatRepositoryDependency,
) -> ChatService:
    database_path = request.app.state.settings.database_path
    return ChatService(
        BoardRepository(database_path),
        chat_repository,
        client,
    )


ChatServiceDependency = Annotated[ChatService, Depends(get_chat_service)]


@router.get("/chat", response_model=ChatHistoryResponse)
def get_chat_history(
    username: AuthenticatedUser,
    repository: ChatRepositoryDependency,
) -> ChatHistoryResponse:
    try:
        return ChatHistoryResponse(messages=repository.list_messages(username))
    except BoardNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    username: AuthenticatedUser,
    service: ChatServiceDependency,
) -> ChatResponse:
    try:
        return await service.respond(username, payload.message)
    except OpenRouterError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
        ) from error
    except BoardNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    except InvalidAiResponseError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI service returned invalid board changes",
        ) from error


@router.post(
    "/chat/proposals/{proposal_id}/confirm",
    response_model=BoardResponse,
)
def confirm_proposal(
    proposal_id: UUID,
    username: AuthenticatedUser,
    repository: ChatRepositoryDependency,
) -> BoardResponse:
    try:
        return repository.confirm_proposal(username, str(proposal_id))
    except (ProposalNotFoundError, BoardNotFoundError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    except (
        InvalidProposalStateError,
        StaleProposalError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    except InvalidBoardOperationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post(
    "/chat/proposals/{proposal_id}/reject",
    status_code=status.HTTP_204_NO_CONTENT,
)
def reject_proposal(
    proposal_id: UUID,
    username: AuthenticatedUser,
    repository: ChatRepositoryDependency,
) -> Response:
    try:
        repository.reject_proposal(username, str(proposal_id))
    except (ProposalNotFoundError, BoardNotFoundError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    except InvalidProposalStateError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)
