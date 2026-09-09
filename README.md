# Project Management MVP

## Run with Docker

Prerequisite: Docker Desktop or Docker Engine with Compose.

Create `.env` in this directory with:

```text
OPENROUTER_API_KEY=your-key
```

Windows PowerShell:

```powershell
.\scripts\start.ps1
```

macOS or Linux:

```bash
sh scripts/start.sh
```

Open http://127.0.0.1:8000 to use the Kanban board. FastAPI serves the exported
Next.js site and exposes its health check at
http://127.0.0.1:8000/api/health.

MVP login:

- Username: `user`
- Password: `password`

Board changes are stored in the `pm-data` Docker volume and survive normal
container stops and rebuilds. See `docs/API.md` for API routes and examples.

Stop without deleting local data:

```powershell
.\scripts\stop.ps1
```

```bash
sh scripts/stop.sh
```

## Backend checks

```bash
cd backend
uv sync --all-groups
uv run ruff check .
uv run pytest
```

## Frontend checks

```bash
cd frontend
npm ci
npm run lint
npm run test:unit
npm run build
```

With the Docker app running, execute the browser suite against FastAPI:

```powershell
$env:E2E_BASE_URL = "http://127.0.0.1:8000"
npm run test:e2e
Remove-Item Env:E2E_BASE_URL
```

## Troubleshooting

- If startup fails, confirm Docker is running and port 8000 is available.
- If chat reports that the AI service is not configured, confirm
  `OPENROUTER_API_KEY` is present in `.env`, then restart the container.
- Authentication, credit, rate-limit, timeout, and provider availability errors
  are shown in the chat without exposing provider details or credentials.
- Application data survives normal stop/start cycles in the `pm-data` volume.
