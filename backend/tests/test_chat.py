import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from app.chat_routes import get_openrouter_client
from app.main import create_app
from app.openrouter import OPENROUTER_MODEL, OpenRouterClient, OpenRouterError
from app.settings import Settings


def completion_response(content: str = "4") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ]
        },
    )


def structured_completion_response(
    assistant_text: str,
    operations: list[dict] | None = None,
) -> httpx.Response:
    return completion_response(
        json.dumps(
            {
                "assistant_text": assistant_text,
                "operations": operations or [],
            }
        )
    )


def test_client_constructs_request_and_parses_answer() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == (
            "https://openrouter.ai/api/v1/chat/completions"
        )
        assert request.headers["Authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "user", "content": "2+2"}],
            "reasoning": {"effort": "low"},
            "max_tokens": 512,
        }
        return completion_response()

    client = OpenRouterClient("test-key", transport=httpx.MockTransport(handler))

    assert asyncio.run(client.chat("2+2")) == "4"


@pytest.mark.parametrize(
    ("provider_status", "error_type", "expected_status", "expected_detail"),
    [
        (401, "authentication", 502, "AI service authentication failed"),
        (402, "payment_required", 503, "AI service has insufficient credits"),
        (429, "rate_limit_exceeded", 429, "AI service rate limit reached"),
        (503, "provider_unavailable", 502, "AI service is unavailable"),
    ],
)
def test_client_maps_provider_errors(
    provider_status: int,
    error_type: str,
    expected_status: int,
    expected_detail: str,
) -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            provider_status,
            json={
                "error": {
                    "message": "Provider detail must not escape",
                    "metadata": {"error_type": error_type},
                }
            },
        )
    )
    client = OpenRouterClient("test-key", transport=transport)

    with pytest.raises(OpenRouterError) as raised:
        asyncio.run(client.chat("hello"))

    assert raised.value.status_code == expected_status
    assert raised.value.detail == expected_detail
    assert "Provider detail" not in str(raised.value)


def make_app(tmp_path: Path, *, configured: bool = True) -> FastAPI:
    return create_app(
        Settings(
            static_dir=tmp_path,
            database_path=tmp_path / "project_management.db",
            openrouter_api_key=SecretStr("test-key") if configured else None,
        )
    )


async def post_chat(
    application: FastAPI,
    *,
    login: bool = True,
    message: str = "2+2",
) -> httpx.Response:
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            if login:
                response = await client.post(
                    "/api/auth/login",
                    json={"username": "user", "password": "password"},
                )
                assert response.status_code == 200
            return await client.post("/api/chat", json={"message": message})


def test_chat_requires_authentication(tmp_path: Path) -> None:
    response = asyncio.run(post_chat(make_app(tmp_path), login=False))

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_chat_requires_provider_configuration(tmp_path: Path) -> None:
    response = asyncio.run(post_chat(make_app(tmp_path, configured=False)))

    assert response.status_code == 503
    assert response.json() == {"detail": "AI service is not configured"}


def test_chat_rejects_empty_messages(tmp_path: Path) -> None:
    response = asyncio.run(post_chat(make_app(tmp_path), message="   "))

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("case", "expected_status", "expected_detail"),
    [
        ("timeout", 504, "AI service timed out"),
        ("unauthorized", 502, "AI service authentication failed"),
        ("credit", 503, "AI service has insufficient credits"),
        ("rate_limit", 429, "AI service rate limit reached"),
        ("malformed", 502, "AI service returned an invalid response"),
    ],
)
def test_chat_maps_material_provider_failures(
    tmp_path: Path,
    case: str,
    expected_status: int,
    expected_detail: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if case == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        if case == "malformed":
            return httpx.Response(200, text="not json")
        statuses = {
            "unauthorized": 401,
            "credit": 402,
            "rate_limit": 429,
        }
        return httpx.Response(statuses[case], json={"error": {"message": case}})

    application = make_app(tmp_path)
    application.dependency_overrides[get_openrouter_client] = lambda: (
        OpenRouterClient("test-key", transport=httpx.MockTransport(handler))
    )

    response = asyncio.run(post_chat(application))

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def test_chat_returns_provider_answer(tmp_path: Path) -> None:
    application = make_app(tmp_path)
    application.dependency_overrides[get_openrouter_client] = lambda: (
        OpenRouterClient(
            "test-key",
            transport=httpx.MockTransport(
                lambda _request: structured_completion_response(
                    "The answer is 4."
                )
            ),
        )
    )

    response = asyncio.run(post_chat(application))

    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "The answer is 4."
    assert body["model"] == OPENROUTER_MODEL
    assert body["proposal"] is None
