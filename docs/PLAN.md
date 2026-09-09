# Project Management MVP implementation plan

## Scope and quality gates

The MVP runs locally in one Docker container. FastAPI serves the statically
exported Next.js application at `/` and currently owns authentication,
persistence, and board APIs. SQLite stores users, boards, columns, and cards;
the schema already reserves chat-message storage. Parts 8 through 10 add the
OpenRouter and AI chat runtime.

Ongoing quality requirements for every implementation part:

- Keep changes limited to the stated MVP requirements.
- Add unit tests for domain logic and focused integration tests across real
  internal boundaries.
- Collect coverage for frontend and backend tests. Aim for 80% when it follows
  naturally from valuable behavior tests, but do not add low-value tests or
  block completion solely to reach a coverage percentage.
- Keep critical user journeys covered by Playwright end-to-end tests.
- Run linting, type checking, unit tests, integration tests, and the production
  build before completing each part.
- Use mocked OpenRouter responses in the repeatable test suite; use the real API
  key only for the explicit connectivity smoke test.
- Do not expose `.env`, credentials, prompts, or API keys to the browser, logs,
  Docker image, or test artifacts.

Approval checkpoints:

1. User approval of this plan before Part 2.
2. User approval of the database design in Part 5 before Part 6.

AI-generated board changes will be presented as a preview and require user
confirmation before they are persisted.

## Current status

Parts 1 through 10 are complete. The planned MVP implementation and final
hardening are complete.

Last updated: September 7, 2026, after Part 10 verification.

Completed-part checklists record the target delivered at that stage; later parts
supersede earlier placeholders such as the Part 2 example page and Part 3
in-memory board.

Latest verified baseline:

- Backend: 52 tests passing with 93% coverage.
- Frontend: 33 tests passing with 88% coverage.
- End to end: 12 Playwright tests passing against the Docker application,
  including chat, responsive layout, page refresh, and container restart.
- Production verification: the static Next.js export and FastAPI API ran
  together successfully in one healthy container at `http://127.0.0.1:8000`.
  The container is not required to remain running between implementation parts.
- The authenticated production `/api/chat` route reached OpenRouter and
  `openai/gpt-oss-120b` returned a schema-valid text-only answer to `2+2`.
- An isolated production smoke test created and confirmed a real AI card
  proposal, then verified the card, chat history, and confirmed status after a
  container restart before successfully logging out.

## Implemented design decisions

Runtime and authentication:

- The production runtime is one non-root Docker container. FastAPI serves the
  statically exported Next.js application and all `/api` routes.
- Docker Compose binds only to `127.0.0.1` and stores application data in the
  `pm-data` volume.
- MVP sessions are opaque, expiring, and held in backend memory. The browser
  receives only an HTTP-only, same-site cookie. A container restart requires a
  new sign-in but does not affect SQLite board data.
- The MVP accepts only `user` / `password`, while database ownership is modeled
  for multiple users and multiple boards.

Persistence and board API:

- SQLite lives at `/app/data/project_management.db`. Every connection enables
  foreign keys, WAL journaling, and a five-second busy timeout.
- Backend-generated IDs are UUIDv7 strings and timestamps are UTC ISO-8601
  strings. API path and body IDs are UUID-validated.
- Numbered SQL migrations are immutable and recorded in
  `schema_migrations`. Startup migration and seed behavior is idempotent.
- The first startup seeds the MVP user, one board, five fixed columns, and demo
  cards only when that user is absent.
- The MVP API exposes the authenticated user's first board. Columns are fixed:
  they can be renamed but cannot be created or deleted.
- Every board lookup is scoped through the authenticated username. Resources
  outside that ownership path are returned as not found.
- Card ordering is contiguous and zero-based. Reorders and cross-column moves
  use immediate transactions and temporary high positions to avoid uniqueness
  collisions; failures roll back the complete mutation.
- Every successful mutation increments `boards.version` and returns the entire
  newly persisted board in deterministic order. This same version will guard
  future AI proposals against stale confirmation.

Frontend integration:

- FastAPI is the board source of truth. The frontend does not generate
  persistent IDs or perform optimistic writes; it disables concurrent board
  mutations and replaces local state with each successful server response.
- A small typed API client owns all board HTTP calls, validates response shapes
  at runtime, sorts by server positions, and normalizes cards by ID for the UI.
