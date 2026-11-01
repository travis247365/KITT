// SQLite via node:sqlite (built in since Node 22.5). One file, WAL mode, versioned migrations.
import { DatabaseSync } from 'node:sqlite';

const CORE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE IF NOT EXISTS kv (ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (ns, key));
   CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL DEFAULT (datetime('now')),
     source TEXT NOT NULL,            -- siri | cli | cron | whatsapp | web
     skill TEXT, intent TEXT,
     input TEXT,                      -- redacted, truncated
     outcome TEXT NOT NULL,           -- ok | error | needs_confirm | denied | unknown
     detail TEXT, latency_ms INTEGER
   );
   CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
   CREATE TABLE IF NOT EXISTS routine_runs (
     name TEXT PRIMARY KEY, last_run_at TEXT, last_status TEXT, last_summary TEXT, last_duration_ms INTEGER, run_count INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS pending_actions (
     code TEXT PRIMARY KEY, source TEXT NOT NULL, skill TEXT NOT NULL, summary TEXT NOT NULL, action TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
   );
   CREATE TABLE IF NOT EXISTS continuations (
     source TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS spool (
     id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT
   );`,
  // 1 Nov 2026 (Run 0 of docs/RUN_PLAN_3X.md): did the deterministic grammar answer (1) or did it fall through to the LLM / nothing (0)?
  `ALTER TABLE audit ADD COLUMN intent_hit INTEGER;`,
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Apply migrations for a namespace (core or a skill id). Idempotent; tracks applied count in meta. */
export function migrate(db, ns, migrations) {
  const key = `migrations:${ns}`;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  let applied = row ? Number(row.value) : 0;
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[i]);
      db.prepare('INSERT INTO meta(key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, String(i + 1));
      db.exec('COMMIT');
      applied = i + 1;
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${ns}#${i + 1} failed: ${e.message}`);
    }
  }
  return applied;
}

export function migrateCore(db) {
  // meta must exist before migrate() can read it.
  db.exec(CORE_MIGRATIONS[0]);
  return migrate(db, 'core', CORE_MIGRATIONS);
}

export const kv = {
  get(db, ns, key, fallback = null) {
    const r = db.prepare('SELECT value FROM kv WHERE ns = ? AND key = ?').get(ns, key);
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch { return r.value; }
  },
  set(db, ns, key, value) {
    db.prepare('INSERT INTO kv(ns, key, value, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(ns, key, JSON.stringify(value));
  },
  del(db, ns, key) { db.prepare('DELETE FROM kv WHERE ns = ? AND key = ?').run(ns, key); },
  list(db, ns) { return db.prepare('SELECT key, value, updated_at FROM kv WHERE ns = ? ORDER BY key').all(ns).map((r) => ({ key: r.key, value: safeJson(r.value), updated_at: r.updated_at })); },
};

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }
