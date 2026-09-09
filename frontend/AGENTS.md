# Frontend guidance

## Purpose

This directory contains the Kanban Studio frontend. It is statically exported
and served by FastAPI in the project Docker image.

The current app uses FastAPI authentication, the persistent board API, and the
board-scoped AI chat and proposal APIs.

## Stack and commands

- Next.js 16 App Router, React 19, and strict TypeScript
- Tailwind CSS v4 with `clsx`
- `@dnd-kit` for drag and drop
- Vitest, jsdom, and Testing Library for unit/integration tests
- Playwright with Chromium for end-to-end tests

Run commands from this directory:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test:unit
npm run test:e2e
npm run test:all
```

## Architecture

- `src/app/page.tsx` renders the single `/` route and `KanbanBoard`.
- `src/app/layout.tsx` defines the root layout and fonts.
- `src/app/globals.css` contains Tailwind setup, theme variables, and global
  styling.
- `src/components/AuthGate.tsx` restores the server session and renders the
  login screen or authenticated board.
- `src/components/KanbanBoard.tsx` loads server board state, reconciles mutation
  responses, renders API states, and owns drag-and-drop orchestration.
- `src/components/ChatSidebar.tsx` restores conversation history, sends
  messages, previews proposed operations, and handles confirmation/rejection.
- `src/components/KanbanColumn.tsx` renders a droppable column and supports
  rename and card creation.
- `src/components/KanbanCard.tsx` renders a sortable, editable card and delete
  action.
- `src/components/KanbanCardPreview.tsx` renders the drag overlay.
- `src/components/NewCardForm.tsx` adds a card with required title and optional
  details.
- `src/lib/board-api.ts` validates backend payloads and contains all board HTTP
  access.
- `src/lib/chat-api.ts` validates chat, history, proposal, and confirmation
  payloads and contains all chat HTTP access.
- `src/lib/kanban.ts` contains normalized UI domain types and the pure
  `moveCard` function.
- `next.config.ts` enables static export to `out/`.
- `playwright.config.ts` runs against the Docker-served app on port 8000 by
  default or `E2E_BASE_URL` when set.
- `@/*` resolves to `src/*`.

Keep domain transformations in small pure functions under `src/lib/`. Keep
network access in a typed API client rather than directly inside presentation
components.

## Current board behavior

`KanbanBoard` owns the latest server-returned `BoardData`, composed of ordered
columns and a normalized card record. FastAPI seeds five fixed columns and
eight sample cards on first startup.

Supported:

- Rename columns
- Add, edit, and delete cards
- Reorder cards within a column
- Move cards between columns
- Drop a card onto another card or a column
- Sign in with the MVP credentials and sign out
- Persist all changes across refreshes and container restarts
- Display loading, empty, retry, saving, and failure states
- Restore AI conversation history and send text questions
- Preview, confirm, or reject AI-proposed board changes
- Refresh the board from the authoritative confirmation response

Not yet supported:

- Add or remove columns

Drag and drop uses `DndContext`, `closestCorners`, a `PointerSensor` with a
six-pixel activation distance, sortable cards, droppable columns, and a
`DragOverlay`.

## Styling

Use the existing project palette:

- Accent yellow: `#ecad0a`
- Primary blue: `#209dd7`
- Secondary purple: `#753991`
- Dark navy: `#032147`
- Gray text: `#888888`

The current UI uses Tailwind utilities, shared CSS variables, Space Grotesk for
display text, and Manrope for body text. Preserve the responsive layout and
existing visual language when adding board API states and AI chat.

## Testing requirements

- Unit and integration tests live beside source as `*.test.ts` or `*.test.tsx`.
- End-to-end tests live in `tests/`.
- Use existing `data-testid` conventions: `column-{id}` and `card-{id}`.
- Prefer accessible queries and retain ARIA labels for interactive controls.
- Mock HTTP at the frontend boundary for repeatable integration tests.
- Use Playwright against the complete Docker-served application for critical
  user journeys.
- Collect coverage and use 80% as a target when valuable behavior tests reach it
  naturally. Do not add low-value tests solely to increase a metric.
- Add robust integration coverage for authentication, API persistence, failed
  write reconciliation, AI proposal confirmation/rejection, and board refresh.

Before completing frontend work, run:

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

## Project constraints

- The production frontend must be a static export served by FastAPI. Do not add
  Next.js server actions, route handlers, middleware, or runtime-only rendering.
- FastAPI is the source of truth for authentication, board data, chat history,
  and AI operations.
- AI-generated board operations must be previewed and explicitly confirmed
  before persistence.
- Never expose `OPENROUTER_API_KEY` or other secrets to browser code.
- Keep the MVP simple and avoid unrelated features or abstractions.
- Use current idiomatic library APIs, concise documentation, and no emojis.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
