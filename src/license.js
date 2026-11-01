import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyToken } from '../client-sdk/vocml-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pastikan .env dimuat terlebih dahulu
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

const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADenKScMcRxd/GFPnwHLgO26Y3mKwNmtyUR1KPQgLTFI=
-----END PUBLIC KEY-----`;

export const VOCML_SERVER_URL = (process.env.VOCML_SERVER_URL || 'https://vocml.vocpos.id')
  .replace('lisensi.vocpos.id', 'vocml.vocpos.id')
  .replace(/\/+$/, '');

export const VOCML_PRODUCT = process.env.VOCML_PRODUCT || 'messagerahasia';

const VOCML_PUBLIC_KEY = process.env.VOCML_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
export const FREE_TRIAL_LIMIT = Number(process.env.FREE_TRIAL_LIMIT) || 3;

// Cache per akun Gmail agar tahan jika koneksi internet ke vocml.vocpos.id sempat terputus (TTL: 60 detik)
const userLicenseCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

/**
 * Menghasilkan Machine ID unik & deterministik untuk setiap alamat email Gmail.
 * Contoh: tirtaaditya716@gmail.com -> GMAIL-8F4A-29C1-7B3E
 */
export function emailToMachineId(email) {
  const clean = String(email || '').trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(`pesanrahasia:${clean}`).digest('hex').slice(0, 12).toUpperCase();
  return `GMAIL-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

/**
 * Memeriksa & mendaftarkan lisensi per Akun Gmail langsung ke server https://vocml.vocpos.id
 * Setiap user Gmail baru otomatis mendapatkan Trial Gratis 10x Pesan selama status VOC ML masih 'pending'.
 * Begitu 10x pesan gratis habis (messagesCreated >= 10), user wajib mengaktifkan lisensi berbayar.
 */
