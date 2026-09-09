# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Existing guidance

Read these first; this file only covers what they do not:

- `AGENTS.md` (root) - business requirements, MVP limitations, coding standards, palette
- `backend/AGENTS.md` - module-by-module backend map and conventions
- `frontend/AGENTS.md` - component map, supported board behavior, testing rules
- `docs/PLAN.md` - implementation plan and current status
- `docs/DATABASE.md` and `docs/database-schema.json` - schema contract
- `docs/API.md` - route list with curl examples

## Commands

Backend, from `backend/`:

```bash
uv sync --all-groups
uv run ruff check .
uv run pytest
uv run pytest tests/test_chat.py::test_name    # single test
uv run uvicorn app.main:app --reload           # API only, see "Dev vs Docker"
```

Frontend, from `frontend/`:

```bash
npm ci
npm run lint
npm run test:unit
npm run test:unit -- src/lib/kanban.test.ts    # single file
npm run build
npm run test:e2e
npm run test:e2e -- -g "renames a column"      # single e2e test
```

Whole app, from the project root:

```powershell
.\scripts\start.ps1    # build and run the container
.\scripts\stop.ps1     # stop, preserving the pm-data volume
```

`pytest` always collects coverage (`addopts` in `pyproject.toml`); `npm run test:unit` is `vitest run --coverage`.

## Dev vs Docker

There is no dev-mode integration between the two halves. `backend/static/` contains only
`.gitkeep` in the repo; the Docker frontend stage builds the Next.js static export and copies
`frontend/out` into it. So `uv run uvicorn` locally serves the API without a frontend, and
`npm run dev` serves the UI without an API. Anything touching both ends needs the container.

`playwright.config.ts` has no `webServer`. E2E tests assume something is already listening on
`http://127.0.0.1:8000` (override with `E2E_BASE_URL`) - start the container first or they all fail.

Configuration lives in one `.env` at the project root. `Settings` loads it via
`parents[2]` from `app/settings.py`, and `compose.yaml` passes the same file to the container.

## Architecture

FastAPI is the single source of truth for authentication, board state, chat history, and AI
operations. The frontend is a pure static export with no server-side behavior of its own.

**Whole-board reconciliation.** Every board mutation endpoint returns the complete
`BoardResponse`, not a patch. `KanbanBoard` replaces its state with that response rather than
merging, which is how a failed write self-corrects the optimistic UI. Keep this contract when
adding endpoints.

**`boards.version` is the concurrency spine.** Every mutation increments it via
`_touch_board`. `ChatRepository.save_exchange` records the version the AI saw as the proposal's
`base_board_version`, and `confirm_proposal` rejects with 409 if the board moved since. Any new
mutation path must increment the version or it will silently let stale proposals apply.

**The AI proposes, it never writes.** `POST /api/chat` sends the board JSON plus bounded history
to OpenRouter with a strict JSON schema derived from `AiBoardResponse`, validates the returned
operations against real column and card IDs (`chat_service.validate_operations`, which also
rejects conflicting operations on one card), and persists them as a *pending* proposal. The board
only changes at `POST /api/chat/proposals/{id}/confirm`, which applies every operation in a single
transaction. Preserve this preview-then-confirm split.

**Card ordering.** Positions are contiguous and zero-based, unique per `(column_id, position)`.
Reordering moves affected rows to temporary high positions first to dodge transient uniqueness
conflicts. Read `_reorder_cards` before changing anything order-related.

**Ownership.** Every lookup starts from the authenticated username and joins through
`users.id -> boards.user_id`. Client-supplied IDs are never trusted as ownership evidence. The
schema supports multiple users and boards; the API deliberately exposes only the first board.

**Sessions are in-process.** `SessionStore` is a plain dict on `app.state`, so a container
restart invalidates every login. That is intentional for the MVP.

### Known duplication

`chat_repository.py` carries its own copies of `_owned_column`, `_owned_card`, `_card_ids`,
`_reorder_cards`, and `_touch_board` because proposal confirmation applies all operations inside
one transaction it controls. A fix to ordering or ownership logic in `board_repository.py` almost
certainly needs mirroring in `chat_repository.py`. Check both.

## Constraints

- Do not add Next.js server actions, route handlers, middleware, or runtime rendering. `output: "export"` must keep working or the Docker build produces no frontend.
- Migrations in `backend/app/migrations/` are immutable and sequentially numbered. Add a new file; never edit a released one.
- Keep route handlers thin - domain logic belongs in the service and repository modules.
- The OpenRouter model is pinned to `openai/gpt-oss-120b` in `openrouter.py`. Never let the API key or provider error details reach the browser.
- Mock OpenRouter in the repeatable test suite; the real key is only for explicit smoke tests.
- No emojis, anywhere.
