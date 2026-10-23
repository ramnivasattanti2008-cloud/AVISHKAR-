<#
.SYNOPSIS
    UrjaSetu EMS Platform — Development Stack Launcher (PowerShell)
.DESCRIPTION
    Launches the Python Engine (8090), Fastify API (8080), and Next.js Web (3000)
    in separate terminal processes with synchronized keys.
#>

$root = $PSScriptRoot
Set-Location $root

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "  UrjaSetu EMS Platform — Development Stack Launcher" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check WSL PostgreSQL status
try {
    $pgStatus = wsl -d Ubuntu -- service postgresql status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] PostgreSQL running in WSL Ubuntu" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] PostgreSQL in WSL Ubuntu may not be running. Run: wsl -d Ubuntu -- sudo service postgresql start" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[INFO] WSL check skipped." -ForegroundColor Gray
}

# 2. Verify platform/api/.env and extract ENGINE_API_KEY
$apiEnv = Join-Path $root "platform\api\.env"
if (-not (Test-Path $apiEnv)) {
    Write-Host "[ERROR] platform\api\.env not found!" -ForegroundColor Red
    Write-Host "Please copy platform\api\.env.example to platform\api\.env"
    exit 1
}

$engineKey = "dev_engine_secret_key_at_least_16_chars"
Get-Content $apiEnv | ForEach-Object {
    if ($_ -match "^\s*ENGINE_API_KEY\s*=\s*(.+)$") {
        $engineKey = $matches[1].Trim()
    }
}

# 3. Launch Python Engine (Port 8090)
Write-Host "[1/3] Starting Python Optimization Engine on http://127.0.0.1:8090 ..." -ForegroundColor Blue
$engineCmd = "/k cd /d `"$root\platform\engine`" && set `"ENGINE_API_KEY=$engineKey`" && `"$root\.venv\Scripts\python.exe`" -m uvicorn avishkar_engine.app:create_app --factory --port 8090"
Start-Process -FilePath "cmd.exe" -ArgumentList $engineCmd -WindowStyle Normal

# 4. Launch Fastify API (Port 8080)
Write-Host "[2/3] Starting Platform API Service on http://127.0.0.1:8080 ..." -ForegroundColor Blue
$apiCmd = "/k cd /d `"$root\platform\api`" && pnpm dev"
Start-Process -FilePath "cmd.exe" -ArgumentList $apiCmd -WindowStyle Normal

# 5. Launch Next.js Web Frontend (Port 3000)
Write-Host "[3/3] Starting Next.js Web Interface on http://127.0.0.1:3000 ..." -ForegroundColor Blue
$webCmd = "/k cd /d `"$root\platform\web`" && pnpm dev"
Start-Process -FilePath "cmd.exe" -ArgumentList $webCmd -WindowStyle Normal

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "  All 3 services are launching in separate windows!" -ForegroundColor Green
Write-Host "  - Web UI:    http://localhost:3000" -ForegroundColor White
Write-Host "  - API:       http://localhost:8080 (OpenAPI spec: /api/openapi.json)" -ForegroundColor White
Write-Host "  - Engine:    http://localhost:8090 (Health check: /health)" -ForegroundColor White
Write-Host ""
Write-Host "  To stop the platform, close each service window or press Ctrl+C in them." -ForegroundColor Gray
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host ""
