import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.main import create_app
from app.settings import Settings


def make_app(static_dir: Path, *, cookie_secure: bool = False) -> FastAPI:
    return create_app(
        Settings(
            static_dir=static_dir,
            cookie_secure=cookie_secure,
        )
    )


async def auth_flow(application: FastAPI) -> None:
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        unauthenticated = await client.get("/api/auth/session")
        assert unauthenticated.status_code == 401

        login = await client.post(
            "/api/auth/login",
            json={"username": "user", "password": "password"},
        )
        assert login.status_code == 200
        assert login.json() == {"authenticated": True, "username": "user"}
        cookie = login.headers["set-cookie"]
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie
        assert "Path=/" in cookie

        session = await client.get("/api/auth/session")
        assert session.status_code == 200
        assert session.json() == {"authenticated": True, "username": "user"}

        logout = await client.post("/api/auth/logout")
        assert logout.status_code == 204
        assert "pm_session=" in logout.headers["set-cookie"]
        assert "Max-Age=0" in logout.headers["set-cookie"]

        after_logout = await client.get("/api/auth/session")
        assert after_logout.status_code == 401


def test_login_session_and_logout(tmp_path: Path) -> None:
    asyncio.run(auth_flow(make_app(tmp_path)))


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("unknown", "password"),
        ("user", "incorrect"),
    ],
)
def test_login_rejects_invalid_credentials(
    tmp_path: Path,
    username: str,
    password: str,
) -> None:
    async def attempt_login() -> httpx.Response:
        transport = httpx.ASGITransport(app=make_app(tmp_path))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.post(
                "/api/auth/login",
                json={"username": username, "password": password},
            )

    response = asyncio.run(attempt_login())

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("üser", "password"),
        ("user", "pässword"),
    ],
)
def test_login_rejects_non_ascii_credentials(
    tmp_path: Path,
    username: str,
    password: str,
) -> None:
    async def attempt_login() -> httpx.Response:
        transport = httpx.ASGITransport(app=make_app(tmp_path))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.post(
                "/api/auth/login",
                json={"username": username, "password": password},
            )

    response = asyncio.run(attempt_login())

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}
    assert "set-cookie" not in response.headers


def test_secure_cookie_can_be_enabled(tmp_path: Path) -> None:
    async def login() -> httpx.Response:
        transport = httpx.ASGITransport(app=make_app(tmp_path, cookie_secure=True))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://test",
        ) as client:
            return await client.post(
                "/api/auth/login",
                json={"username": "user", "password": "password"},
            )

    response = asyncio.run(login())

    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]
