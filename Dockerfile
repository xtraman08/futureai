FROM node:24-alpine AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM ghcr.io/astral-sh/uv:0.12.5 AS uv


FROM python:3.14-slim AS backend-builder

COPY --from=uv /uv /uvx /bin/
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev


FROM python:3.14-slim AS runtime

ENV PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app

WORKDIR /app/backend
COPY --from=backend-builder --chown=appuser:appuser /app/backend/.venv .venv
COPY --chown=appuser:appuser backend/app ./app
COPY --from=frontend-builder --chown=appuser:appuser \
    /build/frontend/out ./static

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
