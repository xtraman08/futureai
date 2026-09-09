import secrets
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Session:
    username: str
    expires_at: float


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[str, Session] = {}

    def create(self, username: str) -> str:
        token = secrets.token_urlsafe(32)
        self._sessions[token] = Session(
            username=username,
            expires_at=time.monotonic() + self._ttl_seconds,
        )
        return token

    def resolve(self, token: str | None) -> str | None:
        if not token:
            return None

        session = self._sessions.get(token)
        if not session:
            return None

        if session.expires_at <= time.monotonic():
            self._sessions.pop(token, None)
            return None

        return session.username

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)
