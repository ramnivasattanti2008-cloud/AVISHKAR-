@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set STREAMLIT_SERVER_HEADLESS=false

cd /d "%~dp0"

echo ========================================================
echo   Starting AVISHKAR EMS Prototype Dashboard...
echo ========================================================

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m streamlit run "app\dashboard.py"
) else (
    python -m streamlit run "app\dashboard.py"
)

if errorlevel 1 (
    echo.
    echo Dashboard exited with an error.
    pause
)