export async function verifyUserAccountLicense({ email, name, messagesCreated = 0, licenseStatus = null, bypassCache = false }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || cleanEmail.split('@')[0]).trim();
  const machineId = emailToMachineId(cleanEmail);
  const storeName = `${cleanName} (${cleanEmail})`;
  const appVersion = '1.0.0';
  const headers = { 'Content-Type': 'application/json' };

  const trialUsed = Math.max(0, Number(messagesCreated) || 0);
  const trialRemaining = Math.max(0, FREE_TRIAL_LIMIT - trialUsed);

  if (!bypassCache) {
    const cached = userLicenseCache.get(cleanEmail);
    const ttl = (cached && cached.vocmlStatus === 'active') ? CACHE_TTL_MS : 3000;
    if (cached && Date.now() - cached.checkedAt < ttl) {
      return cached;
    }
  }

  try {
    const qs = new URLSearchParams({
      machine_id: machineId,
      product: VOCML_PRODUCT,
      app_version: appVersion
    });

    let res = await fetch(`${VOCML_SERVER_URL}/api/v1/check?${qs}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    // Jika akun Gmail ini belum pernah terdaftar di vocml.vocpos.id -> Daftarkan otomatis!
    if (res.status === 404) {
      res = await fetch(`${VOCML_SERVER_URL}/api/v1/register`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          machine_id: machineId,
          product: VOCML_PRODUCT,
          store_name: storeName,
          app_version: appVersion
        })
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json();
    const payload = verifyToken(body.token, VOCML_PUBLIC_KEY) || body;
    const vocmlStatus = payload.status || body.status || 'pending';
    const expiresAt = payload.expires_at ?? body.expires_at ?? null;
    const daysLeft = body.days_left ?? payload.days_left ?? null;
    const billing = body.billing || null;

    // Deteksi kuota trial langsung dari server VOC ML (VOC ML adalah Single Source of Truth)
    const vocmlTrial = body.trial || payload.trial || null;
    const configuredLimit = Number(process.env.FREE_TRIAL_LIMIT) || 3;
    const serverTrialQuota = vocmlTrial?.quota != null ? Number(vocmlTrial.quota) : configuredLimit;
    const serverTrialUsed = vocmlTrial?.used != null ? Number(vocmlTrial.used) : trialUsed;
    const serverTrialRemaining = vocmlTrial?.remaining != null
      ? Number(vocmlTrial.remaining)
      : Math.max(0, serverTrialQuota - serverTrialUsed);

    let allowed = false;
    let isTrial = false;
    let status = vocmlStatus;
    let reason = 'Menunggu aktivasi lisensi dari Admin';

    if (vocmlStatus === 'active' || vocmlStatus === 'expiring') {
      allowed = true;
      isTrial = false;
      status = vocmlStatus;
      reason = vocmlStatus === 'expiring' ? 'Lisensi Pro Aktif (Segera Berakhir)' : 'Lisensi Pro Aktif (Unlimited)';
    } else if (vocmlStatus === 'trial' || (vocmlStatus === 'pending' && vocmlTrial)) {
      if (serverTrialRemaining > 0) {
        allowed = true;
        isTrial = true;
        status = 'trial';
        reason = `Akun Trial: Sisa ${serverTrialRemaining}x kirim pesan rahasia`;
      } else {
        allowed = false;
        isTrial = false;
        status = 'trial_exhausted';
        reason = `Kuota Trial Gratis ${serverTrialQuota}x pesan telah habis. Silakan aktifkan lisensi Pro.`;
      }
    } else if (vocmlStatus === 'pending') {
      if (trialRemaining > 0) {
        allowed = true;
        isTrial = true;
        status = 'trial';
        reason = `Akun Trial: Sisa ${trialRemaining}x kirim pesan rahasia`;
      } else {
        allowed = false;
        isTrial = false;
        status = 'trial_exhausted';
        reason = `Kuota Trial Gratis ${FREE_TRIAL_LIMIT}x pesan telah habis (${trialUsed}/${FREE_TRIAL_LIMIT} terpakai). Silakan aktifkan lisensi Pro.`;
      }
    } else if (vocmlStatus === 'locked' || body.locked || body.is_locked) {
      allowed = false;
      isTrial = false;
      status = 'locked';
      reason = payload.lock_reason || body.lock_reason || 'Akun Anda sedang dikunci oleh Admin';
    } else if (vocmlStatus === 'expired') {
      allowed = false;
      isTrial = false;
      status = 'expired';
      reason = 'Masa berlaku lisensi akun Anda telah habis';
    }

    const result = {
      allowed,
      isTrial,
      status,
      vocmlStatus,
      reason,
      machineId,
      storeName,
      email: cleanEmail,
      expiresAt,
      daysLeft,
      trialLimit: serverTrialQuota,
      trialUsed: serverTrialUsed,
      trialRemaining: serverTrialRemaining,
      trial: {
        ...(vocmlTrial || {}),
        enabled: true,
        quota: serverTrialQuota,
        used: serverTrialUsed,
        remaining: serverTrialRemaining,
        is_trial: isTrial
      },
      licenseKey: payload.license_key || body.license_key || null,
      billing,
      checkedAt: Date.now()
    };

    userLicenseCache.set(cleanEmail, result);
    return result;
  } catch (err) {
    console.warn(`[VOC ML] Gagal menghubungi ${VOCML_SERVER_URL}: ${err.message}`);
    const cached = userLicenseCache.get(cleanEmail);
    if (cached) {
      // PERTAHANKAN status lisensi terakhir yang sah dari VOC ML (apapun statusnya: active/locked/expired/trial)
      // Jangan pernah ubah status 'expired' / 'locked' menjadi 'trial' saat offline atau rate-limited!
      return { ...cached, offline: true };
    }

    // Jika belum ada cache di memori, periksa status lisensi dari database pengguna
    const isKnownLocked = licenseStatus && ['expired', 'locked', 'trial_exhausted', 'inactive'].includes(licenseStatus);
    if (isKnownLocked) {
      return {
        allowed: false,
        isTrial: false,
        status: licenseStatus,
        vocmlStatus: 'offline',
        reason: 'Masa berlaku lisensi akun Anda telah habis / belum aktif. Silakan lakukan pembayaran perpanjangan.',
        machineId,
        storeName,
        email: cleanEmail,
        expiresAt: null,
        daysLeft: 0,
        trialLimit: FREE_TRIAL_LIMIT,
        trialUsed,
        trialRemaining: 0,
        trial: {
          enabled: false,
          quota: FREE_TRIAL_LIMIT,
          used: FREE_TRIAL_LIMIT,
          remaining: 0,
          is_trial: false
        },
        billing: null,
        offline: true
      };
    }

    // Hanya berikan trial jika akun baru dan belum pernah berstatus expired/locked
    if (trialRemaining > 0 && licenseStatus !== 'expired' && licenseStatus !== 'locked' && licenseStatus !== 'trial_exhausted') {
      return {
        allowed: true,
        isTrial: true,
        status: 'trial',
        vocmlStatus: 'pending',
        reason: `Akun Trial: Sisa ${trialRemaining}x kirim pesan rahasia`,
        machineId,
        storeName,
        email: cleanEmail,
        expiresAt: null,
        daysLeft: null,
        trialLimit: FREE_TRIAL_LIMIT,
        trialUsed,
        trialRemaining,
        trial: {
          enabled: true,
          quota: FREE_TRIAL_LIMIT,
          used: trialUsed,
          remaining: trialRemaining,
          is_trial: true
        },
        billing: null,
        offline: true
      };
    }

    return {
      allowed: false,
      isTrial: false,
      status: 'trial_exhausted',
      vocmlStatus: 'offline',
      reason: `Kuota Trial Gratis ${FREE_TRIAL_LIMIT}x pesan telah habis. Silakan aktifkan lisensi Pro.`,
      machineId,
      storeName,
      email: cleanEmail,
      expiresAt: null,
      daysLeft: null,
      trialLimit: FREE_TRIAL_LIMIT,
      trialUsed,
      trialRemaining: 0,
      trial: {
        enabled: true,
        quota: FREE_TRIAL_LIMIT,
        used: FREE_TRIAL_LIMIT,
        remaining: 0,
        is_trial: true
      },
      billing: null,
      offline: true
    };
  }
}

/**
 * Mengonsumsi 1 kuota trial di server VOC ML saat pengguna membuat pesan rahasia.
 * Endpoint: POST /api/v1/trial/consume
 */
export async function consumeTrialQuota({ email, machineId }) {
  const mId = machineId || emailToMachineId(email);
  try {
    const res = await fetch(`${VOCML_SERVER_URL}/api/v1/trial/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machine_id: mId,
        product: VOCML_PRODUCT
      }),
      signal: AbortSignal.timeout(6000)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || data.allowed === false) {
      invalidateUserLicenseCache(email);
      return { ok: false, exhausted: true, message: data.message || data.error || 'Kuota Trial telah habis.' };
    }
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    invalidateUserLicenseCache(email);
    return { ok: true, trial: data.trial, message: data.message };
  } catch (err) {
    console.warn('[Trial Consume] Gagal menghubungi VOC ML:', err.message);
    return { ok: true, offline: true };
  }
}

