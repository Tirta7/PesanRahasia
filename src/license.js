import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLicense } from '../client-sdk/vocml-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pastikan .env dimuat terlebih dahulu sebelum membaca process.env
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
})();

function resolveDefaultMachineId(envMachineId) {
  if (envMachineId && envMachineId.trim() !== '') {
    return envMachineId.trim().toUpperCase();
  }
  const raw = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  return `DEV-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}

const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADenKScMcRxd/GFPnwHLgO26Y3mKwNmtyUR1KPQgLTFI=
-----END PUBLIC KEY-----`;

function getVocmlConfig() {
  return {
    enabled: process.env.VOCML_ENABLED !== 'false',
    serverUrl: (process.env.VOCML_SERVER_URL || 'https://vocml.vocpos.id').replace('lisensi.vocpos.id', 'vocml.vocpos.id'),
    product: ['pos', 'billiard'].includes(process.env.VOCML_PRODUCT) ? process.env.VOCML_PRODUCT : 'pos',
    storeName: process.env.STORE_NAME || 'PesanRahasia VOCPOS',
    machineId: resolveDefaultMachineId(process.env.VOCML_MACHINE_ID),
    publicKeyPem: process.env.VOCML_PUBLIC_KEY || DEFAULT_PUBLIC_KEY,
    cacheFile: process.env.VOCML_CACHE_FILE || './data/license-cache.json',
    appVersion: '1.0.0'
  };
}

const initialCfg = getVocmlConfig();

try {
  fs.mkdirSync(path.dirname(initialCfg.cacheFile), { recursive: true });
} catch {
  // Abaikan jika gagal buat folder
}

let licenseStatus = {
  allowed: !initialCfg.enabled,
  status: initialCfg.enabled ? 'checking' : 'active',
  reason: initialCfg.enabled ? 'Sedang memeriksa & mendaftarkan lisensi ke vocml.vocpos.id...' : 'Aktif (Bypass)',
  machineId: initialCfg.machineId,
  storeName: initialCfg.storeName,
  expiresAt: null
};

let pollTimer = null;

export async function runLicenseVerification() {
  const cfg = getVocmlConfig();

  if (!cfg.enabled) {
    licenseStatus = {
      allowed: true,
      status: 'active',
      reason: 'Aktif',
      machineId: cfg.machineId,
      storeName: cfg.storeName,
      expiresAt: null
    };
    return;
  }

  try {
    const res = await checkLicense(cfg);
    licenseStatus = {
      allowed: Boolean(res.allowed),
      status: res.status || (res.allowed ? 'active' : 'locked'),
      reason: res.reason || (res.allowed ? 'Lisensi Aktif' : 'Menunggu aktivasi lisensi di Dashboard VOC ML'),
      machineId: res.machineId || cfg.machineId,
      storeName: cfg.storeName,
      expiresAt: res.expiresAt || null
    };

    if (res.allowed) {
      console.log(`[VOCML] ✅ Lisensi Valid untuk "${cfg.storeName}" (${cfg.machineId}). Cek ulang dalam 3 jam.`);
      scheduleNextCheck(3 * 60 * 60 * 1000); // 3 Jam
    } else {
      console.warn(`[VOCML] 🔒 APLIKASI TERKUNCI (${res.status}): ${licenseStatus.reason} | Machine ID: ${cfg.machineId}`);
      scheduleNextCheck(5 * 1000); // 5 Detik
    }
  } catch (err) {
    licenseStatus.allowed = false;
    licenseStatus.reason = `Gagal menghubungi server lisensi (${err.message})`;
    scheduleNextCheck(5 * 1000);
  }
}

function scheduleNextCheck(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(runLicenseVerification, delayMs).unref();
}

// Mulai cek & registrasi lisensi saat server start
runLicenseVerification();

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
    setTimeout(() => { window.location.reload(); }, 5000);
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>Aplikasi Terkunci</h1>
    <p class="desc">Aplikasi ini membutuhkan lisensi aktif dari server pusat VOC ML (<strong>vocml.vocpos.id</strong>). Halaman ini akan otomatis terbuka setelah lisensi disetujui.</p>
    
    <div class="info-box">
      <div class="info-row">
        <span class="label">Outlet / Toko:</span>
        <span class="value">${status.storeName}</span>
      </div>
      <div class="info-row">
        <span class="label">Status / Alasan:</span>
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
