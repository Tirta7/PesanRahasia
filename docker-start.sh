#!/bin/bash
set -e

echo "==================================================="
echo "  Menjalankan PesanRahasia di Docker"
echo "==================================================="

if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker belum terinstall atau Docker daemon belum aktif!"
    echo "Silakan pastikan Docker Desktop sudah berjalan."
    exit 1
fi

echo "Membangun & menyalakan container (App, Postgres, Tunnel)..."
docker compose up -d --build

echo ""
echo "==================================================="
echo " [BERHASIL] PesanRahasia telah aktif di Docker!"
echo " Server Lokal : http://localhost:3006"
echo " Domain Publik: https://message.vocpos.id"
echo "==================================================="
echo ""
