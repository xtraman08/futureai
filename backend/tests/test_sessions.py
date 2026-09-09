from unittest.mock import patch

from app.sessions import SessionStore


def test_session_lifecycle() -> None:
    store = SessionStore(ttl_seconds=60)

    with (
        patch("app.sessions.secrets.token_urlsafe", return_value="token"),
        patch("app.sessions.time.monotonic", return_value=100.0),
    ):
        token = store.create("user")
        assert token == "token"
        assert store.resolve(token) == "user"

    store.revoke(token)
    assert store.resolve(token) is None


def test_missing_sessions_are_not_authenticated() -> None:
    store = SessionStore(ttl_seconds=60)

    assert store.resolve(None) is None
    assert store.resolve("missing") is None
    store.revoke(None)


def test_expired_session_is_removed() -> None:
    store = SessionStore(ttl_seconds=10)

    with (
        patch("app.sessions.secrets.token_urlsafe", return_value="expired-token"),
        patch("app.sessions.time.monotonic", side_effect=[100.0, 111.0]),
    ):
        token = store.create("user")
        assert store.resolve(token) is None

    assert store.resolve(token) is None
