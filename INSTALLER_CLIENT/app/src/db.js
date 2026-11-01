import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

/**
 * Modul Database PostgreSQL untuk PesanRahasia:
 * 1. Tabel `users` & `user_sessions` -> Menyimpan data pengguna yang login dengan Gmail.
 * 2. Tabel `secret_messages` -> Menyimpan ciphertext sekali baca (dihapus permanen saat dibaca).
 * 3. Tabel `message_logs` -> Menyimpan log aktivitas pengirim & status kapan pesan dibuka/hancur.
 * 4. Tabel `admin_push_subscriptions` & `user_push_subscriptions` -> Web Push Notification HP.
 */
const memoryFallback = new Map();
const memoryUsers = new Map();
const memorySessions = new Map();
const memoryLogs = new Map();
const memoryPushSubscriptions = new Map();
const memoryUserPushSubscriptions = new Map();
const memorySettings = new Map();

let pool = null;
let isPostgresReady = false;

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'pesan_rahasia'
  };
}

async function ensureDatabaseExists(cfg) {
  if (!Pool || cfg.connectionString) return;
  const adminPool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: 'postgres',
    connectionTimeoutMillis: 3000
  });
  try {
    const dbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, '');
    const check = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (check.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log(`[PostgreSQL] ✅ Database "${dbName}" berhasil dibuat otomatis.`);
    }
  } catch {
    // Abaikan jika sudah ada
  } finally {
    await adminPool.end().catch(() => {});
  }
}

