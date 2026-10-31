@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ==============================================================================
echo   UrjaSetu EMS Platform — Development Stack Launcher
echo ==============================================================================
echo.

:: 1. Verify environment configuration
if not exist "platform\api\.env" (
    echo [ERROR] platform\api\.env not found!
    echo Please copy platform\api\.env.example to platform\api\.env
    pause
    exit /b 1
)

:: 2. Extract ENGINE_API_KEY from platform\api\.env
set "ENGINE_KEY="
for /f "usebackq tokens=1,* delims==" %%A in ("platform\api\.env") do (
    if "%%A"=="ENGINE_API_KEY" set "ENGINE_KEY=%%B"
)

if "%ENGINE_KEY%"=="" (
    echo [WARNING] ENGINE_API_KEY not found in platform\api\.env, generating dev fallback...
    set "ENGINE_KEY=dev_engine_secret_key_at_least_16_chars"
)

:: 3. Launch Python Engine (Port 8090)
echo [1/3] Starting Python Optimization Engine on http://127.0.0.1:8090 ...
start "UrjaSetu [Engine - Port 8090]" cmd /k "cd /d "%~dp0platform\engine" && set "ENGINE_API_KEY=%ENGINE_KEY%" && ..\..\.venv\Scripts\python.exe -m uvicorn avishkar_engine.app:create_app --factory --port 8090"

:: 4. Launch Fastify API (Port 8080)
echo [2/3] Starting Platform API Service on http://127.0.0.1:8080 ...
start "UrjaSetu [API - Port 8080]" cmd /k "cd /d "%~dp0platform\api" && pnpm dev"

:: 5. Launch Next.js Web Frontend (Port 3000)
echo [3/3] Starting Next.js Web Interface on http://127.0.0.1:3000 ...
start "UrjaSetu [Web - Port 3000]" cmd /k "cd /d "%~dp0platform\web" && pnpm dev"

echo.
echo ==============================================================================
echo   All 3 services are launching in separate windows!
echo   - Web UI:    http://localhost:3000
echo   - API:       http://localhost:8080 (OpenAPI spec: /api/openapi.json)
echo   - Engine:    http://localhost:8090 (Health check: /health)
echo.
echo   To stop the platform, close each service window or press Ctrl+C in them.
echo ==============================================================================
echo.
