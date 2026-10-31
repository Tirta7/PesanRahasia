@echo off
cd /d "%~dp0"
title Update Versi Aplikasi PesanRahasia
echo Mengunduh pembaruan fitur terbaru dari GitHub Container Registry...
docker compose pull
docker compose up -d
echo Pembaruan berhasil diterapkan!
timeout /t 3 >nul
start http://localhost:3006

