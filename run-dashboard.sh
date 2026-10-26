#!/usr/bin/env bash
# Start the Streamlit dashboard on macOS, Linux or Git Bash (Windows users can use run-dashboard.cmd).
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"
elif [ -x ".venv/Scripts/python.exe" ]; then PY=".venv/Scripts/python.exe"
else PY="python"; fi
exec "$PY" -m streamlit run app/dashboard.py "$@"
