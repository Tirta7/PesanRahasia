@echo off
cd /d "%~dp0"
docker compose down
echo Aplikasi PesanRahasia ^& PostgreSQL berhasil dimatikan.
pause

