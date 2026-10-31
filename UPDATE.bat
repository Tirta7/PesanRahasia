@echo off
cd /d "%~dp0"
title Update Versi Aplikasi PesanRahasia
echo Mengunduh pembaruan fitur terbaru dari GitHub Container Registry...
docker pull postgres:16-alpine
docker pull ghcr.io/tirta7/pesanrahasia:latest >nul 2>&1
if %errorlevel% equ 0 (
    docker compose up -d
) else (
    docker compose up -d --build
)
echo Pembaruan berhasil diterapkan!
timeout /t 3 >nul
start http://localhost:3006

