// Two-step confirmation for anything that writes, sends, spends or changes something visible.
// KITT has one owner, so there is ONE pending action at a time and ANY channel may confirm it (Siri, watch, app, CLI):
// a draft asked for by voice can be confirmed from the wrist. The originating channel is kept for the audit trail.
import crypto from 'node:crypto';

const TTL_MIN = 10;

// The code is the table's primary key and only has 89 values, so finished rows are pruned and an unused code is chosen.
function freeCode(db) {
  db.prepare("DELETE FROM pending_actions WHERE status != 'pending' AND created_at < datetime('now', '-1 day')").run();
  for (let i = 0; i < 40; i++) {
    const code = crypto.randomInt(10, 99).toString();
    if (!db.prepare('SELECT 1 FROM pending_actions WHERE code = ?').get(code)) return code;
  }
  // every code is taken by a recent row: drop finished rows (the audit table keeps the history), then pick again
  db.prepare("DELETE FROM pending_actions WHERE status != 'pending'").run();
  for (;;) {
    const code = crypto.randomInt(10, 99).toString();
    if (!db.prepare('SELECT 1 FROM pending_actions WHERE code = ?').get(code)) return code;
  }
}

export function createPending(db, { source, skill, summary, action }) {
  db.prepare("UPDATE pending_actions SET status = 'superseded' WHERE status = 'pending'").run();
  const code = freeCode(db);
  db.prepare("INSERT INTO pending_actions(code, source, skill, summary, action, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))")
    .run(code, source, skill, summary, JSON.stringify(action), `+${TTL_MIN} minutes`);
  return { code, summary, expires_in_min: TTL_MIN };
}

export function getPending(db) {
  db.prepare("UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')").run();
  const row = db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1").get();
  return row ? { ...row, action: JSON.parse(row.action) } : null;
}

export function resolvePending(db, code, status) {
  db.prepare('UPDATE pending_actions SET status = ? WHERE code = ?').run(status, code);
}

/** Take the single right to act on a pending action. Returns false if it was already taken, resolved or superseded:
 *  two overlapping confirms (or a confirm and a cancel) can never both run. */
export function claimPending(db, code, status = 'executing') {
  return db.prepare("UPDATE pending_actions SET status = ? WHERE code = ? AND status = 'pending'").run(status, code).changes === 1;
}

export function listPending(db) {
  db.prepare("UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')").run();
  return db.prepare("SELECT code, source, skill, summary, created_at, expires_at FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC").all();
}
