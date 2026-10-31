import pg from 'pg';
const { Pool } = pg;

/**
 * Modul Database PostgreSQL untuk PesanRahasia.
 * Mendukung operasi Atomic Burn-After-Reading menggunakan:
 *   DELETE FROM secret_messages WHERE id = $1 AND expires_at > NOW() RETURNING ...
 */
const memoryFallback = new Map();
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
      CREATE TABLE IF NOT EXISTS secret_messages (
        id VARCHAR(32) PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        iv VARCHAR(64) NOT NULL,
        protection_mode VARCHAR(20) NOT NULL DEFAULT 'spotlight',
        view_timer_seconds INTEGER NOT NULL DEFAULT 60,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_secret_messages_expires_at ON secret_messages(expires_at);
    `);
    isPostgresReady = true;
    console.log('[PostgreSQL] ✅ Terhubung ke PostgreSQL & tabel "secret_messages" siap digunakan.');
    return true;
  } catch (err) {
    isPostgresReady = false;
    console.warn(`[PostgreSQL] ⚠️ Gagal terhubung ke PostgreSQL (${err.message}). Beralih otomatis ke In-Memory Vault.`);
    return false;
  }
}

export async function createSecretMessage({ id, ciphertext, iv, protectionMode, viewTimerSeconds, expiresAt }) {
  if (isPostgresReady && pool) {
    await pool.query(
      `INSERT INTO secret_messages (id, ciphertext, iv, protection_mode, view_timer_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
      [id, ciphertext, iv, protectionMode, viewTimerSeconds, expiresAt]
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

export async function consumeSecretMessage(id) {
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
    return res.rows[0] || null;
  }

  const record = memoryFallback.get(id);
  memoryFallback.delete(id);
  if (!record || record.expiresAt <= Date.now()) {
    return null;
  }
  return record;
}

export async function cleanupExpiredMessages() {
  if (isPostgresReady && pool) {
    try {
      await pool.query('DELETE FROM secret_messages WHERE expires_at <= NOW()');
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
