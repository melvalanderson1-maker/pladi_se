@echo off
cd /d "%~dp0"

echo ========================================
echo     INICIANDO PLADIBOT
echo ========================================

REM ── 1. Verificar Docker ──────────────────
echo Verificando Docker...
:wait_docker
docker info >nul 2>&1
if errorlevel 1 (
    echo   Docker no listo, esperando...
    timeout /t 5 /nobreak > nul
    goto wait_docker
)
echo [OK] Docker listo.

REM ── 2. Obtener IP local ──────────────────
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr "192.168"') do (
    set HOST_IP=%%a
    goto :got_ip
)
:got_ip
set HOST_IP=%HOST_IP: =%
echo [OK] IP detectada: %HOST_IP%

REM ── 3. Actualizar .env backend ───────────
powershell -Command "(Get-Content '%~dp0backend\.env') -replace 'BACKEND_PUBLIC_URL=.*', 'BACKEND_PUBLIC_URL=http://host.docker.internal:8000' | Set-Content '%~dp0backend\.env'"
echo [OK] .env backend actualizado.

REM ── 4. Limpiar contenedores anteriores ───
echo Limpiando contenedores anteriores...
docker-compose -f "%~dp0docker-compose.yml" down --remove-orphans
echo [OK] Contenedores eliminados.

REM ── 5. Levantar OnlyOffice ───────────────
echo Levantando OnlyOffice...
docker-compose -f "%~dp0docker-compose.yml" up -d --build
echo [OK] Contenedor OnlyOffice iniciado.

REM ── 6. Esperar que OnlyOffice arranque ───
echo Esperando que OnlyOffice este listo (60s)...
:wait_onlyoffice
timeout /t 5 /nobreak > nul
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8080/healthcheck' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo   OnlyOffice iniciando...
    goto wait_onlyoffice
)
echo [OK] OnlyOffice listo.

REM ── 7. Liberar puertos ───────────────────
echo Liberando puertos...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
echo [OK] Puertos liberados.

REM ── 8. Levantar Backend ──────────────────
echo Levantando backend FastAPI...
cd "%~dp0backend"
call venv\Scripts\activate
start "PLADIBOT Backend" cmd /k "uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload"
echo [OK] Backend iniciado.

REM ── 8b. Levantar Scraper SEACE ───────────
echo Levantando scraper SEACE...
cd "%~dp0backend"
call venv\Scripts\activate
start "PLADIBOT Scraper" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && python seace_scraper_completo.py"
echo [OK] Scraper SEACE iniciado en puerto 4000.

REM ── 9. Levantar Frontend ─────────────────
echo Levantando frontend Next.js...
cd "%~dp0frontend"
timeout /t 2 /nobreak > nul
start "PLADIBOT Frontend" cmd /k "npm run dev -- --hostname 0.0.0.0"
echo [OK] Frontend iniciado.

cd "%~dp0"

echo.
echo ========================================
echo PLADIBOT corriendo en:
echo   Frontend  : http://%HOST_IP%:3000
echo   Backend   : http://%HOST_IP%:8000
echo   OnlyOffice: http://%HOST_IP%:8080
echo   Scraper   : http://%HOST_IP%:4000/docs
echo ========================================
pause