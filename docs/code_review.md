# Code review

Full-repository review of the Project Management MVP at the Part 10 baseline.

Scope: `backend/app` (17 modules), `frontend/src` (12 modules), `backend/tests`,
`frontend/tests`, Docker and Compose configuration, platform scripts, and
project documentation.

Method: every source file was read in full. Findings marked **Verified** were
reproduced by executing code during the review. Findings marked **By
inspection** were not executed and are reasoned from the source.

Baseline at review time: backend 52 tests / 93% coverage, frontend 33 tests /
88% coverage, 12 Playwright tests, all passing.

## Summary

The codebase is in good shape. Ownership scoping, transactional ordering, the
propose-then-confirm AI flow, and the runtime-validated API boundary are
consistently applied and genuinely well built. Nothing here threatens the
architecture.

One defect is worth fixing promptly (H-1, an unauthenticated 500). The rest is a
mix of medium-severity UI state bugs, accessibility gaps, and consolidation
work.

| Severity | Count | Theme |
|---|---|---|
| High | 1 | Unauthenticated 500 on non-ASCII credentials |
| Medium | 6 | Stale UI state, concurrency guards, keyboard access |
| Low | 9 | Robustness, efficiency, convention drift |
| Cleanup | 7 | Duplication and dead code |

## High

### H-1 Non-ASCII credentials return HTTP 500 instead of 401

**Verified.** `backend/app/auth.py:41-48`

`secrets.compare_digest` raises `TypeError: comparing strings with non-ASCII
characters is not supported` when given `str` arguments outside ASCII. Both
`credentials.username` and `credentials.password` are caller-controlled and
unconstrained by `LoginRequest`, so the exception escapes the handler.

Reproduced against the real application factory:

| Request | Status |
|---|---|
| non-ASCII username, valid password | **500** |
| valid username, non-ASCII password | **500** |
| plain wrong credentials | 401 |
| correct credentials | 200 |

Any user whose password contains an accented character sees "Internal Server
Error" rather than a credential error, and every attempt writes a traceback to
the container log. It is reachable without authentication.

**Action.** Compare bytes, not text:

```python
valid_username = secrets.compare_digest(
    credentials.username.encode("utf-8"),
    settings.mvp_username.encode("utf-8"),
)
valid_password = secrets.compare_digest(
    credentials.password.encode("utf-8"),
    settings.mvp_password.get_secret_value().encode("utf-8"),
)
```

Encoding preserves the constant-time property. Add a regression test in
`backend/tests/test_auth.py` asserting 401 for non-ASCII input.

## Medium

### M-1 An externally renamed column keeps the old title in its input

**Verified** with a temporary rerender test.
`frontend/src/components/KanbanColumn.tsx:36`

`draftTitle` is seeded with `useState(column.title)` and never resynchronised.
Because `KanbanColumn` is keyed by the stable `column.id`, React reuses the
instance when the server returns a new title, so the state initialiser does not
re-run.

The reachable path is a core advertised feature: confirming an AI
`rename_column` proposal updates `board`, the header pill at
`KanbanBoard.tsx:238` shows the new title, but the column's own input still
shows the old one until a reload. The same applies to a rename made in another
tab.

Note that `KanbanCard.tsx:129-132` solves exactly this problem correctly, by
re-seeding `title` and `details` from props when the editor opens.
`KanbanColumn` has no equivalent.

**Action.** Track the last-seen prop and reset when it changes, or lift the
draft into the parent. Keep the existing revert-on-failure behaviour.

### M-2 Mutation guard reads React state, not a ref

**By inspection.** `frontend/src/components/KanbanBoard.tsx:88`

```ts
if (isMutating) { return false; }
setIsMutating(true);
```

`isMutating` is captured from the render closure. Two handlers dispatched in the
same tick both observe `false` and both proceed, so the "disables concurrent
board mutations" guarantee in `docs/PLAN.md` rests on the `disabled` props
alone. Those props close most of the window but not all of it: a drag ending
while a click is in flight is not covered by either button's `disabled`.

**Action.** Latch with `useRef<boolean>`, set it synchronously before the await,
and clear it in `finally`. Keep the state variable for rendering.

### M-3 Sibling proposals stay actionable after one is confirmed

**By inspection.** `frontend/src/components/ChatSidebar.tsx:182-197`

Confirming a proposal increments `boards.version`, which makes every other
pending proposal stale server-side. `updateProposal` only rewrites the confirmed
one, so any other pending proposal in the transcript still renders "Awaiting
review" with an enabled Confirm button.

It self-corrects, since the click returns 409 and `handleConfirm` reloads
history, but the user is invited to take an action that cannot succeed.

**Action.** In the confirm success path, mark all other `pending` proposals
`stale` locally, matching what the backend has already done.

### M-4 A user's chat message is discarded when the board changes mid-request

**By inspection.** `backend/app/chat_repository.py:121-167`

