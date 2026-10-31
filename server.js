import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Muat file .env secara otomatis jika ada
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
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

import {
  initDatabase,
  createSecretMessage,
  getSecretMessageMeta,
  consumeSecretMessage,
  cleanupExpiredMessages,
  getStorageEngineName
} from './src/db.js';

import { getLicenseStatus, renderLockedScreenHTML } from './src/license.js';

const PORT = Number(process.env.PORT) || 3006;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://privatmassage.vocpos.id').replace(/\/+$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Pembersihan otomatis pesan yang sudah kedaluwarsa di PostgreSQL setiap 60 detik
setInterval(() => {
  cleanupExpiredMessages();
}, 60 * 1000).unref();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('Payload terlalu besar (maksimal 64KB).'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Format JSON tidak valid.'));
      }
    });

    req.on('error', reject);
  });
}

function generateShortId() {
  return crypto.randomBytes(8).toString('base64url');
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
      } else {
        sendJson(res, 500, { error: 'Kesalahan internal server.' });
      }
      return;
    }
    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 0. Healthcheck & Status Lisensi VOC ML (selalu dapat diakses oleh Docker healthcheck)
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'ok',
        storage: getStorageEngineName(),
        license: getLicenseStatus()
      });
    }

    if (req.method === 'GET' && pathname === '/api/license-status') {
      return sendJson(res, 200, getLicenseStatus());
    }

    // 0b. Middleware Pengunci Lisensi VOC ML
    const licenseStatus = getLicenseStatus();
    if (!licenseStatus.allowed) {
      setSecurityHeaders(res);
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderLockedScreenHTML(licenseStatus));
    }

    // 1. POST /api/messages -> Simpan pesan terenkripsi baru ke PostgreSQL
    if (req.method === 'POST' && pathname === '/api/messages') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const { ciphertext, iv, ttlMinutes = 1440, protectionMode = 'spotlight', viewTimerSeconds = 60 } = body;

      if (!ciphertext || typeof ciphertext !== 'string' || !iv || typeof iv !== 'string') {
        return sendJson(res, 400, { error: 'Data enkripsi (ciphertext & iv) wajib diisi.' });
      }

      if (ciphertext.length > 32000) {
        return sendJson(res, 400, { error: 'Pesan terlalu panjang.' });
      }

      const validTtl = Math.min(Math.max(Number(ttlMinutes) || 1440, 5), 10080); // 5 menit s/d 7 hari
      const validTimer = Math.min(Math.max(Number(viewTimerSeconds) || 60, 15), 300); // 15 detik s/d 5 menit
      const validMode = ['spotlight', 'hold', 'blur'].includes(protectionMode) ? protectionMode : 'spotlight';

      const id = generateShortId();
      const now = Date.now();
      const expiresAt = now + validTtl * 60 * 1000;

      await createSecretMessage({
        id,
        ciphertext,
        iv,
        protectionMode: validMode,
        viewTimerSeconds: validTimer,
        expiresAt
      });

      return sendJson(res, 201, {
        id,
        publicBaseUrl: PUBLIC_BASE_URL,
        expiresAt,
        protectionMode: validMode,
        viewTimerSeconds: validTimer,
        storage: getStorageEngineName()
      });
    }

    // 2. GET /api/messages/:id/meta -> Cek apakah pesan masih ada di PostgreSQL (tanpa menghancurkannya)
    const metaMatch = pathname.match(/^\/api\/messages\/([A-Za-z0-9_-]+)\/meta$/);
    if (req.method === 'GET' && metaMatch) {
      const id = metaMatch[1];
      const record = await getSecretMessageMeta(id);

      if (!record) {
        return sendJson(res, 404, {
          exists: false,
          message: 'Pesan rahasia ini sudah dihancurkan, sudah pernah dibuka, atau telah kedaluwarsa.'
        });
      }

      return sendJson(res, 200, {
        exists: true,
        protectionMode: record.protectionMode,
        viewTimerSeconds: record.viewTimerSeconds,
        expiresAt: Number(record.expiresAt)
      });
    }

    // 3. POST /api/messages/:id/consume -> Ambil pesan & LANGSUNG HAPUS PERMANEN dari PostgreSQL secara atomik!
    const consumeMatch = pathname.match(/^\/api\/messages\/([A-Za-z0-9_-]+)\/consume$/);
    if (req.method === 'POST' && consumeMatch) {
      const id = consumeMatch[1];
      const record = await consumeSecretMessage(id);

      if (!record) {
        return sendJson(res, 404, {
          error: 'Pesan rahasia tidak ditemukan atau sudah dihancurkan sebelumnya.'
        });
      }

      return sendJson(res, 200, {
        ciphertext: record.ciphertext,
        iv: record.iv,
        protectionMode: record.protectionMode,
        viewTimerSeconds: record.viewTimerSeconds,
        destroyedAt: Date.now()
      });
    }

    // 4. Rute halaman baca pesan: /m/:id -> Sajikan index.html
    if (req.method === 'GET' && /^\/m\/[A-Za-z0-9_-]+$/.test(pathname)) {
      return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // 5. Rute file statis di folder public/
    if (req.method === 'GET') {
      let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
      }
      const filePath = path.join(PUBLIC_DIR, safePath);
      if (filePath.startsWith(PUBLIC_DIR)) {
        return serveStaticFile(res, filePath);
      }
    }

    sendJson(res, 404, { error: 'Rute tidak ditemukan.' });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Terjadi kesalahan pada server.' });
  }
});

(async () => {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`🔒 Server Lokal PesanRahasia  : http://localhost:${PORT}`);
    console.log(`🌐 Domain Publik (Cloudflare) : ${PUBLIC_BASE_URL}`);
    console.log(`🗄️  Engine Database           : ${getStorageEngineName()}`);
    console.log(`=============================================================\n`);
  });
})();
