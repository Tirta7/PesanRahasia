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
  loginOrRegisterGmailUser,
  getUserBySessionToken,
  logoutSessionToken,
  updateUserLicenseInDb,
  resetUserTrialQuota,
  createSecretMessage,
  getSecretMessageMeta,
  consumeSecretMessage,
  getUserMessageLogs,
  userRevokeSecretMessage,
  getAdminDashboardData,
  deleteUserById,
  adminForceDestroyMessage,
  cleanupExpiredMessages,
  getStorageEngineName,
  saveAdminPushSubscription,
  removeAdminPushSubscription,
  getAllAdminPushSubscriptions,
  saveUserPushSubscription,
  getUserPushSubscriptionsByEmail,
  removeUserPushSubscription,
  getAppSettings,
  saveAppSettings
} from './src/db.js';

import { getLicenseStatus, verifyUserAccountLicense, renderLockedScreenHTML } from './src/license.js';
import { getVapidKeys, sendWebPushNotification, generatePwaIconPng } from './src/webpush.js';

const PORT = Number(process.env.PORT) || 3006;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://privatmassage.vocpos.id').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || '').replace(/[^0-9]/g, '');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Token sesi admin aktif di memori
const adminTokens = new Set();

// Proteksi Brute-Force Login Admin & Rate Limiting
const adminLoginAttempts = new Map();
const messageCreateRateMap = new Map();

function checkAdminLoginRateLimit(ip) {
  const now = Date.now();
  const entry = adminLoginAttempts.get(ip);
  if (!entry) return { allowed: true };
  if (now - entry.firstAt > 10 * 60 * 1000) {
    adminLoginAttempts.delete(ip);
    return { allowed: true };
  }
  if (entry.count >= 5) {
    const waitSec = Math.ceil((10 * 60 * 1000 - (now - entry.firstAt)) / 1000);
    return { allowed: false, waitSec };
  }
  return { allowed: true };
}

function recordAdminLoginFailure(ip) {
  const now = Date.now();
  const entry = adminLoginAttempts.get(ip);
  if (!entry || now - entry.firstAt > 10 * 60 * 1000) {
    adminLoginAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function checkMessageRateLimit(ip) {
  const now = Date.now();
  const entry = messageCreateRateMap.get(ip);
  if (!entry || now - entry.windowStart > 60 * 1000) {
    messageCreateRateMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= 25;
}

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

async function broadcastWebPushToAdmins(payloadObj) {
  try {
    const subs = await getAllAdminPushSubscriptions();
    if (!subs.length) return { sent: 0, total: 0 };

    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        const res = await sendWebPushNotification(sub, payloadObj);
        if (res.ok) {
          sent += 1;
        } else if (res.expired) {
          await removeAdminPushSubscription(sub.endpoint);
        }
      })
    );
    return { sent, total: subs.length };
  } catch (err) {
    console.warn('[WebPush] Gagal broadcast notifikasi:', err.message);
    return { sent: 0, total: 0 };
  }
}

