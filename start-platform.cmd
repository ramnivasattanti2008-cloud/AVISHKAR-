@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo AVISHKAR EMS — Unified Platform Launcher
echo ==============================================================================

echo [1/4] Verifying database connectivity & PostGIS health...
call pnpm.cmd -C platform/api db:health
if %errorlevel% neq 0 (
    echo [ERROR] Database health check failed. Starting local database fallback...
    call start-database.cmd
)

echo.
echo [2/4] Launching Python Optimization Engine on port 8090...
rem The engine and the API must share one key; it is read from the git-ignored platform\api\.env, never written here.
set "ENGINE_API_KEY="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0platform\api\.env") do if "%%a"=="ENGINE_API_KEY" set "ENGINE_API_KEY=%%b"
if not defined ENGINE_API_KEY (
    echo [ERROR] ENGINE_API_KEY is not set in platform\api\.env. Add a key of 16 or more characters there.
    exit /b 1
)
start "AVISHKAR Engine (:8090)" cmd /k "cd /d "%~dp0platform\engine" && ..\..\.venv\Scripts\python.exe -m uvicorn avishkar_engine.app:create_app --factory --port 8090"

echo.
echo [3/4] Launching Platform Fastify API on port 8080...
start "AVISHKAR API (:8080)" cmd /k "cd /d "%~dp0platform\api" && pnpm dev"

echo.
echo [4/4] Launching Web Frontend on port 3000...
start "AVISHKAR Web (:3000)" cmd /k "cd /d "%~dp0platform\web" && pnpm dev"

echo.
echo ==============================================================================
echo [SUCCESS] All 3 AVISHKAR Platform services are launching!
echo ==============================================================================
echo - Python Engine:  http://127.0.0.1:8090 (OpenAPI docs at /docs)
echo - Platform API:   http://127.0.0.1:8080 (OpenAPI spec at /api/openapi.json)
echo - Web Frontend:   http://localhost:3000
echo - Database:       whatever DATABASE_URL in platform\api\.env points to
echo.
echo Opening Web Frontend in your browser...
start http://localhost:3000
echo ==============================================================================
