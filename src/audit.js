import { redact } from './log.js';

export function recordAudit(db, { source, skill, intent, input, outcome, detail, latency_ms }) {
  try {
    db.prepare('INSERT INTO audit(source, skill, intent, input, outcome, detail, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(source || 'unknown', skill || null, intent || null, input ? redact(String(input)).slice(0, 500) : null, outcome || 'unknown', detail ? redact(String(detail)).slice(0, 1000) : null, latency_ms ?? null);
  } catch { /* auditing must never break a request */ }
}

export function tailAudit(db, limit = 50) {
  return db.prepare('SELECT id, ts, source, skill, intent, input, outcome, detail, latency_ms FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(500, Math.max(1, limit)));
}