async function notifySenderMessageOpened(senderEmail, messageId, openerUserAgent = '') {
  if (!senderEmail) return;
  try {
    const subs = await getUserPushSubscriptionsByEmail(senderEmail);
    if (!subs.length) return;

    let dev = 'Perangkat Penerima';
    if (openerUserAgent.includes('iPhone') || openerUserAgent.includes('iPad')) dev = 'iPhone/iPad';
    else if (openerUserAgent.includes('Android')) dev = 'HP Android';
    else if (openerUserAgent.includes('Mac')) dev = 'Mac';
    else if (openerUserAgent.includes('Windows')) dev = 'Windows PC';

    const payload = {
      title: `🔥 Pesan #${messageId} Telah Dibuka!`,
      body: `Pesan rahasia Anda baru saja dibuka dari ${dev} dan telah dihancurkan permanen dari server.`,
      url: '/',
      tag: `opened-${messageId}`
    };

    await Promise.all(
      subs.map(async (sub) => {
        const res = await sendWebPushNotification(sub, payload);
        if (res.expired) {
          await removeUserPushSubscription(sub.endpoint);
        }
      })
    );
  } catch {
    // Abaikan jika gagal kirim push ke pengirim
  }
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function decodeJwtPayload(jwtStr) {
  try {
    const parts = String(jwtStr).split('.');
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Verifikasi Google ID Token (JWT) secara resmi ke server Google OAuth2
 */
async function verifyGoogleIdToken(idToken, expectedClientId = '') {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      throw new Error('Token Google OAuth tidak valid atau telah kedaluwarsa.');
    }
    const payload = await res.json();
    if (expectedClientId && payload.aud && payload.aud !== expectedClientId) {
      throw new Error('Client ID Google OAuth tidak cocok.');
    }
    if (String(payload.email_verified) !== 'true') {
      throw new Error('Email akun Google belum terverifikasi.');
    }
    return {
      email: String(payload.email || '').trim().toLowerCase(),
      name: String(payload.name || payload.given_name || '').trim(),
      picture: String(payload.picture || '').trim()
    };
  } catch (err) {
    // Fallback decode lokal hanya jika jaringan ke googleapis.com timeout
    const local = decodeJwtPayload(idToken);
    if (local && local.email && local.email_verified) {
      return {
        email: String(local.email).trim().toLowerCase(),
        name: String(local.name || '').trim(),
        picture: String(local.picture || '').trim()
      };
    }
    throw err;
  }
}

/**
 * Verifikasi Google OAuth2 Access Token secara resmi ke endpoint UserInfo Google
 */
async function verifyGoogleAccessToken(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) {
    throw new Error('Gagal memverifikasi akun Google OAuth 2.0.');
  }
  const profile = await res.json();
  if (!profile.email || profile.email_verified === false) {
    throw new Error('Akun Google tidak memiliki email terverifikasi.');
  }
  return {
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.given_name || '').trim(),
    picture: String(profile.picture || '').trim()
  };
}

function parseJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('Ukuran pesan atau lampiran gambar terlalu besar.'));
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

    // 0. Healthcheck & Status Lisensi VOC ML
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

    const licenseStatus = getLicenseStatus();
    if (!licenseStatus.allowed) {
      setSecurityHeaders(res);
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderLockedScreenHTML(licenseStatus));
    }

    // ========================================================================
    // 1. AUTENTIKASI LOGIN GMAIL PENGGUNA & KONFIGURASI PUBLIK
    // ========================================================================

    if (req.method === 'GET' && pathname === '/api/auth/config') {
      const { publicKey } = getVapidKeys();
      const settings = await getAppSettings();
      return sendJson(res, 200, {
        googleClientId: settings.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
        strictGoogleOAuth: Boolean(settings.strictGoogleOAuth && settings.googleClientId),
        adminWhatsapp: settings.adminWhatsapp || ADMIN_WHATSAPP,
        vapidPublicKey: publicKey
      });
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const token = getBearerToken(req);
      const user = await getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, { authenticated: false });
      }
      const license = await verifyUserAccountLicense(user);
      await updateUserLicenseInDb({
        email: user.email,
        machineId: license.machineId,
        status: license.status,
        expiresAt: license.expiresAt
      });
      return sendJson(res, 200, { authenticated: true, user, license });
    }

    if (req.method === 'POST' && pathname === '/api/auth/google') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      let email = '';
      let name = '';
      let picture = '';
      let provider = 'gmail';
      const settings = await getAppSettings();
      const activeClientId = settings.googleClientId || process.env.GOOGLE_CLIENT_ID || '';

      if (body.credential) {
        try {
          const verified = await verifyGoogleIdToken(body.credential, activeClientId);
          email = verified.email;
          name = verified.name || email.split('@')[0];
          picture = verified.picture;
          provider = 'google-oauth';
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Token Google Sign-In tidak valid.' });
        }
      } else if (body.accessToken) {
        try {
          const verified = await verifyGoogleAccessToken(body.accessToken);
          email = verified.email;
          name = verified.name || email.split('@')[0];
          picture = verified.picture;
          provider = 'google-oauth';
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Gagal verifikasi login Google OAuth 2.0.' });
        }
      } else {
        if (settings.strictGoogleOAuth && activeClientId) {
          return sendJson(res, 403, {
            error: 'Demi keamanan dan mencegah penyalahgunaan kuota Trial, wajib masuk menggunakan tombol resmi "Sign in with Google".'
          });
        }
        email = String(body.email || '').trim().toLowerCase();
        name = String(body.name || '').trim();
        picture = String(body.picture || '').trim();
      }

      if (!email || !/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        return sendJson(res, 400, {
          error: 'Wajib menggunakan alamat email @gmail.com yang valid (contoh: namaanda@gmail.com).'
        });
      }

      if (!name || name.length < 2) {
        name = email.split('@')[0];
      }

      if (!picture) {
        picture = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10b981&color=04130d&bold=true`;
      }

      const ip = getClientIp(req);
      const userAgent = String(req.headers['user-agent'] || 'Unknown');

      const session = await loginOrRegisterGmailUser({
        email,
        name,
        picture,
        ip,
        userAgent,
        provider
      });

      const license = await verifyUserAccountLicense(session.user);
      await updateUserLicenseInDb({
        email: session.user.email,
        machineId: license.machineId,
        status: license.status,
        expiresAt: license.expiresAt
      });

      if (session.isNewUser) {
        broadcastWebPushToAdmins({
          title: '🆕 Pendaftar Baru PesanRahasia!',
          body: `${session.user.name} (${session.user.email}) baru saja mendaftar.\nID Lisensi: ${license.machineId}`,
          url: '/admin',
          email: session.user.email,
          machineId: license.machineId,
          tag: `new-user-${session.user.email}`
        });
      }

      return sendJson(res, 200, {
        authenticated: true,
        user: session.user,
        token: session.token,
        license,
        isNewUser: Boolean(session.isNewUser)
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const token = getBearerToken(req);
      await logoutSessionToken(token);
      return sendJson(res, 200, { success: true });
    }

    // Subscription Web Push Pengirim (Notifikasi Saat Pesan Dibuka / Read Receipt)
    if (req.method === 'POST' && pathname === '/api/user/push/subscribe') {
      const token = getBearerToken(req);
      const user = await getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, { error: 'Silakan login terlebih dahulu.' });
      }
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const ok = await saveUserPushSubscription(
        user.email,
        body.subscription,
        String(req.headers['user-agent'] || 'Sender Device')
      );
      if (!ok) {
        return sendJson(res, 400, { error: 'Subscription Web Push tidak valid.' });
      }
      return sendJson(res, 200, { success: true });
    }

    // Riwayat Link Pesan Milik Pengirim Sendiri & Batalkan Link
    if (req.method === 'GET' && pathname === '/api/my-messages') {
      const token = getBearerToken(req);
      const user = await getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, { error: 'Silakan login terlebih dahulu.' });
      }
      const logs = await getUserMessageLogs(user.email);
      return sendJson(res, 200, { logs });
    }

    const userRevokeMatch = pathname.match(/^\/api\/my-messages\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'DELETE' && userRevokeMatch) {
      const token = getBearerToken(req);
      const user = await getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, { error: 'Silakan login terlebih dahulu.' });
      }
      const revoked = await userRevokeSecretMessage(userRevokeMatch[1], user.email);
      if (!revoked) {
        return sendJson(res, 404, { error: 'Pesan sudah dibuka atau tidak ditemukan.' });
      }
      return sendJson(res, 200, { success: true });
    }

    // ========================================================================
    // 2. API DASHBOARD ADMIN (/admin & /api/admin/*)
    // ========================================================================

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const clientIp = getClientIp(req);
      const rateCheck = checkAdminLoginRateLimit(clientIp);
      if (!rateCheck.allowed) {
        return sendJson(res, 429, {
          error: `Terlalu banyak percobaan login gagal. Silakan tunggu ${rateCheck.waitSec} detik.`
        });
      }

      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      if (body.password !== ADMIN_PASSWORD) {
        recordAdminLoginFailure(clientIp);
        return sendJson(res, 401, { error: 'Password Admin salah.' });
      }

      adminLoginAttempts.delete(clientIp);
      const token = crypto.randomBytes(24).toString('hex');
      adminTokens.add(token);
      return sendJson(res, 200, { token });
    }

    if (req.method === 'GET' && pathname === '/api/admin/dashboard') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid. Silakan login kembali.' });
      }

      const dashboardData = await getAdminDashboardData();
      const settings = await getAppSettings();
      return sendJson(res, 200, {
        ...dashboardData,
        settings
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const updatedSettings = await saveAppSettings({
        googleClientId: body.googleClientId,
        strictGoogleOAuth: Boolean(body.strictGoogleOAuth),
        adminWhatsapp: body.adminWhatsapp
      });

      return sendJson(res, 200, {
        success: true,
        settings: updatedSettings
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/sync-licenses') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }

      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch {
        body = {};
      }

      const dashboardData = await getAdminDashboardData();
      const targetUsers = body.email
        ? (dashboardData.users || []).filter((u) => u.email === body.email)
        : (dashboardData.users || []).slice(0, 50);

      for (const u of targetUsers) {
        try {
          const lic = await verifyUserAccountLicense({
            email: u.email,
            name: u.name,
            messagesCreated: u.messagesCreated
          });
          await updateUserLicenseInDb({
            email: u.email,
            machineId: lic.machineId,
            status: lic.status,
            expiresAt: lic.expiresAt
          });
        } catch {
          // Lanjutkan ke user berikutnya
        }
      }

      const updatedData = await getAdminDashboardData();
      return sendJson(res, 200, {
        syncedCount: targetUsers.length,
        ...updatedData
      });
    }

    // Endpoint Reset Kuota Trial 10x Gratis Pengguna oleh Admin
    const adminResetTrialMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-trial$/);
    if (req.method === 'POST' && adminResetTrialMatch) {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      const resetUser = await resetUserTrialQuota(Number(adminResetTrialMatch[1]));
      if (!resetUser) {
        return sendJson(res, 404, { error: 'Pengguna tidak ditemukan.' });
      }
      const updatedData = await getAdminDashboardData();
      return sendJson(res, 200, {
        success: true,
        resetUser,
        ...updatedData
      });
    }

    const adminDeleteUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'DELETE' && adminDeleteUserMatch) {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      await deleteUserById(Number(adminDeleteUserMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const adminDestroyMsgMatch = pathname.match(/^\/api\/admin\/messages\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'DELETE' && adminDestroyMsgMatch) {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      await adminForceDestroyMessage(adminDestroyMsgMatch[1]);
      return sendJson(res, 200, { success: true });
    }

    // Endpoint VAPID Public Key & Status Web Push Admin
    if (req.method === 'GET' && pathname === '/api/admin/push/vapid-public-key') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      const { publicKey } = getVapidKeys();
      const subs = await getAllAdminPushSubscriptions();
      return sendJson(res, 200, {
        publicKey,
        subscriberCount: subs.length
      });
    }

    // Endpoint Simpan Subscription Web Push dari HP / Browser Admin
    if (req.method === 'POST' && pathname === '/api/admin/push/subscribe') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const saved = await saveAdminPushSubscription(
        body.subscription,
        String(req.headers['user-agent'] || 'Admin Device')
      );
      if (!saved) {
        return sendJson(res, 400, { error: 'Data subscription Web Push tidak valid.' });
      }

      await sendWebPushNotification(body.subscription, {
        title: '🔔 Web Push Admin Aktif!',
        body: 'Perangkat ini sekarang akan menerima notifikasi otomatis setiap ada pendaftar Gmail baru.',
        url: '/admin',
        tag: 'admin-push-welcome'
      });

      const subs = await getAllAdminPushSubscriptions();
      return sendJson(res, 200, {
        success: true,
        subscriberCount: subs.length
      });
    }

    // Endpoint Tes Kirim Web Push ke Semua Perangkat Admin
    if (req.method === 'POST' && pathname === '/api/admin/push/test') {
      const token = getBearerToken(req);
      if (!token || !adminTokens.has(token)) {
        return sendJson(res, 401, { error: 'Sesi Admin tidak valid.' });
      }
      const result = await broadcastWebPushToAdmins({
        title: '🆕 Simulasi Pendaftar Baru!',
        body: 'budi.santoso@gmail.com baru saja mendaftar.\nID Lisensi: GMAIL-8F2A-41C9-7B0E',
        url: '/admin',
        tag: 'admin-push-test-' + Date.now()
      });
      return sendJson(res, 200, result);
    }

    // ========================================================================
    // 3. API PESAN RAHASIA (WAJIB LOGIN GMAIL UNTUK PENGIRIM)
    // ========================================================================

    if (req.method === 'POST' && pathname === '/api/messages') {
      const senderIp = getClientIp(req);
      if (!checkMessageRateLimit(senderIp)) {
        return sendJson(res, 429, {
          error: 'Terlalu banyak permintaan pembuatan pesan. Silakan tunggu 1 menit.'
        });
      }

      const token = getBearerToken(req);
      const user = await getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, {
          error: 'Silakan login dengan akun Gmail Anda terlebih dahulu untuk membuat pesan rahasia.'
        });
      }

      const license = await verifyUserAccountLicense(user);
      if (!license.allowed) {
        return sendJson(res, 403, {
          error: license.reason || 'Lisensi akun Gmail Anda belum aktif.',
          license
        });
      }

      let body;
      try {
        body = await parseJsonBody(req, 2560 * 1024); // Maks 2.5MB untuk mendukung lampiran gambar terenkripsi
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const {
        ciphertext,
        iv,
        pin = '',
        hasImage = false,
        ttlMinutes = 1440,
        protectionMode = 'spotlight',
        viewTimerSeconds = 60
      } = body;

      if (!ciphertext || typeof ciphertext !== 'string' || !iv || typeof iv !== 'string') {
        return sendJson(res, 400, { error: 'Data enkripsi (ciphertext & iv) wajib diisi.' });
      }

      if (ciphertext.length > 2200000) {
        return sendJson(res, 400, { error: 'Ukuran pesan / lampiran gambar terlalu besar.' });
      }

      const cleanPin = String(pin || '').trim();
      if (cleanPin && (cleanPin.length < 4 || cleanPin.length > 16)) {
        return sendJson(res, 400, { error: 'PIN Proteksi harus terdiri dari 4 hingga 16 karakter.' });
      }

      const validTtl = Math.min(Math.max(Number(ttlMinutes) || 1440, 5), 10080);
      const validTimer = Math.min(Math.max(Number(viewTimerSeconds) || 60, 15), 300);
      const validMode = ['spotlight', 'hold', 'blur'].includes(protectionMode) ? protectionMode : 'spotlight';

      const id = generateShortId();
      const now = Date.now();
      const expiresAt = now + validTtl * 60 * 1000;

      await createSecretMessage({
        id,
        user,
        senderIp,
        ciphertext,
        iv,
        pin: cleanPin,
        hasImage: Boolean(hasImage),
        protectionMode: validMode,
        viewTimerSeconds: validTimer,
        expiresAt
      });

      user.messagesCreated = (Number(user.messagesCreated) || 0) + 1;
      const updatedLicense = await verifyUserAccountLicense(user);
      await updateUserLicenseInDb({
        email: user.email,
        machineId: updatedLicense.machineId,
        status: updatedLicense.status,
        expiresAt: updatedLicense.expiresAt
      });

      if (updatedLicense.status === 'trial_exhausted') {
        broadcastWebPushToAdmins({
          title: '🛑 Kuota Trial 10x Habis (Siap Upgrade)!',
          body: `${user.name} (${user.email}) telah memakai 10/10 pesan gratis.\nID Lisensi: ${updatedLicense.machineId}`,
          url: '/admin',
          email: user.email,
          machineId: updatedLicense.machineId,
          tag: `trial-exhausted-${user.email}`
        });
      }

      return sendJson(res, 201, {
        id,
        publicBaseUrl: PUBLIC_BASE_URL,
        expiresAt,
        hasPin: Boolean(cleanPin),
        hasImage: Boolean(hasImage),
        protectionMode: validMode,
        viewTimerSeconds: validTimer,
        storage: getStorageEngineName(),
        user,
        license: updatedLicense
      });
    }

    // Cek apakah pesan masih ada di PostgreSQL (tanpa menghancurkannya)
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
        hasPin: Boolean(record.hasPin),
        hasImage: Boolean(record.hasImage),
        protectionMode: record.protectionMode,
        viewTimerSeconds: record.viewTimerSeconds,
        expiresAt: Number(record.expiresAt)
      });
    }

    // Verifikasi PIN (jika ada) & LANGSUNG HAPUS PERMANEN dari PostgreSQL secara atomik!
    const consumeMatch = pathname.match(/^\/api\/messages\/([A-Za-z0-9_-]+)\/consume$/);
    if (req.method === 'POST' && consumeMatch) {
      const id = consumeMatch[1];
      const openerIp = getClientIp(req);
      const openerUserAgent = String(req.headers['user-agent'] || 'Unknown');

      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch {
        body = {};
      }

      const result = await consumeSecretMessage(id, {
        pin: body.pin || '',
        openerIp,
        openerUserAgent
      });

      if (result.status === 'invalid_pin') {
        return sendJson(res, 403, {
          error: `PIN Rahasia salah! Sisa percobaan: ${result.attemptsLeft}x sebelum pesan otomatis dihancurkan.`,
          invalidPin: true,
          attemptsLeft: result.attemptsLeft
        });
      }

      if (result.status === 'pin_burned') {
        return sendJson(res, 410, {
          error: 'Salah memasukkan PIN 5 kali! Demi keamanan, pesan rahasia telah dihancurkan secara permanen.'
        });
      }

      if (!result.record) {
        return sendJson(res, 404, {
          error: 'Pesan rahasia tidak ditemukan atau sudah dihancurkan sebelumnya.'
        });
      }

      const record = result.record;

      // Kirim Web Push Notification Read-Receipt ke HP Pengirim!
      if (record.senderEmail) {
        notifySenderMessageOpened(record.senderEmail, id, openerUserAgent);
      }

      return sendJson(res, 200, {
        ciphertext: record.ciphertext,
        iv: record.iv,
        hasImage: Boolean(record.hasImage),
        protectionMode: record.protectionMode,
        viewTimerSeconds: record.viewTimerSeconds,
        destroyedAt: Date.now()
      });
    }

    // 4. Rute halaman Admin Dashboard: /admin -> Sajikan admin.html
    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      return serveStaticFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    }

    // Rute Favicon: /favicon.ico -> Sajikan favicon.svg
    if (req.method === 'GET' && pathname === '/favicon.ico') {
      return serveStaticFile(res, path.join(PUBLIC_DIR, 'favicon.svg'));
    }

    // Rute Ikon PNG untuk PWA (192x192 & 512x512)
    if (req.method === 'GET' && (pathname === '/icon-192.png' || pathname === '/icon-512.png')) {
      const size = pathname.includes('512') ? 512 : 192;
      const pngBuffer = generatePwaIconPng(size);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(pngBuffer);
    }

    // 5. Rute halaman baca pesan: /m/:id -> Sajikan index.html
    if (req.method === 'GET' && /^\/m\/[A-Za-z0-9_-]+$/.test(pathname)) {
      return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // 6. Rute file statis di folder public/
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
    console.log(`📊 Dashboard Admin Pengguna   : http://localhost:${PORT}/admin`);
    console.log(`🌐 Domain Publik (Cloudflare) : ${PUBLIC_BASE_URL}`);
    console.log(`🗄️  Engine Database           : ${getStorageEngineName()}`);
    console.log(`=============================================================\n`);
  });
})();