/**
 * Klaim voucher promo di server VOC ML.
 * Endpoint: POST /api/v1/voucher/claim
 */
export async function claimVoucher({ email, machineId, code }) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    return { ok: false, error: 'Masukkan kode voucher terlebih dahulu.' };
  }
  const mId = machineId || emailToMachineId(email);
  try {
    const res = await fetch(`${VOCML_SERVER_URL}/api/v1/voucher/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machine_id: mId,
        product: VOCML_PRODUCT,
        code: cleanCode
      }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || `Kode voucher tidak valid (HTTP ${res.status}).` };
    }
    invalidateUserLicenseCache(email);
    return {
      ok: true,
      message: data.message || 'Kode voucher berhasil digunakan!',
      type: data.type || (data.free_days ? 'free_days' : data.trial_quota ? 'trial_quota' : 'discount_nominal'),
      data
    };
  } catch (err) {
    console.error('[Voucher Claim] Error:', err.message);
    return { ok: false, error: 'Gagal menghubungi server lisensi untuk klaim voucher.' };
  }
}

/**
 * Mengambil data tagihan & paket billing dinamis dari server VOC ML.
 * Endpoint: GET /api/v1/billing
 */
export async function getVocmlBilling({ email, machineId }) {
  const mId = machineId || emailToMachineId(email);
  try {
    const res = await fetch(`${VOCML_SERVER_URL}/api/v1/billing?machine_id=${encodeURIComponent(mId)}&product=${encodeURIComponent(VOCML_PRODUCT)}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data;
  } catch {
    return null;
  }
}

