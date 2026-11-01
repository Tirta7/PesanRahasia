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

export function getLicenseStatus() {
  return {
    mode: 'per-gmail-account',
    serverUrl: VOCML_SERVER_URL,
    product: VOCML_PRODUCT,
    allowed: true
  };
}

export function renderLockedScreenHTML(status) {
  return `<!DOCTYPE html><html lang="id"><body><h1>${status.reason || 'Terkunci'}</h1></body></html>`;
}