export function hashPin(pin) {
  const clean = String(pin || '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(`pr_pin:${clean}`).digest('hex');
}

export async function initDatabase() {
  const cfg = getDbConfig();
  await ensureDatabaseExists(cfg);

  pool = new Pool({
    ...cfg,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        picture TEXT,
        auth_provider VARCHAR(32) NOT NULL DEFAULT 'gmail',
        last_ip VARCHAR(64),
        user_agent TEXT,
        messages_created INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token VARCHAR(128) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secret_messages (
        id VARCHAR(32) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ciphertext TEXT NOT NULL,
        iv VARCHAR(64) NOT NULL,
        pin_hash VARCHAR(128),
        has_image BOOLEAN NOT NULL DEFAULT FALSE,
        pin_attempts INTEGER NOT NULL DEFAULT 0,
        protection_mode VARCHAR(20) NOT NULL DEFAULT 'spotlight',
        view_timer_seconds INTEGER NOT NULL DEFAULT 60,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_secret_messages_expires_at ON secret_messages(expires_at);

      CREATE TABLE IF NOT EXISTS message_logs (
        id VARCHAR(32) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_email VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        sender_ip VARCHAR(64),
        has_pin BOOLEAN NOT NULL DEFAULT FALSE,
        has_image BOOLEAN NOT NULL DEFAULT FALSE,
        protection_mode VARCHAR(20) NOT NULL DEFAULT 'spotlight',
        view_timer_seconds INTEGER NOT NULL DEFAULT 60,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        opened_at TIMESTAMPTZ,
        opener_ip VARCHAR(64),
        opener_user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_message_logs_created_at ON message_logs(created_at DESC);
    `);

    // Pastikan kolom tambahan tersedia pada database versi lama
    await pool.query(`ALTER TABLE secret_messages ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`).catch(() => {});
    await pool.query(`ALTER TABLE secret_messages ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(128);`).catch(() => {});
    await pool.query(`ALTER TABLE secret_messages ADD COLUMN IF NOT EXISTS has_image BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
    await pool.query(`ALTER TABLE secret_messages ADD COLUMN IF NOT EXISTS pin_attempts INTEGER NOT NULL DEFAULT 0;`).catch(() => {});
    await pool.query(`ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS has_pin BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
    await pool.query(`ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS has_image BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS machine_id VARCHAR(64);`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_status VARCHAR(32) DEFAULT 'pending';`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_expires_at VARCHAR(64);`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_push_email ON user_push_subscriptions(user_email);

      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch(() => {});

    isPostgresReady = true;
    console.log('[PostgreSQL] ✅ Terhubung ke PostgreSQL & tabel siap digunakan.');
    return true;
  } catch (err) {
    isPostgresReady = false;
    console.warn(`[PostgreSQL] ⚠️ Gagal terhubung ke PostgreSQL (${err.message}). Beralih otomatis ke In-Memory Vault.`);
    return false;
  }
}

// ============================================================================
// MANAJEMEN PENGGUNA GMAIL & SESI LOGIN
// ============================================================================

export async function loginOrRegisterGmailUser({ email, name, picture = '', ip = '', userAgent = '', provider = 'gmail' }) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (name || cleanEmail.split('@')[0]).trim();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAtMs = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 hari

  if (isPostgresReady && pool) {
    const existingRes = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    const isNewUser = existingRes.rowCount === 0;

    const userRes = await pool.query(
      `INSERT INTO users (email, name, picture, auth_provider, last_ip, user_agent, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
         picture = COALESCE(NULLIF(EXCLUDED.picture, ''), users.picture),
         auth_provider = CASE WHEN EXCLUDED.auth_provider = 'google-oauth' THEN 'google-oauth' ELSE users.auth_provider END,
         last_ip = EXCLUDED.last_ip,
         user_agent = EXCLUDED.user_agent,
         last_login_at = NOW()
       RETURNING id, email, name, picture, auth_provider AS "authProvider", messages_created AS "messagesCreated", created_at AS "createdAt", last_login_at AS "lastLoginAt"`,
      [cleanEmail, cleanName, picture, provider, ip, userAgent]
    );
    const user = userRes.rows[0];

    await pool.query(
      `INSERT INTO user_sessions (token, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [sessionToken, user.id, expiresAtMs]
    );

    return { user, token: sessionToken, isNewUser };
  }

  let existing = memoryUsers.get(cleanEmail);
  const isNewUser = !existing;
  if (!existing) {
    existing = {
      id: memoryUsers.size + 1,
      email: cleanEmail,
      name: cleanName,
      picture,
      lastIp: ip,
      userAgent,
      messagesCreated: 0,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };
  } else {
    existing.name = cleanName || existing.name;
    existing.picture = picture || existing.picture;
    existing.lastIp = ip;
    existing.userAgent = userAgent;
    existing.lastLoginAt = new Date().toISOString();
  }
  memoryUsers.set(cleanEmail, existing);
  memorySessions.set(sessionToken, { email: cleanEmail, expiresAt: expiresAtMs });
  return { user: existing, token: sessionToken, isNewUser };
}

export async function getUserBySessionToken(token) {
  if (!token) return null;

  if (isPostgresReady && pool) {
    const res = await pool.query(
      `SELECT u.id, u.email, u.name, u.picture, u.auth_provider AS "authProvider", u.messages_created AS "messagesCreated", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    return res.rows[0] || null;
  }

  const sess = memorySessions.get(token);
  if (!sess || sess.expiresAt <= Date.now()) {
    if (sess) memorySessions.delete(token);
    return null;
  }
  return memoryUsers.get(sess.email) || null;
}

export async function logoutSessionToken(token) {
  if (!token) return;
  if (isPostgresReady && pool) {
    await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]).catch(() => {});
    return;
  }
  memorySessions.delete(token);
}

export async function updateUserLicenseInDb({ email, machineId, status, expiresAt }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return;

  if (isPostgresReady && pool) {
    await pool
      .query(
        `UPDATE users
         SET machine_id = $2,
             license_status = $3,
             license_expires_at = $4
         WHERE email = $1`,
        [cleanEmail, machineId || '', status || 'pending', expiresAt || null]
      )
      .catch(() => {});
    return;
  }

  if (memoryUsers.has(cleanEmail)) {
    const u = memoryUsers.get(cleanEmail);
    u.machineId = machineId;
    u.licenseStatus = status;
    u.licenseExpiresAt = expiresAt;
  }
}

export async function resetUserTrialQuota(userId) {
  if (isPostgresReady && pool) {
    const res = await pool.query(
      `UPDATE users
       SET messages_created = 0,
           license_status = CASE WHEN license_status IN ('active', 'expiring') THEN license_status ELSE 'trial' END
       WHERE id = $1
       RETURNING id, email, name, messages_created AS "messagesCreated"`,
      [userId]
    );
    return res.rows[0] || null;
  }

  for (const [, u] of memoryUsers.entries()) {
    if (String(u.id) === String(userId)) {
      u.messagesCreated = 0;
      if (u.licenseStatus !== 'active' && u.licenseStatus !== 'expiring') {
        u.licenseStatus = 'trial';
      }
      return u;
    }
  }
  return null;
}

// ============================================================================
// MANAJEMEN PESAN RAHASIA & LOG AKTIVITAS
// ============================================================================

export async function createSecretMessage({
  id,
  user,
  senderIp = '',
  ciphertext,
  iv,
  pin = '',
  hasImage = false,
  protectionMode,
  viewTimerSeconds,
  expiresAt
}) {
  const pinHash = hashPin(pin);
  const hasPin = Boolean(pinHash);

  if (isPostgresReady && pool) {
    await pool.query(
      `INSERT INTO secret_messages (id, user_id, ciphertext, iv, pin_hash, has_image, protection_mode, view_timer_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))`,
      [id, user?.id || null, ciphertext, iv, pinHash, Boolean(hasImage), protectionMode, viewTimerSeconds, expiresAt]
    );

    if (user?.id) {
      await pool.query(`UPDATE users SET messages_created = messages_created + 1, last_login_at = NOW() WHERE id = $1`, [user.id]);
    }

    await pool.query(
      `INSERT INTO message_logs (id, user_id, sender_email, sender_name, sender_ip, has_pin, has_image, protection_mode, view_timer_seconds, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', to_timestamp($10 / 1000.0))`,
      [
        id,
        user?.id || null,
        user?.email || 'anonymous@gmail.com',
        user?.name || 'Pengguna',
        senderIp,
        hasPin,
        Boolean(hasImage),
        protectionMode,
        viewTimerSeconds,
        expiresAt
      ]
    );
    return;
  }

  memoryFallback.set(id, {
    id,
    ciphertext,
    iv,
    pinHash,
    hasImage: Boolean(hasImage),
    pinAttempts: 0,
    protectionMode,
    viewTimerSeconds,
    senderEmail: user?.email || '',
    createdAt: Date.now(),
    expiresAt
  });
  if (user?.email && memoryUsers.has(user.email)) {
    memoryUsers.get(user.email).messagesCreated += 1;
  }
  memoryLogs.set(id, {
    id,
    senderEmail: user?.email || 'anonymous@gmail.com',
    senderName: user?.name || 'Pengguna',
    senderIp,
    hasPin,
    hasImage: Boolean(hasImage),
    protectionMode,
    viewTimerSeconds,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    openedAt: null,
    openerIp: null,
    openerUserAgent: null
  });
}

export async function getSecretMessageMeta(id) {
  if (isPostgresReady && pool) {
    const res = await pool.query(
      `SELECT id,
              (pin_hash IS NOT NULL) AS "hasPin",
              has_image AS "hasImage",
              protection_mode AS "protectionMode",
              view_timer_seconds AS "viewTimerSeconds",
              EXTRACT(EPOCH FROM expires_at) * 1000 AS "expiresAt"
       FROM secret_messages
       WHERE id = $1 AND expires_at > NOW()`,
      [id]
    );
    return res.rows[0] || null;
  }

  const record = memoryFallback.get(id);
  if (!record || record.expiresAt <= Date.now()) {
    if (record) memoryFallback.delete(id);
    return null;
  }
  return {
    id: record.id,
    hasPin: Boolean(record.pinHash),
    hasImage: Boolean(record.hasImage),
    protectionMode: record.protectionMode,
    viewTimerSeconds: record.viewTimerSeconds,
    expiresAt: record.expiresAt
  };
}

export async function consumeSecretMessage(id, { pin = '', openerIp = '', openerUserAgent = '' } = {}) {
  const inputPinHash = hashPin(pin);

  if (isPostgresReady && pool) {
    const checkRes = await pool.query(
      `SELECT id, pin_hash AS "pinHash", pin_attempts AS "pinAttempts"
       FROM secret_messages
       WHERE id = $1 AND expires_at > NOW()`,
      [id]
    );
    const meta = checkRes.rows[0];
    if (!meta) {
      return { status: 'not_found', record: null };
    }

    if (meta.pinHash) {
      if (!inputPinHash || inputPinHash !== meta.pinHash) {
        const nextAttempts = (Number(meta.pinAttempts) || 0) + 1;
        if (nextAttempts >= 5) {
          await pool.query('DELETE FROM secret_messages WHERE id = $1', [id]);
          await pool.query(
            `UPDATE message_logs SET status = 'destroyed', opened_at = NOW(), opener_ip = $2 WHERE id = $1`,
            [id, `${openerIp} (Salah PIN 5x - Auto Hancur)`]
          ).catch(() => {});
          return { status: 'pin_burned', record: null };
        }
        await pool.query('UPDATE secret_messages SET pin_attempts = $2 WHERE id = $1', [id, nextAttempts]);
        return { status: 'invalid_pin', attemptsLeft: 5 - nextAttempts, record: null };
      }
    }

    const res = await pool.query(
      `DELETE FROM secret_messages
       WHERE id = $1 AND expires_at > NOW()
       RETURNING id,
                 ciphertext,
                 iv,
                 has_image AS "hasImage",
                 protection_mode AS "protectionMode",
                 view_timer_seconds AS "viewTimerSeconds"`,
      [id]
    );
    const row = res.rows[0] || null;
    if (!row) {
      return { status: 'not_found', record: null };
    }

    const logRes = await pool
      .query(
        `UPDATE message_logs
         SET status = 'destroyed',
             opened_at = NOW(),
             opener_ip = $2,
             opener_user_agent = $3
         WHERE id = $1
         RETURNING sender_email AS "senderEmail", sender_name AS "senderName"`,
        [id, openerIp, openerUserAgent]
      )
      .catch(() => ({ rows: [] }));

    const senderInfo = logRes?.rows?.[0] || {};
    return {
      status: 'ok',
      record: {
        ...row,
        senderEmail: senderInfo.senderEmail || ''
      }
    };
  }

  const record = memoryFallback.get(id);
  if (!record || record.expiresAt <= Date.now()) {
    memoryFallback.delete(id);
    return { status: 'not_found', record: null };
  }

  if (record.pinHash) {
    if (!inputPinHash || inputPinHash !== record.pinHash) {
      record.pinAttempts = (record.pinAttempts || 0) + 1;
      if (record.pinAttempts >= 5) {
        memoryFallback.delete(id);
        if (memoryLogs.has(id)) {
          const log = memoryLogs.get(id);
          log.status = 'destroyed';
          log.openedAt = new Date().toISOString();
          log.openerIp = `${openerIp} (Salah PIN 5x)`;
        }
        return { status: 'pin_burned', record: null };
      }
      return { status: 'invalid_pin', attemptsLeft: 5 - record.pinAttempts, record: null };
    }
  }

  memoryFallback.delete(id);
  if (memoryLogs.has(id)) {
    const log = memoryLogs.get(id);
    log.status = 'destroyed';
    log.openedAt = new Date().toISOString();
    log.openerIp = openerIp;
    log.openerUserAgent = openerUserAgent;
  }
  return { status: 'ok', record };
}

export async function getUserMessageLogs(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return [];

  if (isPostgresReady && pool) {
    await pool
      .query(`UPDATE message_logs SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()`)
      .catch(() => {});

    const res = await pool.query(
      `SELECT id,
              has_pin AS "hasPin",
              has_image AS "hasImage",
              protection_mode AS "protectionMode",
              view_timer_seconds AS "viewTimerSeconds",
              status,
              created_at AS "createdAt",
              expires_at AS "expiresAt",
              opened_at AS "openedAt",
              opener_user_agent AS "openerUserAgent"
       FROM message_logs
       WHERE sender_email = $1
       ORDER BY created_at DESC
       LIMIT 15`,
      [cleanEmail]
    );
    return res.rows;
  }

  return Array.from(memoryLogs.values())
    .filter((l) => l.senderEmail === cleanEmail)
    .reverse()
    .slice(0, 15);
}

export async function userRevokeSecretMessage(messageId, email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!messageId || !cleanEmail) return false;

  if (isPostgresReady && pool) {
    const check = await pool.query(
      `SELECT id FROM message_logs WHERE id = $1 AND sender_email = $2 AND status = 'pending'`,
      [messageId, cleanEmail]
    );
    if (check.rowCount === 0) return false;

    await pool.query('DELETE FROM secret_messages WHERE id = $1', [messageId]);
    await pool.query(
      `UPDATE message_logs
       SET status = 'destroyed',
           opened_at = NOW(),
           opener_ip = 'Dibatalkan oleh Pengirim',
           opener_user_agent = 'Sender Self-Burn'
       WHERE id = $1`,
      [messageId]
    );
    return true;
  }

  const log = memoryLogs.get(messageId);
  if (!log || log.senderEmail !== cleanEmail || log.status !== 'pending') return false;
  memoryFallback.delete(messageId);
  log.status = 'destroyed';
  log.openedAt = new Date().toISOString();
  log.openerIp = 'Dibatalkan oleh Pengirim';
  return true;
}

// ============================================================================
// STATISTIK & DATA DASHBOARD ADMIN (/admin)
// ============================================================================

export async function getAdminDashboardData() {
  if (isPostgresReady && pool) {
    await pool
      .query(`UPDATE message_logs SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()`)
      .catch(() => {});

    const [statsRes, usersRes, logsRes] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS "totalUsers",
          (SELECT COUNT(*)::int FROM users WHERE last_login_at >= NOW() - INTERVAL '24 hours') AS "activeUsersToday",
          (SELECT COUNT(*)::int FROM users WHERE license_status IN ('active', 'expiring')) AS "licensedUsers",
          (SELECT COUNT(*)::int FROM users WHERE license_status NOT IN ('active', 'expiring') OR license_status IS NULL) AS "unlicensedUsers",
          (SELECT COUNT(*)::int FROM message_logs) AS "totalMessages",
          (SELECT COUNT(*)::int FROM message_logs WHERE status = 'destroyed') AS "destroyedMessages",
          (SELECT COUNT(*)::int FROM message_logs WHERE status = 'pending') AS "pendingMessages",
          (SELECT COUNT(*)::int FROM message_logs WHERE status = 'expired') AS "expiredMessages"
      `),
      pool.query(`
        SELECT
          id,
          email,
          name,
          picture,
          auth_provider AS "authProvider",
          machine_id AS "machineId",
          license_status AS "licenseStatus",
          license_expires_at AS "licenseExpiresAt",
          last_ip AS "lastIp",
          user_agent AS "userAgent",
          messages_created AS "messagesCreated",
          created_at AS "createdAt",
          last_login_at AS "lastLoginAt"
        FROM users
        ORDER BY last_login_at DESC
        LIMIT 500
      `),
      pool.query(`
        SELECT
          id,
          sender_email AS "senderEmail",
          sender_name AS "senderName",
          sender_ip AS "senderIp",
          has_pin AS "hasPin",
          has_image AS "hasImage",
          protection_mode AS "protectionMode",
          view_timer_seconds AS "viewTimerSeconds",
          status,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          opened_at AS "openedAt",
          opener_ip AS "openerIp",
          opener_user_agent AS "openerUserAgent"
        FROM message_logs
        ORDER BY created_at DESC
        LIMIT 200
      `)
    ]);

    return {
      stats: statsRes.rows[0] || {
        totalUsers: 0,
        activeUsersToday: 0,
        licensedUsers: 0,
        unlicensedUsers: 0,
        totalMessages: 0,
        destroyedMessages: 0,
        pendingMessages: 0,
        expiredMessages: 0
      },
      users: (usersRes.rows || []).map((u) => ({
        ...u,
        trialLimit: Number(process.env.FREE_TRIAL_LIMIT) || 3
      })),
      logs: logsRes.rows
    };
  }

  const usersArr = Array.from(memoryUsers.values());
  const logsArr = Array.from(memoryLogs.values()).reverse();
  const licensedCount = usersArr.filter((u) => u.licenseStatus === 'active' || u.licenseStatus === 'expiring').length;
  return {
    stats: {
      totalUsers: usersArr.length,
      activeUsersToday: usersArr.length,
      licensedUsers: licensedCount,
      unlicensedUsers: usersArr.length - licensedCount,
      totalMessages: logsArr.length,
      destroyedMessages: logsArr.filter((l) => l.status === 'destroyed').length,
      pendingMessages: logsArr.filter((l) => l.status === 'pending').length,
      expiredMessages: logsArr.filter((l) => l.status === 'expired').length
    },
    users: usersArr.map((u) => ({
      ...u,
      trialLimit: Number(process.env.FREE_TRIAL_LIMIT) || 3
    })),
    logs: logsArr
  };
}

export async function deleteUserById(userId) {
  if (isPostgresReady && pool) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return true;
  }
  for (const [email, u] of memoryUsers.entries()) {
    if (String(u.id) === String(userId)) {
      memoryUsers.delete(email);
      return true;
    }
  }
  return false;
}

export async function adminForceDestroyMessage(messageId) {
  if (isPostgresReady && pool) {
    await pool.query('DELETE FROM secret_messages WHERE id = $1', [messageId]);
    await pool.query(
      `UPDATE message_logs
       SET status = 'destroyed',
           opened_at = COALESCE(opened_at, NOW()),
           opener_ip = COALESCE(opener_ip, 'Admin Force Destroy')
       WHERE id = $1`,
      [messageId]
    );
    return true;
  }
  memoryFallback.delete(messageId);
  if (memoryLogs.has(messageId)) {
    const l = memoryLogs.get(messageId);
    l.status = 'destroyed';
    l.openedAt = new Date().toISOString();
    l.openerIp = 'Admin Force Destroy';
  }
  return true;
}

export async function cleanupExpiredMessages() {
  if (isPostgresReady && pool) {
    try {
      await pool.query('DELETE FROM secret_messages WHERE expires_at <= NOW()');
      await pool.query(`UPDATE message_logs SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()`);
    } catch {
      // Abaikan error periodik
    }
    return;
  }

  const now = Date.now();
  for (const [id, record] of memoryFallback.entries()) {
    if (record.expiresAt <= now) {
      memoryFallback.delete(id);
    }
  }
}

export function getStorageEngineName() {
  return isPostgresReady ? 'PostgreSQL' : 'In-Memory Fallback';
}

// ============================================================================
// MANAJEMEN WEB PUSH SUBSCRIPTION ADMIN & PENGGUNA (READ RECEIPT)
// ============================================================================

export async function saveAdminPushSubscription(subscription, userAgent = '') {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return false;
  }

  if (isPostgresReady && pool) {
    await pool.query(
      `INSERT INTO admin_push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent]
    );
    return true;
  }

  memoryPushSubscriptions.set(subscription.endpoint, {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    userAgent,
    createdAt: new Date().toISOString()
  });
  return true;
}

export async function removeAdminPushSubscription(endpoint) {
  if (!endpoint) return;
  if (isPostgresReady && pool) {
    await pool.query('DELETE FROM admin_push_subscriptions WHERE endpoint = $1', [endpoint]).catch(() => {});
    return;
  }
  memoryPushSubscriptions.delete(endpoint);
}

export async function getAllAdminPushSubscriptions() {
  if (isPostgresReady && pool) {
    const res = await pool.query('SELECT endpoint, p256dh, auth, user_agent AS "userAgent" FROM admin_push_subscriptions');
    return res.rows.map((r) => ({
      endpoint: r.endpoint,
      keys: {
        p256dh: r.p256dh,
        auth: r.auth
      },
      userAgent: r.userAgent
    }));
  }
  return Array.from(memoryPushSubscriptions.values());
}

export async function saveUserPushSubscription(email, subscription, userAgent = '') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return false;
  }

  if (isPostgresReady && pool) {
    await pool.query(
      `INSERT INTO user_push_subscriptions (endpoint, user_email, p256dh, auth, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint) DO UPDATE SET
         user_email = EXCLUDED.user_email,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent`,
      [subscription.endpoint, cleanEmail, subscription.keys.p256dh, subscription.keys.auth, userAgent]
    );
    return true;
  }

  memoryUserPushSubscriptions.set(subscription.endpoint, {
    endpoint: subscription.endpoint,
    email: cleanEmail,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    userAgent
  });
  return true;
}

export async function getUserPushSubscriptionsByEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return [];

  if (isPostgresReady && pool) {
    const res = await pool
      .query(
        'SELECT endpoint, p256dh, auth FROM user_push_subscriptions WHERE user_email = $1',
        [cleanEmail]
      )
      .catch(() => ({ rows: [] }));
    return res.rows.map((r) => ({
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth }
    }));
  }

  return Array.from(memoryUserPushSubscriptions.values()).filter((s) => s.email === cleanEmail);
}

