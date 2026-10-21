#!/usr/bin/env bash
# ==============================================================================
# UrjaSetu (ऊर्जासेतु) EMS - 1-Click Production Launcher for Linux / macOS
# ==============================================================================

set -e

echo "[UrjaSetu EMS] Checking runtime environment..."

if command -v uv &> /dev/null; then
    echo "[UrjaSetu EMS] Launching with uv on http://localhost:8501 ..."
    exec uv run --extra app streamlit run app/dashboard.py --server.port=8501 --server.address=0.0.0.0
elif [ -f ".venv/bin/streamlit" ]; then
    echo "[UrjaSetu EMS] Launching with .venv on http://localhost:8501 ..."
    exec .venv/bin/streamlit run app/dashboard.py --server.port=8501 --server.address=0.0.0.0
elif command -v streamlit &> /dev/null; then
    echo "[UrjaSetu EMS] Launching with system streamlit on http://localhost:8501 ..."
    exec streamlit run app/dashboard.py --server.port=8501 --server.address=0.0.0.0
else
    echo "[ERROR] Streamlit not found. Please install with: pip install -e '.[app]'"
    exit 1
fi
