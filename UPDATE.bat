@echo off
cd /d "%~dp0"
title Update Versi Aplikasi PesanRahasia
echo Memeriksa pembaruan fitur terbaru...
docker pull postgres:16-alpine
docker pull ghcr.io/tirtaaditya/pesan-rahasia:latest >nul 2>&1
if %errorlevel% equ 0 (
    docker tag ghcr.io/tirtaaditya/pesan-rahasia:latest pesanrahasia_app:latest
    docker compose up -d
) else (
    docker compose up -d --build
)
echo Pembaruan berhasil diterapkan!
timeout /t 3 >nul
start http://localhost:3006