- Column renames are sent on blur or Enter rather than on each keystroke.
- Card creation and inline editing retain draft input after failed requests.
  Errors are visible and never display an unpersisted change as saved.
- Drag and drop uses an explicit card drag handle. The client calculates the
  destination column and zero-based position, then sends one transactional move
  request.
- A board `401` returns control to the authentication gate. Initial load,
  retry, empty-board, saving, mutation-error, and session-expiry states are
  explicit.
- The responsive chat panel is permanently visible on wide desktops and
  collapsible at narrower desktop and mobile widths so it does not block board
  controls.
- A typed chat client validates history, assistant responses, operations,
  proposals, and confirmation board payloads at the browser boundary.

AI chat and proposals:

- Authenticated chat sends the latest board JSON, the current question, and at
  most 12 recent messages bounded to 6,000 characters to the hardcoded
  `openai/gpt-oss-120b` model.
- OpenRouter output must match a strict schema containing assistant text and up
  to 20 create-card, edit-card, move-card, delete-card, or rename-column
  operations.
- The backend validates every referenced card and column against the
  authenticated board and rejects unknown or conflicting operations.
- Successful user/assistant exchanges are stored only if the board version is
  still the version sent to the model. Proposed operations remain pending and
  do not mutate the board.
- Confirmation rechecks ownership, pending status, and board version, then
  applies every operation and marks the proposal confirmed in one immediate
  transaction. A stale proposal is marked stale without changing the board.
- Chat history restores persisted proposal status after reload. Rejection marks
  a pending proposal rejected without changing the board.

Testing:

- Backend API tests use temporary real SQLite files and exercise ownership,
  ordering, persistence, idempotent startup, and transaction rollback.
- Frontend integration tests mock only the HTTP boundary and verify runtime
  response parsing, state reconciliation, and failed-write behavior.
- Playwright runs against the Docker-served application. Browser scenarios
  clean up created records and cover authentication, all board mutations,
  chat history, proposal preview/confirmation/rejection, responsive chat,
  provider-independent failures, reload persistence, and a real container
  restart.

## Part 1: Planning and repository guidance

Implementation:

- [x] Review the project requirements and existing frontend.
- [x] Expand this document into sequenced implementation checklists.
- [x] Define valuable test expectations, coverage guidance, and success criteria.
- [x] Create `frontend/AGENTS.md` describing the current frontend.
- [x] Obtain user approval before beginning Part 2.

Success criteria:

- The plan covers every MVP requirement and identifies both approval gates.
- Frontend guidance accurately reflects the existing application.
- No runtime implementation changes are made during this part.

## Part 2: Docker and backend scaffolding

Implementation:

- [x] Initialize the FastAPI project in `backend/` using `uv`.
- [x] Add a minimal application factory, settings loader, health route, and
      static-file serving placeholder.
- [x] Update `backend/AGENTS.md` with backend structure and conventions.
- [x] Create a multi-stage Dockerfile that builds the frontend and packages the
      FastAPI runtime in one final image.
- [x] Add `.dockerignore` and keep runtime data in a mounted local volume.
- [x] Add start and stop scripts for Windows PowerShell, macOS, and Linux under
      `scripts/`; update `scripts/AGENTS.md`.
- [x] Serve example HTML at `/` and JSON from `/api/health`.
- [x] Add minimal root documentation for Docker start, stop, and tests.

Tests:

- [x] Unit-test settings and application creation.
- [x] Integration-test `/` and `/api/health` through an in-process ASGI client.
- [x] Build the Docker image and smoke-test both routes from the running
      container.
- [x] Verify every start/stop script targets the same container and data volume.

Success criteria:

- One documented command starts the container on a predictable local URL.
- `/` returns example HTML and `/api/health` returns HTTP 200 JSON.
- Stop scripts remove the running container without deleting persisted data.
- Tests cover application creation, settings, static delivery, and health checks.

## Part 3: Static frontend integration

Implementation:

- [x] Configure Next.js for static export without changing the current visual
      design or board behavior.
- [x] Build the frontend in Docker and copy the export into the FastAPI image.
- [x] Configure FastAPI to serve static assets and return `index.html` at `/`.
- [x] Preserve the current five-column Kanban demo, responsive layout, and
      drag-and-drop interactions.
- [x] Remove unused starter assets and document the static-build boundary.

Tests:

