# Multi-stage production container for UrjaSetu (ऊर्जासेतु) EMS
# Compliant with CEA 2026 Cybersecurity isolation standards (non-root execution)

FROM python:3.12-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Kolkata \
    UV_SYSTEM_PYTHON=1

# Install essential system utilities and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:0.5.26 /uv /uvx /bin/

# Create application directory
WORKDIR /app

# Copy dependency manifests first for maximum Docker layer caching
COPY pyproject.toml uv.lock* ./

# Install project dependencies into system environment
RUN uv pip install --no-cache -e ".[app,test]"

# Copy application source code and assets
COPY src/ ./src/
COPY app/ ./app/
COPY scripts/ ./scripts/
COPY tests/ ./tests/
COPY README.md LICENSE* ./

# Create unprivileged service user for CEA cybersecurity compliance
RUN useradd -m -u 1000 emsuser && \
    mkdir -p /app/results /app/data && \
    chown -R emsuser:emsuser /app

USER emsuser

# Expose Streamlit Dashboard (8501) and Beckn DEG v2.0 REST API (8000)
EXPOSE 8501 8000

# Health check probe against local Streamlit server
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

# Default startup command: launch UrjaSetu Streamlit dashboard
CMD ["streamlit", "run", "app/dashboard.py", "--server.port=8501", "--server.address=0.0.0.0", "--server.headless=true"]