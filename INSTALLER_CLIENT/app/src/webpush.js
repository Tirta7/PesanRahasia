import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAPID_FILE = process.env.VAPID_KEYS_FILE || path.join(__dirname, '..', '.vapid-keys.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@vocpos.id';

let vapidKeys = null;

/**
 * Memuat atau membuat sepasang kunci VAPID (ECDSA P-256) secara otomatis.
 */
export function getVapidKeys() {
  if (vapidKeys) return vapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_JWK) {
    try {
      vapidKeys = {
        publicKey: process.env.VAPID_PUBLIC_KEY,
        jwk: JSON.parse(process.env.VAPID_PRIVATE_JWK)
      };
      return vapidKeys;
    } catch {
      // Fallback ke file atau generate baru
    }
  }

  try {
    if (fs.existsSync(VAPID_FILE)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (saved.publicKey && saved.jwk) {
        vapidKeys = saved;
        return vapidKeys;
      }
    }
  } catch {
    // Generate baru jika gagal baca
  }

  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  });
  const jwk = privateKey.export({ format: 'jwk' });
  const xBuf = Buffer.from(jwk.x, 'base64url');
  const yBuf = Buffer.from(jwk.y, 'base64url');
  const uncompressedPub = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
  const publicKey = uncompressedPub.toString('base64url');

  vapidKeys = { publicKey, jwk };

  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
  } catch {
    // Abaikan jika filesystem read-only
  }

  return vapidKeys;
}

/**
 * Membuat header Authorization VAPID (RFC 8292 ES256).
 */
function createVapidAuthHeader(endpointUrl) {
  const { publicKey, jwk } = getVapidKeys();
  const parsed = new URL(endpointUrl);
  const audience = `${parsed.protocol}//${parsed.host}`;

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  };

  const unsignedToken = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const privKeyObj = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const signature = crypto.sign('sha256', Buffer.from(unsignedToken), {
    key: privKeyObj,
    dsaEncoding: 'ieee-p1363'
  });

  const jwt = `${unsignedToken}.${signature.toString('base64url')}`;
  return `vapid t=${jwt}, k=${publicKey}`;
}

/**
 * Enkripsi payload Web Push menggunakan standar RFC 8291 (aes128gcm).
 */
function encryptWebPushPayload(subscription, payloadString) {
  const uaPublic = Buffer.from(subscription.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    uaPublic,
    asPublic
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));

  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  const plaintext = Buffer.concat([
    Buffer.from(payloadString, 'utf8'),
    Buffer.from([0x02])
  ]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, asPublic, encrypted]);
}

/**
 * Mengirim 1 Web Push Notification ke endpoint browser/HP Admin.
 */
export function sendWebPushNotification(subscription, payloadObj) {
  return new Promise((resolve) => {
    try {
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return resolve({ ok: false, statusCode: 400, reason: 'Invalid subscription' });
      }

      const payloadStr = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
      const body = encryptWebPushPayload(subscription, payloadStr);
      const authHeader = createVapidAuthHeader(subscription.endpoint);

      const urlObj = new URL(subscription.endpoint);
      const lib = urlObj.protocol === 'https:' ? https : http;

      const req = lib.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'Content-Length': body.length,
            TTL: '86400',
            Urgency: 'high',
            Authorization: authHeader
          },
          timeout: 10000
        },
        (res) => {
          res.resume();
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({
            ok,
            statusCode: res.statusCode,
            expired: res.statusCode === 404 || res.statusCode === 410
          });
        }
      );

      req.on('error', (err) => {
        resolve({ ok: false, statusCode: 0, reason: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, statusCode: 0, reason: 'Timeout' });
      });

      req.write(body);
      req.end();
    } catch (err) {
      resolve({ ok: false, statusCode: 0, reason: err.message });
    }
  });
}

/**
 * Generator ikon PNG (192x192 & 512x512) murni Node.js untuk syarat instalasi PWA Android & iOS.
 */
const iconCache = new Map();

export function generatePwaIconPng(size = 192) {
  if (iconCache.has(size)) return iconCache.get(size);

  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  const cx = width / 2;
  const cy = height / 2;
  const scale = size / 64;

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // filter type 0

    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const sx = x / scale;
      const sy = y / scale;

      // Background dark cyber-emerald gradient
      let r = Math.round(7 + (13 - 7) * (1 - sy / 64));
      let g = Math.round(14 + (36 - 14) * (1 - sy / 64));
      let b = Math.round(23 + (30 - 23) * (1 - sy / 64));
      let a = 255;

      // Border glow
      const distEdge = Math.min(sx, sy, 64 - sx, 64 - sy);
      if (distEdge >= 2 && distEdge <= 4.2) {
        r = 16;
        g = 185;
        b = 129;
      }

      // Shackle (bagian lengkung atas gembok): center (32, 22), radius luar 10.5, dalam 7
      if (sy <= 30 && sy >= 10) {
        const dx = sx - 32;
        const dy = sy - 22;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (sy <= 22 && dist >= 7.2 && dist <= 10.8) {
          r = 52;
          g = 211;
          b = 153;
        } else if (sy > 22 && Math.abs( Math.abs(dx) - 9 ) <= 1.8) {
          r = 52;
          g = 211;
          b = 153;
        }
      }

      // Badan gembok: x [17..47], y [29..51]
      if (sx >= 17 && sx <= 47 && sy >= 29 && sy <= 51) {
        const isBorder = sx <= 20 || sx >= 44 || sy <= 32 || sy >= 48;
        if (isBorder) {
          r = 16;
          g = 185;
          b = 129;
        } else {
          r = 14;
          g = 58;
          b = 44;
        }

        // Lubang kunci di tengah badan gembok (32, 39)
        const kdx = sx - 32;
        const kdy = sy - 38;
        if (kdx * kdx + kdy * kdy <= 9.5 || (Math.abs(kdx) <= 1.6 && sy >= 38 && sy <= 45)) {
          r = 110;
          g = 231;
          b = 183;
        }
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);

  iconCache.set(size, png);
  return png;
}

