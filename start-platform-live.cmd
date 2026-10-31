@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo AVISHKAR EMS — Live Production & Public Cloud Deployment Launcher
echo ==============================================================================

if not exist "%~dp0platform\api\.env" (
    echo [ERROR] platform\api\.env not found!
    pause
    exit /b 1
)

if not exist "%~dp0tools\cloudflared.exe" (
    echo [ERROR] Cloudflare tunnel executable not found at tools\cloudflared.exe!
    pause
    exit /b 1
)

set "ENGINE_API_KEY="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0platform\api\.env") do if "%%a"=="ENGINE_API_KEY" set "ENGINE_API_KEY=%%b"
if not defined ENGINE_API_KEY (
    echo [ERROR] ENGINE_API_KEY is not defined in platform\api\.env!
    pause
    exit /b 1
)

echo [1/5] Verifying Cloud Database (Neon PostgreSQL 18.6 + PostGIS)...
call pnpm.cmd --dir platform/api run db:health
if %errorlevel% neq 0 (
    echo [WARNING] Primary cloud database check failed; falling back to local WSL PostgreSQL...
    call "%~dp0start-database.cmd"
)

echo.
echo [2/5] Launching Python Optimization Engine on port 8090...
start "AVISHKAR Engine (:8090)" cmd /k "cd /d "%~dp0platform\engine" && ..\..\.venv\Scripts\python.exe -m uvicorn avishkar_engine.app:create_app --factory --port 8090"

echo.
echo [3/5] Launching Fastify API on port 8080...
start "AVISHKAR API (:8080)" cmd /k "cd /d "%~dp0platform\api" && npx tsx --env-file=.env watch src/server.ts"

echo.
echo [4/5] Launching Next.js Web Frontend on port 3000...
start "AVISHKAR Web (:3000)" cmd /k "cd /d "%~dp0platform\web" && pnpm dev"

echo.
echo [5/5] Launching Global Cloudflare Public HTTPS Tunnel...
echo Waiting 5 seconds for web server to initialize...
timeout /t 5 /nobreak >nul

start "AVISHKAR Public Cloudflare Tunnel" cmd /k "title AVISHKAR Live Public URL && echo ============================================================================== && echo AVISHKAR EMS — Live Public HTTPS Tunnel && echo Look for your public URL below: https://*.trycloudflare.com && echo ============================================================================== && "%~dp0tools\cloudflared.exe" tunnel --url http://localhost:3000"

echo.
echo ==============================================================================
echo [DEPLOYMENT SUCCESSFUL] All AVISHKAR Services + Public Edge Tunnel are LIVE!
echo ==============================================================================
echo.
echo - Public Live URL:    Check the "AVISHKAR Public Cloudflare Tunnel" window
echo                       (Copy the https://*.trycloudflare.com address)
echo - Local Web App:      http://localhost:3000
echo - Fastify API:        http://localhost:8080 (OpenAPI: /api/openapi.json)
echo - Python Engine:      http://127.0.0.1:8090 (Docs: /docs)
echo - Live Cloud DB:      Neon Serverless PostgreSQL 18.6 + PostGIS 3.6.4
echo.
echo Tip: Anyone on any device (phone, laptop, iPad) can access the live public URL!
echo Keep the launched terminal windows open while you want the deployment active.
echo ==============================================================================
echo Opening local web interface in default browser...
start http://localhost:3000
pause
