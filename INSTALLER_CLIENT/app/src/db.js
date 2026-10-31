import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

/**
 * Modul Database PostgreSQL untuk PesanRahasia:
 * 1. Tabel `users` & `user_sessions` -> Menyimpan data pengguna yang login dengan Gmail.
 * 2. Tabel `secret_messages` -> Menyimpan ciphertext sekali baca (dihapus permanen saat dibaca).
 * 3. Tabel `message_logs` -> Menyimpan log aktivitas pengirim & status kapan pesan dibuka/hancur untuk Dashboard Admin.
 */
const memoryFallback = new Map();
const memoryUsers = new Map();
const memorySessions = new Map();
const memoryLogs = new Map();

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

    // Pastikan kolom user_id & kolom lisensi VOC ML ada jika tabel dibuat dari versi sebelumnya
    await pool.query(`ALTER TABLE secret_messages ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS machine_id VARCHAR(64);`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_status VARCHAR(32) DEFAULT 'pending';`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_expires_at VARCHAR(64);`).catch(() => {});

    isPostgresReady = true;
    console.log('[PostgreSQL] ✅ Terhubung ke PostgreSQL & tabel (users, secret_messages, message_logs) siap digunakan.');
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
    const userRes = await pool.query(
      `INSERT INTO users (email, name, picture, auth_provider, last_ip, user_agent, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
         picture = COALESCE(NULLIF(EXCLUDED.picture, ''), users.picture),
         last_ip = EXCLUDED.last_ip,
         user_agent = EXCLUDED.user_agent,
         last_login_at = NOW()
       RETURNING id, email, name, picture, messages_created AS "messagesCreated", created_at AS "createdAt", last_login_at AS "lastLoginAt"`,
      [cleanEmail, cleanName, picture, provider, ip, userAgent]
    );
    const user = userRes.rows[0];

    await pool.query(
      `INSERT INTO user_sessions (token, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [sessionToken, user.id, expiresAtMs]
    );

    return { user, token: sessionToken };
  }

  // Fallback In-Memory
  let existing = memoryUsers.get(cleanEmail);
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
  return { user: existing, token: sessionToken };
}

export async function getUserBySessionToken(token) {
  if (!token) return null;

  if (isPostgresReady && pool) {
    const res = await pool.query(
      `SELECT u.id, u.email, u.name, u.picture, u.messages_created AS "messagesCreated", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"
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

// ============================================================================
// MANAJEMEN PESAN RAHASIA & LOG AKTIVITAS
// ============================================================================

export async function createSecretMessage({
  id,
  user,
  senderIp = '',
  ciphertext,
  iv,
  protectionMode,
  viewTimerSeconds,
  expiresAt
}) {
  if (isPostgresReady && pool) {
    await pool.query(
      `INSERT INTO secret_messages (id, user_id, ciphertext, iv, protection_mode, view_timer_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
      [id, user?.id || null, ciphertext, iv, protectionMode, viewTimerSeconds, expiresAt]
    );

    if (user?.id) {
      await pool.query(`UPDATE users SET messages_created = messages_created + 1, last_login_at = NOW() WHERE id = $1`, [user.id]);
    }

    await pool.query(
      `INSERT INTO message_logs (id, user_id, sender_email, sender_name, sender_ip, protection_mode, view_timer_seconds, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', to_timestamp($8 / 1000.0))`,
      [
        id,
        user?.id || null,
        user?.email || 'anonymous@gmail.com',
        user?.name || 'Pengguna',
        senderIp,
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
    protectionMode,
    viewTimerSeconds,
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
  return record;
}

export async function consumeSecretMessage(id, { openerIp = '', openerUserAgent = '' } = {}) {
  if (isPostgresReady && pool) {
    const res = await pool.query(
      `DELETE FROM secret_messages
       WHERE id = $1 AND expires_at > NOW()
       RETURNING id,
                 ciphertext,
                 iv,
                 protection_mode AS "protectionMode",
                 view_timer_seconds AS "viewTimerSeconds"`,
      [id]
    );
    const row = res.rows[0] || null;
    if (row) {
      await pool
        .query(
          `UPDATE message_logs
           SET status = 'destroyed',
               opened_at = NOW(),
               opener_ip = $2,
               opener_user_agent = $3
           WHERE id = $1`,
          [id, openerIp, openerUserAgent]
        )
        .catch(() => {});
    }
    return row;
  }

  const record = memoryFallback.get(id);
  memoryFallback.delete(id);
  if (!record || record.expiresAt <= Date.now()) {
    return null;
  }
  if (memoryLogs.has(id)) {
    const log = memoryLogs.get(id);
    log.status = 'destroyed';
    log.openedAt = new Date().toISOString();
    log.openerIp = openerIp;
    log.openerUserAgent = openerUserAgent;
  }
  return record;
}

// ============================================================================
// STATISTIK & DATA DASHBOARD ADMIN (/admin)
// ============================================================================

export async function getAdminDashboardData() {
  if (isPostgresReady && pool) {
    // Tandai log yang sudah lewat waktu kedaluwarsanya
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
      users: usersRes.rows,
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
    users: usersArr,
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