/**
 * Mengambil pesan siaran / notifikasi admin VOC ML untuk client ini (Cache TTL: 15 detik)
 * Endpoint: GET /api/v1/messages?machine_id={mId}&product={product}
 */
const vocmlMessagesCache = new Map();
export async function getVocmlMessages({ email, machineId }) {
  const mId = machineId || emailToMachineId(email);
  const cacheKey = `${mId}:${VOCML_PRODUCT}`;
  const cached = vocmlMessagesCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 15000) {
    return cached.messages;
  }
  try {
    const res = await fetch(`${VOCML_SERVER_URL}/api/v1/messages?machine_id=${encodeURIComponent(mId)}&product=${encodeURIComponent(VOCML_PRODUCT)}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return cached ? cached.messages : [];
    const data = await res.json().catch(() => ({}));
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    vocmlMessagesCache.set(cacheKey, { time: Date.now(), messages: msgs });
    return msgs;
  } catch {
    return cached ? cached.messages : [];
  }
}

export function invalidateUserLicenseCache(email) {
  if (!email) {
    userLicenseCache.clear();
    return;
  }
  userLicenseCache.delete(String(email).trim().toLowerCase());
}

let hostLicenseState = {
  allowed: true,
  status: 'unmanaged',
  reason: '',
  machineId: (process.env.VOCML_MACHINE_ID || '').trim(),
  storeName: (process.env.STORE_NAME || 'PklPesanRahasia1').trim(),
  checkedAt: 0,
  billing: null
};

/**
 * Memeriksa lisensi tingkat server / komputer (Machine ID induk dari .env)
 * Jika diatur di VOC ML sebagai 'locked' atau 'expired', seluruh situs langsung terkunci.
 */
export async function refreshHostLicense({ bypassCache = false } = {}) {
  const machineId = (process.env.VOCML_MACHINE_ID || '').trim();
  const enabled = process.env.VOCML_ENABLED === 'true';

  if (!enabled || !machineId) {
    hostLicenseState = {
      allowed: true,
      status: 'unmanaged',
      reason: '',
      machineId,
      storeName: (process.env.STORE_NAME || 'PklPesanRahasia1').trim(),
      checkedAt: Date.now(),
      billing: null
    };
    return hostLicenseState;
  }

  // Cache 3 detik agar responsif terhadap perubahan status di VOC ML
  if (!bypassCache && hostLicenseState.checkedAt && (Date.now() - hostLicenseState.checkedAt < 3000)) {
    return hostLicenseState;
  }

  try {
    const qs = new URLSearchParams({
      machine_id: machineId,
      product: VOCML_PRODUCT,
      app_version: '1.0.0'
    });

    let res = await fetch(`${VOCML_SERVER_URL}/api/v1/check?${qs}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });

    if (res.status === 404) {
      res = await fetch(`${VOCML_SERVER_URL}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({
          machine_id: machineId,
          product: VOCML_PRODUCT,
          store_name: process.env.STORE_NAME || 'PklPesanRahasia1',
          app_version: '1.0.0'
        })
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json();
    const payload = verifyToken(body.token, VOCML_PUBLIC_KEY) || body;
    const status = payload.status || body.status || 'pending';
    const allowed = (status === 'active' || status === 'expiring');
    const reason = payload.lock_reason || body.lock_reason || (
      status === 'locked' ? 'Aplikasi dikunci oleh admin VOC ML' :
      status === 'expired' ? 'Masa berlaku lisensi server telah habis' :
      status === 'pending' ? 'Menunggu aktivasi lisensi dari admin VOC ML' : ''
    );

    hostLicenseState = {
      allowed,
      status,
      reason,
      machineId,
      storeName: process.env.STORE_NAME || 'PklPesanRahasia1',
      expiresAt: payload.expires_at ?? body.expires_at ?? null,
      daysLeft: body.days_left ?? payload.days_left ?? null,
      billing: body.billing || null,
      checkedAt: Date.now()
    };
    return hostLicenseState;
  } catch (err) {
    console.warn(`[VOC ML Host] Gagal memeriksa lisensi server induk: ${err.message}`);
    // Jangan izinkan jika sebelumnya sudah terkunci
    return { ...hostLicenseState, offline: true };
  }
}

export function getLicenseStatus() {
  const enabled = process.env.VOCML_ENABLED === 'true';
  const machineId = (process.env.VOCML_MACHINE_ID || '').trim();
  if (!enabled || !machineId) {
    return {
      mode: 'per-gmail-account',
      serverUrl: VOCML_SERVER_URL,
      product: VOCML_PRODUCT,
      allowed: true
    };
  }
  return {
    ...hostLicenseState,
    mode: 'dual-layer',
    serverUrl: VOCML_SERVER_URL,
    product: VOCML_PRODUCT
  };
}

export function renderLockedScreenHTML(status) {
  const storeName = status.storeName || process.env.STORE_NAME || 'Server PesanRahasia';
  const machineId = status.machineId || process.env.VOCML_MACHINE_ID || '-';
  const reason = status.reason || 'Aplikasi terkunci menunggu aktivasi lisensi dari admin.';
  const billing = status.billing || null;
  const packages = billing?.packages || [];
  const defaultQris = billing?.qris_image_url || '';
  const defaultAmount = billing?.amount_text || '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aplikasi Terkunci — VOC ML</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top, #1e0909 0%, #0c0404 100%);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .lock-card {
      background: rgba(26, 12, 12, 0.95);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 20px;
      padding: 32px 28px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(239, 68, 68, 0.25);
      backdrop-filter: blur(12px);
    }
    .lock-icon-wrap {
      width: 68px;
      height: 68px;
      margin: 0 auto 18px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
      50% { transform: scale(1.05); box-shadow: 0 0 20px 4px rgba(239, 68, 68, 0.2); }
    }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fee2e2; margin-bottom: 8px; }
    .desc { font-size: 0.9rem; color: #cbd5e1; margin-bottom: 22px; line-height: 1.5; }
    .info-box {
      background: rgba(15, 6, 6, 0.75);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 20px;
      text-align: left;
      font-size: 0.85rem;
    }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #94a3b8; }
    .info-val { color: #f8fafc; font-weight: 600; text-align: right; }
    .machine-badge {
      font-family: monospace;
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      padding: 2px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .status-alert {
      background: rgba(239, 68, 68, 0.2);
      border-left: 4px solid #ef4444;
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 0.85rem;
      text-align: left;
    }
    .qris-section {
      background: #ffffff;
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 20px;
      color: #0f172a;
    }
    .qris-img {
      max-width: 220px;
      width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 10px auto;
      display: block;
    }
    .pkg-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
      justify-content: center;
    }
    .pkg-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #e2e8f0;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .pkg-btn.active {
      background: #10b981;
      border-color: #10b981;
      color: #ffffff;
      font-weight: 600;
    }
    .btn-action {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      border: none;
      padding: 13px 20px;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      width: 100%;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 12px;
    }
    .btn-action:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .voucher-form { display: flex; gap: 8px; margin-top: 14px; }
    .voucher-input {
      flex: 1;
      background: rgba(15, 6, 6, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 9px 12px;
      color: white;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    .voucher-btn {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      padding: 9px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .poll-hint { font-size: 0.78rem; color: #94a3b8; margin-top: 14px; }
    .poll-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f59e0b;
      margin-right: 6px;
      animation: blink 1.2s infinite;
    }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  </style>
</head>
<body>
  <div class="lock-card">
    <div class="lock-icon-wrap">🔒</div>
    <h1>Aplikasi Terkunci</h1>
    <p class="desc">Aplikasi ini membutuhkan lisensi aktif dari server pusat <strong>VOC ML</strong>. Halaman akan otomatis terbuka setelah lisensi disetujui / diaktifkan.</p>

    <div class="status-alert">
      <strong>Status:</strong> ${reason}
    </div>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Outlet / Server:</span>
        <span class="info-val">${storeName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Machine ID:</span>
        <span class="info-val"><span class="machine-badge" onclick="navigator.clipboard.writeText('${machineId}'); alert('Machine ID disalin!');">${machineId}</span></span>
      </div>
    </div>

    ${packages.length > 0 ? `
    <div class="pkg-selector" id="pkg-list">
      ${packages.map((pkg, idx) => `
        <button type="button" class="pkg-btn ${idx === 0 ? 'active' : ''}" onclick="selectPackage(${idx})">
          ${pkg.label || pkg.name}
        </button>
      `).join('')}
    </div>
    ` : ''}

    ${defaultQris ? `
    <div class="qris-section">
      <div style="font-size:0.8rem; font-weight:600; text-transform:uppercase; color:#64748b;">Tagihan Perpanjangan Lisensi</div>
      <div id="qris-amount" style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:4px 0;">${defaultAmount}</div>
      <img id="qris-img" class="qris-img" src="${defaultQris}" alt="QRIS VOC ML" />
      <div style="font-size:0.75rem; color:#64748b;">Scan QRIS di atas dengan m-Banking / E-Wallet</div>
    </div>
    ` : ''}

    <button type="button" id="btn-check" class="btn-action" onclick="checkStatusInstan()">
      ✅ Saya Sudah Bayar / Buka Sekarang
    </button>

    <div class="voucher-form">
      <input type="text" id="voucher-input" class="voucher-input" placeholder="KODE VOUCHER PROMO..." />
      <button type="button" class="voucher-btn" onclick="claimVoucher()">Gunakan</button>
    </div>
    <div id="voucher-msg" style="font-size:0.8rem; margin-top:8px; display:none;"></div>

    <div class="poll-hint">
      <span class="poll-dot"></span>Memeriksa status aktivasi otomatis setiap 2 detik...
    </div>
  </div>

  <script>
    const packagesData = ${JSON.stringify(packages)};
    function selectPackage(idx) {
      document.querySelectorAll('.pkg-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
      const pkg = packagesData[idx];
      if (!pkg) return;
      const img = document.getElementById('qris-img');
      const amt = document.getElementById('qris-amount');
      if (img && pkg.qris_image_url) img.src = pkg.qris_image_url;
      if (amt && pkg.amount_text) amt.textContent = pkg.amount_text;
    }

    async function checkStatusInstan() {
      const btn = document.getElementById('btn-check');
      if (btn) { btn.innerText = '⏳ Memeriksa...'; btn.disabled = true; }
      try {
        const res = await fetch('/api/license-status?fresh=1');
        const data = await res.json();
        if (data.allowed) {
          alert('🎉 Lisensi aktif! Membuka aplikasi...');
          location.reload();
          return;
        }
        alert('⚠️ Status masih: ' + (data.reason || 'Terkunci di VOC ML. Pastikan sudah klik Generate Key di VOC ML.'));
      } catch {
        alert('Gagal menghubungi server.');
      } finally {
        if (btn) { btn.innerText = '✅ Saya Sudah Bayar / Buka Sekarang'; btn.disabled = false; }
      }
    }

    async function claimVoucher() {
      const inp = document.getElementById('voucher-input');
      const msg = document.getElementById('voucher-msg');
      const code = (inp?.value || '').trim();
      if (!code) return;
      msg.style.display = 'block';
      msg.style.color = '#94a3b8';
      msg.innerText = 'Memverifikasi voucher...';
      try {
        const res = await fetch('/api/license/voucher/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const d = await res.json();
        if (res.ok) {
          msg.style.color = '#10b981';
          msg.innerText = d.message || 'Voucher berhasil! Membuka aplikasi...';
          setTimeout(() => location.reload(), 1000);
        } else {
          msg.style.color = '#ef4444';
          msg.innerText = d.error || 'Voucher tidak valid.';
        }
      } catch {
        msg.style.color = '#ef4444';
        msg.innerText = 'Gagal menghubungi server.';
      }
    }

    // Auto-polling status lisensi server setiap 2 detik
    setInterval(async () => {
      try {
        const res = await fetch('/api/license-status');
        const data = await res.json();
        if (data.allowed) {
          location.reload();
        }
      } catch {}
    }, 2000);
  </script>
</body>
</html>`;
}
