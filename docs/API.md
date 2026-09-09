# Backend API

The API is served below `/api`. Board and chat routes require the `pm_session`
cookie created by the login endpoint. Every successful board mutation returns
the complete, newly persisted board so clients can reconcile local state.

## Routes

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/board`
- `PATCH /api/board/columns/{column_id}`
- `POST /api/board/cards`
- `PATCH /api/board/cards/{card_id}`
- `DELETE /api/board/cards/{card_id}`
- `POST /api/board/cards/{card_id}/move`
- `GET /api/chat`
- `POST /api/chat`
- `POST /api/chat/proposals/{proposal_id}/confirm`
- `POST /api/chat/proposals/{proposal_id}/reject`
- `GET /api/health`

Interactive OpenAPI documentation is available at
http://127.0.0.1:8000/api/docs while the app is running.

## Examples

Sign in and save the session cookie:

```powershell
curl.exe -c session.cookies -H "Content-Type: application/json" `
  -d '{\"username\":\"user\",\"password\":\"password\"}' `
  http://127.0.0.1:8000/api/auth/login
```

Read the signed-in user's board:

```powershell
curl.exe -b session.cookies http://127.0.0.1:8000/api/board
```

Rename a column:

```powershell
curl.exe -X PATCH -b session.cookies `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Ideas\"}' `
  http://127.0.0.1:8000/api/board/columns/COLUMN_ID
```

Create a card:

```powershell
curl.exe -X POST -b session.cookies `
  -H "Content-Type: application/json" `
  -d '{\"column_id\":\"COLUMN_ID\",\"title\":\"New card\",\"details\":\"Notes\"}' `
  http://127.0.0.1:8000/api/board/cards
```

Edit a card:

```powershell
curl.exe -X PATCH -b session.cookies `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Revised card\",\"details\":\"Updated notes\"}' `
  http://127.0.0.1:8000/api/board/cards/CARD_ID
```

Move or reorder a card. Positions are zero-based and values beyond the end of
the target column are clamped to the end:

```powershell
curl.exe -X POST -b session.cookies `
  -H "Content-Type: application/json" `
  -d '{\"target_column_id\":\"COLUMN_ID\",\"target_position\":0}' `
  http://127.0.0.1:8000/api/board/cards/CARD_ID/move
```

Delete a card:

```powershell
curl.exe -X DELETE -b session.cookies `
  http://127.0.0.1:8000/api/board/cards/CARD_ID
```

Send a message to the hardcoded `openai/gpt-oss-120b` model through OpenRouter:

```powershell
curl.exe -X POST -b session.cookies `
  -H "Content-Type: application/json" `
  -d '{\"message\":\"2+2\"}' `
  http://127.0.0.1:8000/api/chat
```

Chat responses contain assistant text and either `proposal: null` or a pending
proposal with its ID, source board version, and validated operations. Supported
operations are `create_card`, `edit_card`, `move_card`, `delete_card`, and
`rename_column`. A proposal does not change the board until it is confirmed:

```powershell
curl.exe -X POST -b session.cookies `
  http://127.0.0.1:8000/api/chat/proposals/PROPOSAL_ID/confirm
```

Confirmation returns the complete updated board. It applies every operation in
one transaction and returns `409` without changing the board if the proposal is
stale or no longer pending.

Read persisted conversation history:

```powershell
curl.exe -b session.cookies http://127.0.0.1:8000/api/chat
```

Reject a pending proposal without changing the board:

```powershell
curl.exe -X POST -b session.cookies `
  http://127.0.0.1:8000/api/chat/proposals/PROPOSAL_ID/reject
```

The chat route requires `OPENROUTER_API_KEY` in the root `.env` file. Provider
authentication, credit, rate-limit, timeout, availability, and malformed
response failures are returned as concise API errors without provider details
or credentials.

Missing owned resources return `404`, invalid domain operations return `400`,
invalid request bodies return `422`, and missing or expired sessions return
`401`.
