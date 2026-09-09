# Backend guidance

## Purpose and stack

This directory contains the FastAPI service for the Project Management MVP.
Python dependencies and the lockfile are managed with `uv`. The service is the
runtime entry point for API routes and static frontend delivery.

Current structure:

- `app/main.py` creates the FastAPI application, registers `/api` routes, and
  mounts the static site at `/`.
- `app/auth.py` implements login, session lookup, logout, and the reusable
  `require_user` dependency for protected APIs.
- `app/board_routes.py` exposes the authenticated persistent board API.
- `app/chat_routes.py` exposes authenticated chat and proposal-confirmation APIs.
- `app/chat_models.py` defines strict AI operation and chat API contracts.
- `app/chat_repository.py` persists board-scoped history and atomically confirms
  still-current proposals.
- `app/chat_service.py` builds grounded prompts, bounds history, parses
  structured model output, and validates proposed operations.
- `app/openrouter.py` owns OpenRouter request construction, response parsing,
  timeouts, and user-safe provider error mapping.
- `app/board_service.py` validates reusable board operations.
- `app/board_repository.py` owns SQLite queries and transaction boundaries.
- `app/board_models.py` defines board API request and response models.
- `app/database.py` applies migrations and seeds first-run MVP data.
- `app/migrations/` contains immutable, sequential SQL migrations.
- `app/sessions.py` stores opaque, expiring MVP sessions in server memory.
- `app/routes.py` contains the `/api/health` route.
- `app/settings.py` loads typed server settings.
- `static/` is the local static mount point. In Docker, the frontend build stage
  copies the generated Next.js `out/` directory here.
- `tests/` contains unit and API integration tests.
- `pyproject.toml` defines runtime/development dependencies and test tooling.
- `uv.lock` makes installs reproducible.

## Commands

Run commands from `backend/`:

```bash
uv sync --all-groups
uv run uvicorn app.main:app --reload
uv run ruff check .
uv run pytest
```

## Conventions

- Use an application factory so tests can supply isolated settings.
- Put API routes under `/api`; the root path is reserved for the frontend.
- Keep route handlers thin. Database and AI logic belongs in focused
  repository/service modules.
- Use Pydantic models for request, response, and settings validation.
- Keep secrets in environment variables and never return or log them.
- Use temporary real SQLite databases in integration tests.
- Keep board mutations transactional, increment `boards.version`, and scope
  every lookup through the authenticated owner.
- Preserve contiguous, zero-based card positions. Use temporary high positions
  while reordering to avoid transient uniqueness conflicts.
- Add new numbered migration files; never edit a migration after release.
- Collect coverage and use 80% as a target when valuable behavior tests reach it
  naturally. Do not add low-value tests solely to increase a metric.
- Keep implementations simple, typed, and focused on approved plan parts.
- Use current idiomatic APIs, concise documentation, and no emojis.