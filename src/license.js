import { checkLicense, resolveMachineId } from '../client-sdk/vocml-client.js';

// Status lisensi dalam memory
let licenseStatus = {
  allowed: process.env.VOCML_ENABLED !== 'true',
  reason: process.env.VOCML_ENABLED === 'true' ? 'Sedang memeriksa lisensi...' : 'Aktif',
  machineId: resolveMachineId(process.env.VOCML_MACHINE_ID),
  storeName: process.env.STORE_NAME || 'PesanRahasia VOCPOS',
  expiresAt: null
};

// Konfigurasi Lisensi VOC ML
const VOCML_CONFIG = {
  enabled: process.env.VOCML_ENABLED === 'true',
  serverUrl: process.env.VOCML_SERVER_URL || 'https://lisensi.vocpos.id',
  product: process.env.VOCML_PRODUCT || 'pesan-rahasia',
  storeName: process.env.STORE_NAME || 'PesanRahasia VOCPOS',
  machineId: process.env.VOCML_MACHINE_ID || null,
  publicKeyPem:
    process.env.VOCML_PUBLIC_KEY ||
    `-----BEGIN PUBLIC KEY-----
PASTE_PUBLIC_KEY_VOCML_MILIK_ANDA_DI_SINI
-----END PUBLIC KEY-----`,
  cacheFile: process.env.VOCML_CACHE_FILE || './data/license-cache.json',
  appVersion: '1.0.0'
};

let pollTimer = null;

export async function runLicenseVerification() {
  try {
    const res = await checkLicense(VOCML_CONFIG);
    licenseStatus = {
      allowed: res.allowed,
      reason: res.reason || (res.allowed ? 'Aktif' : 'Lisensi Tidak Sah'),
      machineId: res.machineId || VOCML_CONFIG.machineId,
      storeName: VOCML_CONFIG.storeName,
      expiresAt: res.expiresAt || null
    };

    if (res.allowed) {
      if (VOCML_CONFIG.enabled) {
        console.log(`[VOCML] ✅ Lisensi Valid untuk "${VOCML_CONFIG.storeName}". Cek ulang dalam 3 jam.`);
      }
      scheduleNextCheck(3 * 60 * 60 * 1000); // 3 Jam
    } else {
      console.warn(`[VOCML] 🔒 APLIKASI TERKUNCI: ${res.reason}. Cek ulang dalam 5 detik...`);
      scheduleNextCheck(5 * 1000); // 5 Detik
    }
  } catch (err) {
    licenseStatus.allowed = false;
    licenseStatus.reason = `Gagal terhubung ke server lisensi: ${err.message}`;
    scheduleNextCheck(5 * 1000);
  }
}

function scheduleNextCheck(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(runLicenseVerification, delayMs).unref();
}

// Mulai cek lisensi saat server start
runLicenseVerification();

// HTML Layar Merah (Aplikasi Terkunci)
export function renderLockedScreenHTML(status) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aplikasi Terkunci - Lisensi Diperlukan</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #7f1d1d; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #991b1b; border: 2px solid #ef4444; border-radius: 16px; max-width: 540px; width: 100%; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; }
    .icon { font-size: 54px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; color: #fecaca; }
    p.desc { font-size: 14px; color: #fca5a5; margin-bottom: 24px; line-height: 1.5; }
    .info-box { background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px; margin-bottom: 24px; text-align: left; font-size: 13px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; gap: 12px; }
    .info-row:last-child { margin-bottom: 0; }
    .label { color: #fca5a5; font-weight: 600; flex-shrink: 0; }
    .value { color: #fff; font-family: monospace; font-weight: 700; word-break: break-all; text-align: right; }
    .pulse { display: inline-block; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; margin-right: 6px; animation: blink 1s infinite; }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .footer { font-size: 11px; color: #fca5a5; }
  </style>
  <script>
    // Auto refresh setiap 5 detik agar langsung terbuka jika sudah diaktifkan di VOC ML
    setTimeout(() => { window.location.reload(); }, 5000);
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>Aplikasi Terkunci</h1>
    <p class="desc">Aplikasi ini membutuhkan lisensi aktif dari server pusat VOC ML. Halaman ini akan otomatis terbuka setelah lisensi disetujui.</p>
    
    <div class="info-box">
      <div class="info-row">
        <span class="label">Outlet / Toko:</span>
        <span class="value">${status.storeName}</span>
      </div>
      <div class="info-row">
        <span class="label">Alasan:</span>
        <span class="value" style="color:#fecaca;">${status.reason}</span>
      </div>
      <div class="info-row">
        <span class="label">Machine ID:</span>
        <span class="value">${status.machineId}</span>
      </div>
    </div>

    <p class="footer"><span class="pulse"></span>Memeriksa status aktivasi otomatis setiap 5 detik...</p>
  </div>
</body>
</html>`;
}

export function getLicenseStatus() {
  return licenseStatus;
}
