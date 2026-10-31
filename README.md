# 🔒 PesanRahasia — Enterprise Edition (PostgreSQL + Docker + VOC ML Skema C + PWA & Web Push)

Aplikasi web pengirim pesan rahasia sekali baca (**Self-Destructing End-to-End Encrypted Secret Message**) dengan database **PostgreSQL**, proteksi **Anti-Screenshot**, login wajib **Akun Gmail (`@gmail.com`)**, **Trial Gratis 10x Pesan**, **Lisensi Berbayar Per-Akun Terintegrasi `vocml.vocpos.id` (Skema C)**, **PWA Installable (Android/iOS/Desktop)**, dan **Web Push Notification Real-Time ke HP Admin**.

---

## ✨ Fitur Utama Terbaru

1. **Enkripsi End-to-End (AES-256-GCM) & Atomic Burn-After-Reading**
   - Pesan dienkripsi di browser pengirim sebelum dikirim ke server, dan langsung dihapus permanen dari PostgreSQL (`DELETE ... RETURNING`) begitu penerima membukanya satu kali.
2. **Proteksi Anti-Screenshot Berlapis**
   - Mode **Spotlight (Lubang Intip)** & **Press-and-Hold**, sensor blur otomatis saat pindah tab/kehilangan fokus, pemblokir tombol screenshot, serta dynamic diagonal watermark.
3. **Login Wajib Gmail + Trial Gratis 10x Pesan (`Skema C VOC ML`)**
   - Setiap pendaftar Gmail baru otomatis mendapatkan **Machine ID unik (`GMAIL-XXXX-XXXX-XXXX`)** yang didaftarkan ke **`https://vocml.vocpos.id`**.
   - Pendaftar baru langsung mendapat **Trial Gratis 10x Pesan**. Setelah 10 pesan habis, akun otomatis terkunci dengan layar tagihan lisensi & QRIS dinamis dari `vocml.vocpos.id`.
4. **Progressive Web App (PWA) & Web Push Notification ke HP Admin**
   - Aplikasi utama (`/`) dan Dashboard Admin (`/admin`) dapat di-install sebagai aplikasi native (PWA) di Android, iPhone (iOS), maupun Desktop.
   - Setiap ada pendaftar Gmail baru atau pengguna yang menghabiskan kuota Trial 10x, server mengirim **Web Push Notification (RFC 8291 + VAPID ES256)** langsung ke HP Admin.
5. **Responsive Admin Control Center (`/admin`)**
   - Memantau seluruh pengguna Gmail, sisa kuota Trial 10x, status lisensi VOC ML, riwayat aktivitas link pesan, export CSV, sinkronisasi lisensi 1-klik, dan tampilan Mobile Card View otomatis di layar HP.

---

## 📂 Struktur Folder Proyek

```text
PesanRahasia/
├── client-sdk/                  <-- SDK Lisensi VOC ML (Ed25519)
│   ├── vocml-client.js
│   └── get-machine-id.ps1
├── src/
│   ├── db.js                    <-- Modul PostgreSQL (Users, Sessions, Secret Messages, Logs, Push Subscriptions)
│   ├── license.js               <-- Lisensi Skema C Per-Gmail Account + Trial 10x Pesan Gratis
│   └── webpush.js               <-- Modul Web Push Notification (VAPID ES256 + RFC 8291) & Generator Ikon PWA
├── public/                      <-- Frontend E2EE, PWA & Admin Dashboard Responsif
│   ├── index.html               <-- Halaman Utama Aplikasi
│   ├── admin.html               <-- Halaman Rahasia Dashboard Admin (/admin)
│   ├── style.css
│   ├── app.js
│   ├── sw.js                    <-- Service Worker PWA & Web Push Listener
│   ├── manifest.json            <-- Web App Manifest Pengguna
│   ├── admin-manifest.json      <-- Web App Manifest Khusus Admin PWA
│   └── favicon.svg              <-- Logo Vektor Resmi PesanRahasia
├── .github/
│   └── workflows/
│       └── build-and-push.yml   <-- Otomasi CI/CD Build & Push ke ghcr.io/tirta7/pesanrahasia:latest
├── INSTALLER_CLIENT/            <-- Paket One-Click Installer untuk Klien / Server Cabang
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── INSTALL.bat
│   ├── UPDATE.bat
│   ├── BUKA_APLIKASI.bat
│   └── STOP.bat
├── Dockerfile                   <-- Multi-stage build Node 20 Alpine
├── docker-compose.yml           <-- Stack Docker PostgreSQL 16 + App (Port 3006)
├── .env                         <-- Konfigurasi environment
└── server.js                    <-- Server utama HTTP + API + Static & PWA Handler
```

---

## 🚀 Cara Menjalankan

### 1. Menggunakan Docker + PostgreSQL
```bash
docker compose up -d --build
```

### 2. Menggunakan Node.js + Local PostgreSQL
```bash
npm install
npm start
```
- **Aplikasi Utama**: `http://localhost:3006` / `https://privatmassage.vocpos.id`
- **Dashboard Admin (Rahasia)**: `http://localhost:3006/admin` / `https://privatmassage.vocpos.id/admin`
- **Server Lisensi VOC ML**: `https://vocml.vocpos.id`
