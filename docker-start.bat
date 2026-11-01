@echo off
echo ===================================================
echo   Menjalankan PesanRahasia di Docker (Windows PC)
echo ===================================================

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Docker belum terinstall atau Docker Desktop belum dibuka!
    echo Silakan buka aplikasi Docker Desktop terlebih dahulu.
    pause
    exit /b 1
)

echo Menyiapkan container (App, Database, Cloudflare Tunnel)...
docker compose up -d --build

echo.
echo ===================================================
echo [BERHASIL] PesanRahasia telah berjalan di Docker!
echo Server Lokal : http://localhost:3006
echo Domain Publik: https://message.vocpos.id
echo ===================================================
echo.
pause

