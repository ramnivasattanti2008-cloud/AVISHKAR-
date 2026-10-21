@echo off
REM ==============================================================================
REM UrjaSetu (ऊर्जासेतु) EMS - 1-Click Production Launcher for Windows
REM ==============================================================================

echo [UrjaSetu EMS] Checking environment...

where uv >nul 2>nul
if %errorlevel% equ 0 (
    echo [UrjaSetu EMS] Launching with uv on http://localhost:8501 ...
    uv run --extra app streamlit run app/dashboard.py --server.port=8501
    goto end
)

if exist .venv\Scripts\streamlit.exe (
    echo [UrjaSetu EMS] Launching with .venv on http://localhost:8501 ...
    .venv\Scripts\streamlit.exe run app/dashboard.py --server.port=8501
    goto end
)

where streamlit >nul 2>nul
if %errorlevel% equ 0 (
    echo [UrjaSetu EMS] Launching with system streamlit on http://localhost:8501 ...
    streamlit run app/dashboard.py --server.port=8501
    goto end
)

echo [ERROR] Neither uv, .venv, nor streamlit found. Please install dependencies with:
echo        pip install -e .[app]
pause

:end
