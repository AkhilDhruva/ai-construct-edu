# VeraClause Mantle API. Build from the repository root so the shared content ships too:
#   docker build -f api/Dockerfile -t mantle-api .
FROM python:3.12-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app/api

COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY api/ ./
COPY content/ /app/content/
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 mantle
USER mantle
ENV MANTLE_ENV=prod MANTLE_CONTENT_DIR=/app/content PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uv run --no-dev uvicorn mantle_api.main:app_factory --factory --host 0.0.0.0 --port ${PORT} --proxy-headers"]