- [x] Retain and extend unit tests for board movement and card operations.
- [x] Integration-test static index and asset delivery from FastAPI.
- [x] Run Playwright against the Docker-served app, covering board load, column
      rename, card creation/deletion, and cross-column movement.
- [x] Verify direct refresh at `/` works in the container.

Success criteria:

- The existing Kanban board is served at `/` by FastAPI from the Docker image.
- All current interactions still work and no Next.js development server is
  needed at runtime.
- Tests cover the static delivery boundary and all existing board interactions.

## Part 4: MVP authentication

Implementation:

- [x] Add a login screen shown before the board.
- [x] Authenticate only the MVP credentials `user` / `password` on the backend.
- [x] Store authentication in an HTTP-only, same-site session cookie.
- [x] Add authenticated-session and logout endpoints.
- [x] Add a reusable server-side authentication dependency for board and AI API
      routes when those routes are introduced.
- [x] Return the user to the login screen after logout or session expiry.

Tests:

- [x] Unit-test credential validation and session handling.
- [x] Integration-test successful login, failed login, authenticated session,
      logout, and protected-route rejection.
- [x] Playwright-test login-to-board and logout-to-login journeys.
- [x] Verify cookies are HTTP-only and credentials do not appear in client
      bundles or logs.

Success criteria:

- Anonymous users cannot view board data or call protected APIs.
- Correct credentials establish a session; incorrect credentials show a clear
  error.
- Logout invalidates the session and returns to login.
- Tests cover successful and failed login, session restoration, logout, and
  protected-route rejection.

## Part 5: Database design approval

Implementation:

- [x] Propose normalized SQLite entities for users, boards, columns, cards, and
      chat messages, including IDs, ownership, ordering, and timestamps.
- [x] Define foreign keys, uniqueness rules, indexes, cascade behavior, and
      transaction boundaries.
- [x] Save the proposed schema as machine-readable JSON in `docs/`.
- [x] Document schema rationale, database-file location, initialization,
      migrations, backup, and Docker-volume persistence.
- [x] Include seed behavior for the MVP user and their single board.
- [x] Obtain user approval before implementing the database or API.

Tests:

- [x] Validate the schema JSON against its documented structure.
- [x] Review representative create, move, reorder, rename, and delete flows
      against the proposed constraints.

Success criteria:

- The design supports multiple users and boards even though the MVP exposes one
  board per signed-in user.
- Ordered columns/cards can be changed atomically.
- Ownership prevents cross-user data access.
- The user explicitly approves the design before Part 6.

## Part 6: Persistent backend board API

Implementation:

- [x] Add SQLite initialization and versioned migrations.
- [x] Create the database and seed the MVP user/board when absent.
- [x] Implement repository and service layers for board operations.
- [x] Add authenticated API routes to read the board, rename columns, create,
      edit, delete, move, and reorder cards.
- [x] Validate input with Pydantic and return consistent API errors.
- [x] Use transactions for moves and ordering changes.
- [x] Update backend documentation and API examples.

Tests:

- [x] Unit-test repositories, service logic, validation, ordering, and ownership.
- [x] Integration-test every API route against a temporary real SQLite database.
- [x] Test malformed IDs, invalid moves, missing resources, unauthenticated
      calls, and rollback on failed updates.
- [x] Test first-run database creation and idempotent startup.

Success criteria:

- All supported board changes persist across backend restarts.
- Responses preserve deterministic column/card ordering.
- Invalid operations do not partially mutate the database.
- Tests cover persistence, ordering, ownership, validation, and rollback behavior.

## Part 7: Persistent frontend and backend integration

Implementation:

- [x] Replace frontend seed state with authenticated board API loading.
- [x] Connect rename, create, edit, delete, move, and reorder interactions to the
      backend.
- [x] Add explicit loading, empty, retry, and error states.
- [x] Keep server responses authoritative and avoid optimistic writes where
      rollback would make local state ambiguous.
- [x] Refresh or reconcile state after successful mutations.
- [x] Keep API access in a small typed client module.

Tests:

- [x] Unit-test API-client parsing and UI state transitions.
- [x] Integration-test the board with mocked HTTP responses, including failures
      and unchanged local state after rejected writes.
- [x] Run frontend/backend contract tests for all board payloads.
- [x] Playwright-test changes persisting after page reload and container restart.
- [x] Cover card editing, deletion, same-column reorder, and cross-column moves.

