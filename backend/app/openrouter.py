from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"

REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class OpenRouterError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _AssistantMessage(BaseModel):
    content: str


class _ErrorMetadata(BaseModel):
    error_type: str | None = None


class _ProviderError(BaseModel):
    code: int | str | None = None
    metadata: _ErrorMetadata | None = None


class _Choice(BaseModel):
    message: _AssistantMessage | None = None
    finish_reason: str | None = None
    error: _ProviderError | None = None


class _CompletionResponse(BaseModel):
    choices: list[_Choice]


def _mapped_error(
    provider_status: int,
    error_type: str | None = None,
) -> OpenRouterError:
    if provider_status == 401 or error_type == "authentication":
        return OpenRouterError(502, "AI service authentication failed")
    if provider_status == 402 or error_type == "payment_required":
        return OpenRouterError(503, "AI service has insufficient credits")
    if provider_status == 429 or error_type == "rate_limit_exceeded":
        return OpenRouterError(429, "AI service rate limit reached")
    if provider_status in {408, 504} or error_type == "timeout":
        return OpenRouterError(504, "AI service timed out")
    return OpenRouterError(502, "AI service is unavailable")


def _error_type(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not isinstance(error, dict):
        return None
    metadata = error.get("metadata")
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("error_type")
    return value if isinstance(value, str) else None


class OpenRouterClient:
    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._transport = transport

    async def chat(self, message: str) -> str:
        return await self.complete(
            [{"role": "user", "content": message}],
            max_tokens=512,
        )

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        response_format: dict[str, Any] | None = None,
        max_tokens: int = 2048,
    ) -> str:
        body: dict[str, Any] = {
            "model": OPENROUTER_MODEL,
            "messages": messages,
            "reasoning": {"effort": "low"},
            "max_tokens": max_tokens,
        }
        if response_format is not None:
            body["response_format"] = response_format

        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    OPENROUTER_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
        except httpx.TimeoutException as error:
            raise OpenRouterError(504, "AI service timed out") from error
        except httpx.RequestError as error:
            raise OpenRouterError(502, "AI service is unavailable") from error

        try:
            payload = response.json()
        except ValueError as error:
            if response.is_error:
                raise _mapped_error(response.status_code) from error
            raise OpenRouterError(
                502,
                "AI service returned an invalid response",
            ) from error

        if response.is_error:
            raise _mapped_error(response.status_code, _error_type(payload))

        try:
            completion = _CompletionResponse.model_validate(payload)
            choice = completion.choices[0]
        except (ValidationError, IndexError) as error:
            raise OpenRouterError(
                502,
                "AI service returned an invalid response",
            ) from error

        if choice.finish_reason == "error":
            provider_error = choice.error
            provider_status = (
                provider_error.code
                if provider_error and isinstance(provider_error.code, int)
                else 502
            )
            error_type = (
                provider_error.metadata.error_type
                if provider_error and provider_error.metadata
                else None
            )
            raise _mapped_error(provider_status, error_type)

        answer = choice.message.content.strip() if choice.message else ""
        if not answer:
            raise OpenRouterError(
                502,
                "AI service returned an invalid response",
            )
        return answer
