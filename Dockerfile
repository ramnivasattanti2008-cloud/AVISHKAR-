# Production container for UrjaSetu (ऊर्जासेतु) EMS: the Streamlit dashboard.
# Works locally (docker compose, port 8501) and on Render/Fly/Railway (listens on $PORT).

FROM python:3.12-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUTF8=1 \
    TZ=Asia/Kolkata \
    UV_SYSTEM_PYTHON=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# uv must be new enough to read `default-groups = "all"` in pyproject.toml
# (0.5.x fails with "invalid type: string all, expected a sequence").
COPY --from=ghcr.io/astral-sh/uv:0.9.0 /uv /uvx /bin/

WORKDIR /app

# The package is installed editable and hatch reads the version from src/emhass,
# so the sources must be present before the install.
COPY pyproject.toml uv.lock* README.md LICENSE* NOTICE.md ./
COPY src/ ./src/
RUN uv pip install --no-cache -e ".[app]"

COPY app/ ./app/
COPY scripts/ ./scripts/
COPY examples/ ./examples/
COPY data/ ./data/
COPY results/ ./results/

RUN useradd -m -u 1000 emsuser && \
    mkdir -p /app/results /app/data/cache && \
    chown -R emsuser:emsuser /app

USER emsuser

# Pre-warm the dashboard result cache at build time so the first visitor does not
# wait minutes for model training. Failure is not fatal: the dashboard recomputes.
RUN python scripts/precompute_cache.py || echo "cache precompute skipped"

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fs "http://localhost:${PORT:-8501}/_stcore/health" || exit 1

# Hosts such as Render inject $PORT; locally it falls back to 8501.
CMD ["sh", "-c", "exec streamlit run app/dashboard.py --server.port=${PORT:-8501} --server.address=0.0.0.0 --server.headless=true --browser.gatherUsageStats=false"]
