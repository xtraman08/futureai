import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

SESSION_COOKIE = "pm_session"

router = APIRouter(prefix="/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class SessionResponse(BaseModel):
    authenticated: bool = True
    username: str


def require_user(request: Request) -> str:
    username = request.app.state.sessions.resolve(
        request.cookies.get(SESSION_COOKIE)
    )
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return username


@router.post("/login", response_model=SessionResponse)
async def login(
    credentials: LoginRequest,
    request: Request,
    response: Response,
) -> SessionResponse:
    settings = request.app.state.settings
    valid_username = secrets.compare_digest(
        credentials.username.encode("utf-8"),
        settings.mvp_username.encode("utf-8"),
    )
    valid_password = secrets.compare_digest(
        credentials.password.encode("utf-8"),
        settings.mvp_password.get_secret_value().encode("utf-8"),
    )
    if not valid_username or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = request.app.state.sessions.create(settings.mvp_username)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return SessionResponse(username=settings.mvp_username)


@router.get("/session", response_model=SessionResponse)
async def session(
    username: Annotated[str, Depends(require_user)],
) -> SessionResponse:
    return SessionResponse(username=username)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    settings = request.app.state.settings
    request.app.state.sessions.revoke(request.cookies.get(SESSION_COOKIE))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return response