Success criteria:

- The UI uses the backend as its source of truth.
- Every required board interaction persists and survives refresh.
- Server errors are visible and do not leave misleading local state.
- Tests cover API contracts, persistence, failure states, and server-authoritative
  reconciliation.

## Part 8: OpenRouter connectivity

Approved implementation decisions (September 7, 2026):

- Expose an authenticated `POST /api/chat` route that calls OpenRouter
  end-to-end; a mocked response does not satisfy the connectivity check.
- Keep `openai/gpt-oss-120b` hardcoded in the backend for this MVP stage.
- Complete Part 8 with a live `2+2` request through the application route and
  verify that the model returns the correct answer.

Implementation:

- [x] Load `OPENROUTER_API_KEY` only in backend runtime settings.
- [x] Add an OpenRouter client using model `openai/gpt-oss-120b`.
- [x] Configure bounded timeouts and concise error mapping.
- [x] Add the authenticated `POST /api/chat` route for real OpenRouter calls.

Tests:

- [x] Unit-test request construction and success/error parsing with mocked HTTP.
- [x] Integration-test timeout, unauthorized, insufficient-credit, rate-limit,
      malformed-response, and success paths.
- [x] Run one explicit live smoke test asking `2+2` and verify a correct response;
      do not make live calls in the normal automated suite.

Success criteria:

- The backend reaches OpenRouter without exposing the API key.
- The configured model returns a correct live answer when the account has
  sufficient credits.
- Provider failures produce stable, user-safe API errors.
- Tests cover successful provider responses and all material failure modes.

## Part 9: Structured AI board changes

Implementation:

- [x] Define a strict structured-output schema containing assistant text and an
      optional list of proposed board operations.
- [x] Send the authenticated user's current board JSON, question, and bounded
      conversation history to OpenRouter.
- [x] Permit only create-card, edit-card, move-card, delete-card, and
      rename-column operations.
- [x] Validate model output and board ownership on the server.
- [x] Store user/assistant chat messages and proposed operations.
- [x] Return proposed changes without applying them.
- [x] Add a confirmation endpoint that applies a still-valid proposal in one
      transaction and rejects stale proposals.

Tests:

- [x] Unit-test prompt construction, history truncation, structured parsing, and
      every operation type.
- [x] Test malformed, unknown, unauthorized, conflicting, and stale operations.
- [x] Integration-test chat against mocked OpenRouter responses and a real
      temporary SQLite database.
- [x] Verify rejected or unconfirmed proposals never change the board.
- [x] Verify confirmed multi-operation proposals are atomic.

Success criteria:

- Every AI response is grounded in the latest authenticated board state.
- Only schema-valid, owned, user-confirmed changes can mutate the board.
- Multi-card updates either complete fully or leave the board unchanged.
- Tests cover structured parsing, operation validation, confirmation, and
  transactional safety.

## Part 10: AI chat sidebar and final hardening

Implementation:

- [x] Add a polished responsive AI chat sidebar using the project color scheme.
- [x] Support message history, sending/thinking/error states, and keyboard and
      screen-reader accessibility.
- [x] Render proposed changes as a clear preview with confirm and reject actions.
- [x] On confirmation, apply the proposal and refresh the board automatically.
- [x] Preserve conversation during board refreshes and restore persisted history
      after reload.
- [x] Keep chat usable on desktop and mobile without blocking board controls.
- [x] Finalize minimal run, test, and troubleshooting documentation.

Tests:

- [x] Unit-test chat rendering, message submission, error recovery, proposal
      preview, confirmation, and rejection.
- [x] Integration-test the complete frontend-to-backend chat workflow with
      mocked OpenRouter responses.
- [x] Playwright-test text-only replies, proposed card creation/edit/move,
      rejection with no board change, confirmed multi-change refresh, provider
      failure, and history after reload.
- [x] Run the complete test suite and collect frontend/backend coverage reports.
- [x] Build a clean Docker image and run login, persistent board, AI proposal,
      confirmation, restart, and logout smoke tests.

Success criteria:

- Users can converse with the AI and review proposed board changes.
- Board mutations occur only after confirmation and appear without manual reload.
- Core flows work responsively and with keyboard navigation.
- All automated checks pass. Coverage is reviewed for meaningful gaps without
  requiring low-value tests to satisfy a numeric threshold.
- The MVP starts and stops using the documented platform scripts.