`save_exchange` opens `BEGIN IMMEDIATE`, re-checks the board version, and raises
`BoardChangedError` before inserting either row. Both the user message and the
assistant reply are rolled back, so a question typed by the user disappears
entirely and they receive a 409.

The model call has already been paid for at this point, and the reply is thrown
away too.

**Action.** Decide the intended behaviour and make it explicit. Persisting the
user message unconditionally, and the assistant reply without a proposal, would
preserve the transcript. At minimum, have the frontend restore the draft so the
question is not lost.

### M-5 Drag and drop is not keyboard accessible

**By inspection.** `frontend/src/components/KanbanBoard.tsx:40-44`

Only `PointerSensor` is registered. The drag handle at
`KanbanCard.tsx:115-124` is a real `<button>` and receives focus, so keyboard
users can reach a control that does nothing. `docs/PLAN.md` Part 10 claims
keyboard accessibility; that holds for chat but not for the board.

**Action.** Add `KeyboardSensor` with `sortableKeyboardCoordinates` from
`@dnd-kit/sortable`, and add `announcements` for screen-reader feedback. Cover
with one Playwright keyboard-move test.

### M-6 The two drag-and-drop E2E tests depend on seed data

**Verified** during the full test run that preceded this review.

`frontend/tests/kanban.spec.ts:152` and `:186` use the first column's existing
cards as their fixture rather than creating their own. On a `pm-data` volume
that has drifted, which happens as soon as any earlier run leaves the board
altered, `Backlog` can hold fewer than the two cards they need, and both fail.

Observed: board at version 94 with `Backlog` empty; test `:152` moved the only
remaining card out and failed its restore, which cascaded into a 60s timeout in
`:186`. Restoring the seed distribution made all 12 pass. The failure presents
as a drag-and-drop regression, which is misleading.

**Action.** Have both tests create their own cards, assert against those, and
delete them in cleanup, following the pattern `:95` already uses.

## Low

### L-1 Mutation responses are read after the write transaction closes

`backend/app/board_repository.py:110, 154, 183, 214, 285`;
`backend/app/chat_repository.py:242`

Every mutation ends with `return self.get_board(username)` placed outside the
`with closing(...)` block, so it opens a second connection after the commit.
`docs/API.md` promises "the complete, newly persisted board", but what is
returned is the board as of a later read, which may include a concurrent
writer's changes. Benign for a single-user MVP; it does weaken the stated
contract, and it doubles connections per write.

**Action.** Build the response inside the open transaction before committing, or
soften the wording in `docs/API.md`.

### L-2 Blocking SQLite work inside the async chat handler

`backend/app/chat_routes.py:86`, `backend/app/chat_service.py:151`

`chat` is `async def`, but `ChatService.respond` calls synchronous repository
methods. Those block the event loop. The sibling board routes are sync `def` and
are therefore correctly offloaded to the threadpool.

**Action.** Wrap the repository calls in `anyio.to_thread.run_sync`, or make the
handler sync and await the provider call separately.

### L-3 Truncated model output is reported as invalid board changes

`backend/app/openrouter.py:142`, `backend/app/chat_service.py:158-163`

`finish_reason == "length"` is not distinguished. With `max_tokens=2048` and up
to 20 permitted operations, a long structured reply can be cut mid-JSON; the
user is told the AI "returned invalid board changes", which points at the wrong
cause.

**Action.** Detect `finish_reason == "length"` and raise a distinct, accurate
message.

### L-4 The session payload is cast without runtime validation

`frontend/src/components/AuthGate.tsx:51, 96`

`(await response.json()) as SessionPayload` is an unchecked assertion.
`frontend/AGENTS.md` states that the API client "validates response shapes at
runtime", which `board-api.ts` and `chat-api.ts` do rigorously. Auth is the one
boundary that does not.

**Action.** Validate `username` is a string before use, consistent with the
other two clients.

### L-5 Migration metadata is string-interpolated into executescript

`backend/app/database.py:99-109`

`name` and `applied_at` are concatenated into SQL with manual quote doubling.
Values are developer-controlled filenames, so this is not currently
exploitable, but it is the only place in the codebase that does not use bound
parameters, and the manual escaping invites drift.

**Action.** Run the script with `executescript`, then record the migration row
with a separate parameterised `execute`.

### L-6 Seed check is not inside its transaction

`backend/app/database.py:116-127`

The `SELECT id FROM users` existence check happens before `BEGIN IMMEDIATE`.
Safe with one uvicorn process; two workers or two containers on the same volume
could both pass the check.

**Action.** Move the check inside the transaction, or rely on the
`UNIQUE (username)` constraint and catch `IntegrityError`.

### L-7 Expired sessions are never swept

`backend/app/sessions.py:25-37`

Entries are removed only when that specific token is resolved after expiry.
Tokens that are never presented again stay in the dict for the process lifetime.

**Action.** Sweep opportunistically in `create`, or accept it and note the
bound.

### L-8 `cookie_secure` defaults to False

`backend/app/settings.py:21`

