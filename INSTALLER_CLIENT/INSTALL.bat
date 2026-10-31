@echo off
setlocal enabledelayedexpansion
title Setup Aplikasi PesanRahasia ^& Lisensi VOC ML (PostgreSQL + Docker)
color 0A
cls

echo ============================================================
echo   SISTEM INSTALASI OTOMATIS SATU KLIK (DOCKER + POSTGRESQL)
echo ============================================================
echo.

:: 1. Self-Elevation Admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b 0
)

cd /d "%~dp0"

:: 2. Cek Docker Desktop
echo [1/5] Memeriksa Docker Desktop...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Docker Desktop belum berjalan!
    echo Silakan buka Docker Desktop terlebih dahulu hingga berstatus 'Running'.
    echo Download: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)
echo [OK] Docker Desktop aktif.

:: 3. Deteksi Machine ID Komputer Windows
echo [2/5] Membaca Machine ID hardware...
set "MACHINE_ID="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Get-CimInstance Win32_ComputerSystemProduct).UUID } catch { (Get-WmiObject Win32_ComputerSystemProduct).UUID }"`) do set "MACHINE_ID=%%i"
if "%MACHINE_ID%"=="" set "MACHINE_ID=WIN-%RANDOM%-%RANDOM%"
echo [OK] Machine ID terdeteksi: %MACHINE_ID%

:: 4. Buat File .env Otomatis
echo [3/5] Menyiapkan konfigurasi outlet ^& PostgreSQL...
if not exist ".env" (
    echo Masukkan Nama Cabang / Toko ini:
    set /p "INPUT_STORE=Nama Outlet (contoh: Cabang Utama VOCPOS): "
    if "!INPUT_STORE!"=="" set "INPUT_STORE=Cabang Baru"

    (
      echo PORT=3006
      echo PUBLIC_BASE_URL=https://privatmassage.vocpos.id
      echo PGUSER=postgres
      echo PGPASSWORD=postgres
      echo PGDATABASE=pesan_rahasia
      echo STORE_NAME=!INPUT_STORE!
      echo VOCML_ENABLED=true
      echo VOCML_MACHINE_ID=%MACHINE_ID%
      echo VOCML_SERVER_URL=https://lisensi.vocpos.id
    ) > .env
    echo [OK] File .env berhasil dibuat dengan Machine ID otomatis.
) else (
    echo [OK] File .env sudah ada.
)

:: 5. Download Image Terbaru & Start PostgreSQL + App
echo.
echo [4/5] Mengunduh versi aplikasi ^& PostgreSQL terbaru dari cloud...
docker compose pull
if %errorlevel% neq 0 (
    echo [WARNING] Gagal pull image cloud, menjalankan dari cache lokal jika ada...
)

echo.
echo [5/5] Memulai kontainer PostgreSQL ^& Aplikasi PesanRahasia...
docker compose down >nul 2>&1
docker compose up -d

echo.
echo Menunggu inisialisasi PostgreSQL ^& aplikasi (10 detik)...
timeout /t 10 /nobreak >nul

echo.
echo ============================================================
echo   INSTALASI SELESAI!
echo   URL Lokal               : http://localhost:3006
echo   Domain Publik           : https://privatmassage.vocpos.id
echo   Machine ID Komputer ini : %MACHINE_ID%
echo   Daftarkan Machine ID di atas pada Dashboard VOC ML Anda.
echo ============================================================
echo.

start http://localhost:3006
pause

