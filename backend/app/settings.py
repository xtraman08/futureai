from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Project Management MVP"
    app_version: str = "0.1.0"
    environment: str = "development"
    static_dir: Path = Path(__file__).resolve().parent.parent / "static"
    database_path: Path = (
        Path(__file__).resolve().parents[2]
        / "data"
        / "project_management.db"
    )
    mvp_username: str = "user"
    mvp_password: SecretStr = SecretStr("password")
    session_ttl_seconds: int = 8 * 60 * 60
    cookie_secure: bool = False
    openrouter_api_key: SecretStr | None = None

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