Correct for an HTTP localhost MVP. Flagged only so it is not forgotten: it must
become `True` before any non-localhost deployment.

### L-9 Card deletion is immediate and irreversible

`frontend/src/components/KanbanCard.tsx:140-148`

One click, no confirmation, no undo, and the card is gone permanently.

**Action.** Product decision. A confirmation step or an undo window would fit
the care shown elsewhere in the error handling.

## Cleanup

### D-1 Roughly 110 duplicated lines across the two repositories

`_owned_column`, `_owned_card`, `_card_ids`, `_reorder_cards`, and
`_touch_board` are byte-identical in `board_repository.py:287-391` and
`chat_repository.py:439-542`. The duplication exists because proposal
confirmation applies operations inside a transaction it controls, which is a
sound reason to share the connection, not the code.

**Action.** Extract into a shared module taking `connection` as a parameter.
This is the single highest-value cleanup: an ordering or ownership fix applied
to one file and not the other is a realistic future bug.

### D-2 Parallel HTTP scaffolding in the two API clients

`board-api.ts` and `chat-api.ts` each define `isRecord`, numeric and string
readers, JSON payload reading, `detail` extraction, and a near-identical error
class differing only in `name`.

**Action.** Extract a shared `api-client.ts` with one error type carrying a
source tag.

### D-3 `BoardService` is mostly a pass-through

`backend/app/board_service.py`: `get_board`, `delete_card`, and `move_card`
forward verbatim. The only real logic is whitespace trimming, which
`chat_models.py` already achieves declaratively with
`StringConstraints(strip_whitespace=True)`.

**Action.** Move trimming into `board_models.py` and collapse the layer, or keep
it and accept the indirection deliberately.

### D-4 `OpenRouterClient.chat()` is exercised only by tests

`backend/app/openrouter.py:80-84`. The production path uses `complete()`.

**Action.** Delete it and update `test_chat.py` to call `complete()`.

### D-5 `BoardChangedError` is re-raised as itself

`backend/app/chat_service.py:174-178` catches it only to re-raise the same type
with a message attached.

**Action.** Raise it with its message at the source in `chat_repository.py:126`.

### D-6 Chat history is over-fetched

`chat_repository.get_history` defaults to `limit=20`; `truncate_history` keeps at
most 12. Eight rows are read and discarded on every chat request.

**Action.** Pass `MAX_HISTORY_MESSAGES` through.

### D-7 `KanbanBoard.tsx` mixes orchestration with decorative markup

336 lines, of which roughly 55 (`:188-242`) are static header and gradient
markup.

**Action.** Extract `BoardHeader`; the data-flow logic then reads on one screen.

## Efficiency

| Item | Location | Note |
|---|---|---|
| Two connections and a full re-read per mutation | both repositories | See L-1 |
| One `UPDATE` per card after the bulk shift | `_reorder_cards` | N+1; fine at MVP size |
| New `httpx.AsyncClient` per chat request | `openrouter.py:103` | No connection reuse |
| `_reorder_cards` rewrites `updated_at` for unmoved cards | both repositories | Timestamps overstate churn |

None of these matter at current scale. Listed for completeness.

## Testing gaps

| Gap | Suggested test |
|---|---|
| Non-ASCII credentials (H-1) | `test_auth.py` asserting 401 |
| External column rename (M-1) | Rerender assertion in `KanbanColumn.test.tsx` |
| Concurrent mutation guard (M-2) | Two mutations dispatched in one tick |
| Sibling proposal staleness (M-3) | Two pending proposals, confirm one |
| Keyboard drag (M-5) | Playwright keyboard move |
| Seed-dependent E2E (M-6) | Self-provisioning fixtures |
| `KanbanCardPreview` at 7.69% | Render assertion |

Coverage is otherwise strong. Per `docs/PLAN.md`, do not add low-value tests to
move the percentage.

## Housekeeping

- **`frontend/test-results/.last-run.json` is tracked** despite `test-results/`
  being listed at `.gitignore:182`. It was committed before the rule existed.
  Run `git rm --cached frontend/test-results/.last-run.json`.
- **Stale `VIRTUAL_ENV`.** Every `uv` invocation warns that `pm/.venv` does not
  match `backend/.venv`. Harmless, but it is noise on every command. Remove the
  unused root `.venv` or unset the variable.
- **`.env` handling is correct.** Excluded by both `.dockerignore` and
  `.gitignore`, loaded only into backend settings, never returned or logged. No
  secret exposure was found in the frontend bundle or the image.

## Suggested order of work

1. H-1: small, verified, unauthenticated 500.
2. M-6: makes the suite trustworthy on a drifted volume; everything else is
   easier to validate afterwards.
3. M-1, M-2, M-3: user-visible state correctness, all localised.
4. D-1: the duplication most likely to cause a future divergence bug.
5. M-5: accessibility, closes a claim already made in `docs/PLAN.md`.
6. Remaining Low and Cleanup items as convenient.
