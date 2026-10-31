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

const VOCML_SERVER_URL = (process.env.VOCML_SERVER_URL || 'https://vocml.vocpos.id')
  .replace('lisensi.vocpos.id', 'vocml.vocpos.id')
  .replace(/\/+$/, '');

const VOCML_PRODUCT = ['pos', 'billiard'].includes(process.env.VOCML_PRODUCT)
  ? process.env.VOCML_PRODUCT
  : 'pos';

const VOCML_PUBLIC_KEY = process.env.VOCML_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
export const FREE_TRIAL_LIMIT = Number(process.env.FREE_TRIAL_LIMIT) || 10;

// Cache per akun Gmail agar tahan jika koneksi internet ke vocml.vocpos.id sempat terputus
const userLicenseCache = new Map();

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
export async function verifyUserAccountLicense({ email, name, messagesCreated = 0 }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || cleanEmail.split('@')[0]).trim();
  const machineId = emailToMachineId(cleanEmail);
  const storeName = `${cleanName} (${cleanEmail})`;
  const appVersion = '1.0.0';
  const headers = { 'Content-Type': 'application/json' };

  const trialUsed = Math.max(0, Number(messagesCreated) || 0);
  const trialRemaining = Math.max(0, FREE_TRIAL_LIMIT - trialUsed);

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

    let allowed = false;
    let isTrial = false;
    let status = vocmlStatus;
    let reason = 'Menunggu aktivasi lisensi dari Admin';

    if (vocmlStatus === 'active' || vocmlStatus === 'expiring') {
      allowed = true;
      isTrial = false;
      status = vocmlStatus;
      reason = vocmlStatus === 'expiring' ? 'Lisensi Pro Aktif (Segera Berakhir)' : 'Lisensi Pro Aktif (Unlimited)';
    } else if (vocmlStatus === 'pending') {
      if (trialRemaining > 0) {
        allowed = true;
        isTrial = true;
        status = 'trial';
        reason = `Trial Gratis Aktif (Sisa ${trialRemaining} dari ${FREE_TRIAL_LIMIT} pesan)`;
      } else {
        allowed = false;
        isTrial = false;
        status = 'trial_exhausted';
        reason = `Kuota Trial Gratis ${FREE_TRIAL_LIMIT}x pesan telah habis (${trialUsed}/${FREE_TRIAL_LIMIT} terpakai). Silakan aktifkan lisensi berbayar.`;
      }
    } else if (vocmlStatus === 'locked' || body.locked) {
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
      trialLimit: FREE_TRIAL_LIMIT,
      trialUsed,
      trialRemaining,
      licenseKey: payload.license_key || body.license_key || null,
      billing,
      checkedAt: Date.now()
    };

    userLicenseCache.set(cleanEmail, result);
    return result;
  } catch (err) {
    const cached = userLicenseCache.get(cleanEmail);
    if (cached && cached.vocmlStatus === 'active' && Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000) {
      return { ...cached, offline: true };
    }

    if (trialRemaining > 0) {
      return {
        allowed: true,
        isTrial: true,
        status: 'trial',
        vocmlStatus: 'pending',
        reason: `Trial Gratis Aktif (Sisa ${trialRemaining} dari ${FREE_TRIAL_LIMIT} pesan)`,
        machineId,
        storeName,
        email: cleanEmail,
        expiresAt: null,
        daysLeft: null,
        trialLimit: FREE_TRIAL_LIMIT,
        trialUsed,
        trialRemaining,
        billing: null,
        offline: true
      };
    }

    return {
      allowed: false,
      isTrial: false,
      status: 'trial_exhausted',
      vocmlStatus: 'offline',
      reason: `Kuota Trial Gratis ${FREE_TRIAL_LIMIT}x pesan telah habis. Silakan aktifkan lisensi berbayar.`,
      machineId,
      storeName,
      email: cleanEmail,
      expiresAt: null,
      daysLeft: null,
      trialLimit: FREE_TRIAL_LIMIT,
      trialUsed,
      trialRemaining: 0,
      billing: null
    };
  }
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
