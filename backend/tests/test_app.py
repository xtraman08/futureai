import asyncio
from pathlib import Path

import httpx
from fastapi import FastAPI

from app.main import app, create_app
from app.settings import Settings, get_settings


async def get(application: FastAPI, path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        return await client.get(path)


def test_default_settings_point_to_static_directory() -> None:
    settings = get_settings()

    assert settings.app_name == "Project Management MVP"
    assert settings.app_version == "0.1.0"
    assert settings.environment == "development"
    assert settings.static_dir.is_dir()
    assert get_settings() is settings


def test_application_factory_uses_supplied_settings(tmp_path: Path) -> None:
    asset_dir = tmp_path / "_next" / "static"
    asset_dir.mkdir(parents=True)
    (tmp_path / "index.html").write_text(
        '<h1>Kanban Studio</h1><script src="/_next/static/app.js"></script>',
        encoding="utf-8",
    )
    (asset_dir / "app.js").write_text("window.kanban = true;", encoding="utf-8")
    settings = Settings(
        app_name="Test App",
        app_version="9.9.9",
        static_dir=tmp_path,
    )

    test_app = create_app(settings)

    assert test_app.title == "Test App"
    assert test_app.version == "9.9.9"
    assert test_app.state.settings is settings
    root_response = asyncio.run(get(test_app, "/"))
    asset_response = asyncio.run(get(test_app, "/_next/static/app.js"))
    assert "Kanban Studio" in root_response.text
    assert asset_response.text == "window.kanban = true;"
    assert asset_response.headers["content-type"].startswith("text/javascript")


def test_health_endpoint_reports_service_status() -> None:
    response = asyncio.run(get(app, "/api/health"))

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Project Management MVP",
        "version": "0.1.0",
    }


def test_root_is_not_faked_when_static_export_is_absent() -> None:
    response = asyncio.run(get(app, "/"))

    assert response.status_code == 404


def test_missing_static_path_returns_not_found() -> None:
    response = asyncio.run(get(app, "/missing"))

    assert response.status_code == 404
