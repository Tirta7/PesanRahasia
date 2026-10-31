import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

/**
 * Menghasilkan atau membaca Machine ID unik perangkat
 */
export function resolveMachineId(configuredId) {
  if (configuredId && configuredId.trim() !== '') {
    return configuredId.trim();
  }
  const raw = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus()[0]?.model || 'cpu'}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  return `MAC-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}

/**
 * Melakukan HTTP POST JSON ke server lisensi VOC ML
 */
function postJson(urlStr, payload, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyData = JSON.stringify(payload);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyData)
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} });
          } catch {
            reject(new Error('Respons server lisensi bukan JSON valid.'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Koneksi ke server lisensi timeout.'));
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

/**
 * Verifikasi tanda tangan digital RSA jika publicKeyPem tersedia
 */
function verifySignature(dataString, signatureBase64, publicKeyPem) {
  if (!publicKeyPem || publicKeyPem.includes('PASTE_PUBLIC_KEY')) {
    return true;
  }
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(dataString);
    verify.end();
    return verify.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

/**
 * Fungsi utama pemeriksaan lisensi VOC ML
 */
export async function checkLicense(config) {
  const machineId = resolveMachineId(config.machineId);

  // Mode bypass untuk server pemilik / development jika VOCML_ENABLED !== 'true'
  if (config.enabled === false) {
    return {
      allowed: true,
      reason: 'Mode Lisensi Bypass (Aktif)',
      machineId,
      storeName: config.storeName,
      expiresAt: null
    };
  }

  const verifyEndpoint = `${config.serverUrl.replace(/\/+$/, '')}/api/license/verify`;

  try {
    const response = await postJson(verifyEndpoint, {
      product: config.product,
      machineId,
      storeName: config.storeName,
      appVersion: config.appVersion
    });

    const data = response.body || {};

    if (response.statusCode === 200 && data.allowed === true) {
      if (data.signature && !verifySignature(`${machineId}:${data.expiresAt || ''}`, data.signature, config.publicKeyPem)) {
        return {
          allowed: false,
          reason: 'Signature RSA lisensi tidak valid.',
          machineId
        };
      }

      if (config.cacheFile) {
        try {
          fs.mkdirSync(path.dirname(config.cacheFile), { recursive: true });
          fs.writeFileSync(
            config.cacheFile,
            JSON.stringify({
              allowed: true,
              machineId,
              storeName: config.storeName,
              expiresAt: data.expiresAt || null,
              cachedAt: Date.now()
            }),
            'utf8'
          );
        } catch {
          // Abaikan jika direktori read-only
        }
      }

      return {
        allowed: true,
        reason: data.reason || 'Lisensi Aktif',
        machineId,
        expiresAt: data.expiresAt || null
      };
    }

    return {
      allowed: false,
      reason: data.reason || data.message || 'Machine ID belum diaktifkan di Dashboard VOC ML.',
      machineId,
      expiresAt: null
    };
  } catch (err) {
    if (config.cacheFile && fs.existsSync(config.cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(config.cacheFile, 'utf8'));
        const ageMs = Date.now() - (cached.cachedAt || 0);
        if (cached.allowed && cached.machineId === machineId && ageMs < 24 * 60 * 60 * 1000) {
          return {
            allowed: true,
            reason: 'Aktif (Cache Offline)',
            machineId,
            expiresAt: cached.expiresAt
          };
        }
      } catch {
        // Abaikan error baca cache
      }
    }

    return {
      allowed: false,
      reason: `Menunggu koneksi ke server lisensi (${err.message})`,
      machineId,
      expiresAt: null
    };
  }
}
