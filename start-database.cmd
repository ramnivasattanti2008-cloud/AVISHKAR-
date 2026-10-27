@echo off
setlocal

echo ==============================================================================
echo AVISHKAR EMS - PostgreSQL 16 + PostGIS Real Database Launcher
echo ==============================================================================

echo [1/4] Checking WSL and starting PostgreSQL in Ubuntu...
wsl -d Ubuntu -u root -- bash /mnt/c/Users/Ram\ Nivas/projects/AVISHKAR-/scripts/wsl-init-db.sh
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start PostgreSQL inside WSL Ubuntu.
    exit /b 1
)

echo.
echo [2/4] Ensuring schema migrations are deployed...
call pnpm.cmd -C platform/api db:migrate

echo.
echo [3/4] Ensuring reference tariffs and policy rules are seeded...
call pnpm.cmd -C platform/api db:seed

echo.
echo [4/4] Running complete database health and spatial verification...
call pnpm.cmd -C platform/api exec tsx scripts/db-health.ts

echo.
echo ==============================================================================
echo [SUCCESS] Real PostgreSQL 16 + PostGIS Database is ACTIVE and READY!
echo ==============================================================================
echo Local dev DB:     postgresql://avishkar:****@127.0.0.1:5432/avishkar_dev
echo Integration Test:  postgresql://avishkar:****@127.0.0.1:5432/avishkar_test
echo                    (the password is in platform\api\.env, which git ignores)
echo PostGIS Version:   3.4.2 (Spatial Enabled)
echo.
echo To launch Web App:      pnpm -C platform/web dev
echo To launch Fastify API:  pnpm -C platform/api dev
echo To inspect Database:    pnpm -C platform/api exec prisma studio
echo ==============================================================================