export async function removeUserPushSubscription(endpoint) {
  if (!endpoint) return;
  if (isPostgresReady && pool) {
    await pool.query('DELETE FROM user_push_subscriptions WHERE endpoint = $1', [endpoint]).catch(() => {});
    return;
  }
  memoryUserPushSubscriptions.delete(endpoint);
}

// ============================================================================
// PENGATURAN APLIKASI & GOOGLE OAUTH 2.0 (DISIMPAN DI POSTGRESQL)
// ============================================================================

export async function getAppSettings() {
  const defaults = {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    strictGoogleOAuth: process.env.STRICT_GOOGLE_OAUTH === 'true' ? 'true' : 'false',
    adminWhatsapp: (process.env.ADMIN_WHATSAPP || '').replace(/[^0-9]/g, '')
  };

  if (isPostgresReady && pool) {
    try {
      const res = await pool.query('SELECT key, value FROM app_settings');
      for (const row of res.rows) {
        if (row.key in defaults && row.value !== undefined) {
          defaults[row.key] = row.value;
        }
      }
    } catch {
      // Gunakan defaults jika gagal query
    }
    return {
      googleClientId: String(defaults.googleClientId || '').trim(),
      strictGoogleOAuth: defaults.strictGoogleOAuth === 'true',
      adminWhatsapp: String(defaults.adminWhatsapp || '').replace(/[^0-9]/g, '')
    };
  }

  for (const [k, v] of memorySettings.entries()) {
    defaults[k] = v;
  }
  return {
    googleClientId: String(defaults.googleClientId || '').trim(),
    strictGoogleOAuth: defaults.strictGoogleOAuth === 'true',
    adminWhatsapp: String(defaults.adminWhatsapp || '').replace(/[^0-9]/g, '')
  };
}

export async function saveAppSettings({ googleClientId, strictGoogleOAuth, adminWhatsapp }) {
  const entries = [];
  if (googleClientId !== undefined) {
    entries.push(['googleClientId', String(googleClientId).trim()]);
  }
  if (strictGoogleOAuth !== undefined) {
    entries.push(['strictGoogleOAuth', strictGoogleOAuth ? 'true' : 'false']);
  }
  if (adminWhatsapp !== undefined) {
    entries.push(['adminWhatsapp', String(adminWhatsapp).replace(/[^0-9]/g, '')]);
  }

  if (isPostgresReady && pool) {
    for (const [k, v] of entries) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [k, v]
      );
    }
  } else {
    for (const [k, v] of entries) {
      memorySettings.set(k, v);
    }
  }

  return getAppSettings();
}

