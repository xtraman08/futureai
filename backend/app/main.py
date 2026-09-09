from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.auth import router as auth_router
from app.board_routes import router as board_router
from app.chat_routes import router as chat_router
from app.database import initialize_database
from app.routes import router
from app.sessions import SessionStore
from app.settings import Settings, get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = app.state.settings
    initialize_database(settings.database_path, settings.mvp_username)
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or get_settings()
    app = FastAPI(
        title=active_settings.app_name,
        version=active_settings.app_version,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = active_settings
    app.state.sessions = SessionStore(active_settings.session_ttl_seconds)
    app.include_router(router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(board_router, prefix="/api")
    app.include_router(chat_router, prefix="/api")
    app.mount(
        "/",
        StaticFiles(directory=active_settings.static_dir, html=True),
        name="frontend",
    )
    return app


app = create_app()
