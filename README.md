# 🔒 PesanRahasia — Enterprise Edition (PostgreSQL + Docker + VOC ML + Cloudflare Tunnel)

Aplikasi web pengirim pesan rahasia sekali baca (**Self-Destructing End-to-End Encrypted Secret Message**) dengan database **PostgreSQL**, proteksi **Anti-Screenshot**, otomasi **Docker & GitHub Actions (`ghcr.io`)**, paket **One-Click Installer (`INSTALLER_CLIENT`)**, dan **Sistem Lisensi VOC ML**.

---

## 📂 Struktur Folder Proyek

```text
PesanRahasia/
├── client-sdk/                  <-- SDK Lisensi VOC ML
│   ├── vocml-client.js          <-- Modul verifikasi RSA & HTTP ke server VOC ML
│   └── get-machine-id.ps1       <-- Skrip pembaca Hardware UUID Windows
├── src/
│   ├── db.js                    <-- Modul PostgreSQL (Auto-Migration & Atomic DELETE RETURNING)
│   └── license.js               <-- Middleware Pengunci Lisensi & Layar Merah 403
├── public/                      <-- Frontend E2EE (AES-256-GCM) & Anti-Screenshot
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .github/
│   └── workflows/
│       └── build-and-push.yml   <-- Otomasi CI/CD Build & Push ke ghcr.io
├── INSTALLER_CLIENT/            <-- Paket One-Click Installer untuk Klien / Cabang
│   ├── docker-compose.yml       <-- Menjalankan PostgreSQL 16 + App dari ghcr.io
│   ├── .env.example
│   ├── INSTALL.bat              <-- Klik 2x untuk instalasi otomatis + deteksi Machine ID
│   ├── UPDATE.bat
│   ├── BUKA_APLIKASI.bat
│   ├── STOP.bat
│   └── PANDUAN_KLIEN.txt
├── Dockerfile                   <-- Multi-stage build Node 20 Alpine
├── docker-compose.yml           <-- Stack Docker PostgreSQL 16 + App (Port 3006)
├── .env                         <-- Konfigurasi environment
└── server.js                    <-- Server utama
```

---

## 🗄️ Arsitektur Database PostgreSQL (Atomic Burn-After-Reading)

Saat dijalankan, [src/db.js](file:///Users/tirtaaditya/Documents/PesanRahasia/src/db.js) otomatis membuat database `pesan_rahasia` dan tabel `secret_messages`:

```sql
CREATE TABLE IF NOT EXISTS secret_messages (
  id VARCHAR(32) PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv VARCHAR(64) NOT NULL,
  protection_mode VARCHAR(20) NOT NULL DEFAULT 'spotlight',
  view_timer_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

Ketika penerima mengklik tombol **"Buka & Hancurkan Pesan Sekarang"**, sistem mengeksekusi query atomik satu langkah di PostgreSQL:
```sql
DELETE FROM secret_messages
WHERE id = $1 AND expires_at > NOW()
RETURNING id, ciphertext, iv, protection_mode, view_timer_seconds;
```
Dengan `DELETE ... RETURNING`, baris pesan langsung terhapus dari PostgreSQL pada saat yang sama ketika dibaca, sehingga **mustahil dibuka dua kali**.

---

## 🚀 Cara Menjalankan dengan Docker + PostgreSQL

```bash
docker compose up -d --build
```
Perintah di atas akan menjalankan:
1. **`pesanrahasia_db` (`postgres:16-alpine`)**: Database PostgreSQL dengan volume persisten `pgdata`.
2. **`pesanrahasia_app`**: Server aplikasi di **http://localhost:3006** yang terhubung otomatis ke container PostgreSQL.

---

## 💻 Cara Menjalankan Langsung dengan Node.js + Local PostgreSQL (`Postgres.app`)

Jika Anda menjalankan langsung di macOS menggunakan `Postgres.app`:
```bash
npm install
npm start
```
Aplikasi otomatis membuat database `pesan_rahasia` di PostgreSQL lokal Anda dan berjalan di **http://localhost:3006** dengan domain publik **`https://privatmassage.vocpos.id`**.
