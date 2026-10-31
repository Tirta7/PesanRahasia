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
 * Setiap user Gmail baru otomatis masuk ke menu "Machine ID Masuk" di vocml.vocpos.id
 * dengan nama: "Nama User (email@gmail.com)"
 */
export async function verifyUserAccountLicense({ email, name }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || cleanEmail.split('@')[0]).trim();
  const machineId = emailToMachineId(cleanEmail);
  const storeName = `${cleanName} (${cleanEmail})`;
  const appVersion = '1.0.0';
  const headers = { 'Content-Type': 'application/json' };

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
    const status = payload.status || body.status || 'pending';
    const expiresAt = payload.expires_at ?? body.expires_at ?? null;
    const daysLeft = body.days_left ?? payload.days_left ?? null;
    const billing = body.billing || null;

    let allowed = false;
    let reason = 'Menunggu aktivasi lisensi dari Admin';

    if (status === 'active' || status === 'expiring') {
      allowed = true;
      reason = status === 'expiring' ? 'Lisensi Aktif (Segera Berakhir)' : 'Lisensi Aktif';
    } else if (status === 'pending') {
      allowed = false;
      reason = 'Menunggu aktivasi lisensi oleh Admin di Dashboard VOC ML';
    } else if (status === 'locked' || body.locked) {
      allowed = false;
      reason = payload.lock_reason || body.lock_reason || 'Akun Anda sedang dikunci oleh Admin';
    } else if (status === 'expired') {
      allowed = false;
      reason = 'Masa berlaku lisensi akun Anda telah habis';
    }

    const result = {
      allowed,
      status,
      reason,
      machineId,
      storeName,
      email: cleanEmail,
      expiresAt,
      daysLeft,
      licenseKey: payload.license_key || body.license_key || null,
      billing,
      checkedAt: Date.now()
    };

    userLicenseCache.set(cleanEmail, result);
    return result;
  } catch (err) {
    // Jika server lisensi sedang gangguan sementara, gunakan cache jika sebelumnya sudah aktif
    const cached = userLicenseCache.get(cleanEmail);
    if (cached && cached.allowed && Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000) {
      return { ...cached, offline: true };
    }

    return {
      allowed: false,
      status: 'offline',
      reason: `Tidak dapat terhubung ke server lisensi (${err.message})`,
      machineId,
      storeName,
      email: cleanEmail,
      expiresAt: null,
      daysLeft: null,
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
