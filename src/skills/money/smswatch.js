// The Mac side of the money SMS feed: reads new mobile-money and bank messages from Messages.app's database
// (~/Library/Messages/chat.db, synced from the iPhone by Text Message Forwarding) and hands them to the money skill.
// Used by the hub's `money.sms_watch` routine (every 10 minutes while the hub runs) and by `scripts/sms-watch.mjs`.
//
// Reading chat.db needs Full Disk Access for the app the hub runs under (Terminal, if it is started from Terminal; node itself
// under launchd). Without it SQLite answers "authorization denied"; that is reported as such, so the board shows the feed is
// down instead of the ledger quietly going stale (it did, from 5 to 8 Nov 2026, because nothing ran the watcher at all).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');
// the mobile-money and bank sender ids to read (MTN, Airtel, Stanbic, FNB inContact); add your own lenders' ids
export const SMS_SENDERS = ['MoMo', 'momo', 'AirtelMoney', 'MoMoCard', 'Stanbic', 'stanbic', 'standardbnk', '+13622'];
const APPLE_EPOCH_S = 978307200;   // 2001-01-01T00:00:00Z: chat.db dates are nanoseconds since then

/** Newer macOS keeps some messages' text only in `attributedBody` (an archived NSAttributedString), with `text` empty. */
export function textFromAttributedBody(blob) {
  if (!blob) return null;
  const b = Buffer.from(blob);
  const at = b.indexOf('NSString');
  if (at < 0) return null;
  let p = at + 'NSString'.length + 5;          // class header bytes, then the length
  if (p >= b.length) return null;
  let len = b[p]; p += 1;
  if (len === 0x81) { len = b.readUInt16LE(p); p += 2; }
  else if (len === 0x82) { len = b.readUInt32LE(p); p += 4; }
  const s = b.subarray(p, p + len).toString('utf8');
  return s || null;
}

export function readCursor(file) {
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return { rowid: Number(c.rowid) || 0, since: c.since || null }; } catch { return null; }
}
export function writeCursor(file, rowid, since = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ rowid, ...(since ? { since } : {}), updated_at: new Date().toISOString() }));
}

/** Messages from the money senders after the cursor (or, when the cursor carries `since`, from that time on). */
export function readNewSms({ chatDb = CHAT_DB, cursor, senders = SMS_SENDERS }) {
  let chat;
  try { chat = new DatabaseSync(chatDb, { readOnly: true }); }
  catch (e) {
    const denied = /authori[sz]ation denied|not authori[sz]ed|operation not permitted/i.test(e.message);
    const err = new Error(denied
      ? 'cannot read the Messages database: the app running the hub has no Full Disk Access (System Settings > Privacy & Security > Full Disk Access; Terminal if the hub is started from Terminal), then restart the hub from there'
      : `cannot open the Messages database (${e.message})`);
    err.code = denied ? 'NO_FULL_DISK_ACCESS' : 'CHAT_DB_UNAVAILABLE';
    throw err;
  }
  try {
    const max = chat.prepare('SELECT MAX(ROWID) AS m FROM message').get().m || 0;
    if (!cursor) return { first: true, rows: [], maxRowid: max };
    const ph = senders.map(() => '?').join(',');
    const where = cursor.since ? 'm.date >= ?' : 'm.ROWID > ?';
    const from = cursor.since ? (Math.floor(Date.parse(cursor.since) / 1000) - APPLE_EPOCH_S) * 1e9 : cursor.rowid;
    const rows = chat.prepare(`
      SELECT m.ROWID AS rowid, h.id AS sender, m.text AS text, m.attributedBody AS ab,
        strftime('%Y-%m-%dT%H:%M:%SZ', m.date / 1000000000 + ${APPLE_EPOCH_S}, 'unixepoch') AS received_at
      FROM message m JOIN handle h ON m.handle_id = h.ROWID
      WHERE ${where} AND m.is_from_me = 0 AND h.id IN (${ph})
      ORDER BY m.ROWID ASC`).all(from, ...senders)
      .map((r) => ({ rowid: r.rowid, sender: r.sender, body: (r.text && r.text.trim()) ? r.text : textFromAttributedBody(r.ab), received_at: r.received_at }))
      .filter((r) => r.body);
    return { first: false, rows, maxRowid: Math.max(max, cursor.rowid) };
  } finally { chat.close(); }
}

/** One pass: read what is new, ingest it, move the cursor. Returns a summary; throws when chat.db cannot be read. */
export function smsWatchOnce({ money, cursorFile, chatDb, senders, source = 'sms-watch', ctx = {} }) {
  const cursor = readCursor(cursorFile);
  const { first, rows, maxRowid } = readNewSms({ chatDb, cursor, senders });
  if (first) { writeCursor(cursorFile, maxRowid); return { first: true, read: 0, parsed: 0, raw: 0, summary: `first run: watching from message ${maxRowid} (history is the backfill's job)` }; }
  let parsed = 0, raw = 0, added = 0;
  for (const r of rows) {
    const out = money.ingestSms({ sender: r.sender, body: r.body, received_at: r.received_at }, { ...ctx, source });
    if (out.parsed) { parsed++; if (!out.duplicate) added++; } else raw++;
  }
  // a cursor with `since` was a one-off re-scan from a date: afterwards continue by message number
  if (rows.length || cursor.since) writeCursor(cursorFile, rows.length ? Math.max(rows.at(-1).rowid, cursor.since ? 0 : cursor.rowid) : maxRowid);
  return { first: false, read: rows.length, parsed, added, raw, summary: rows.length ? `${rows.length} new message(s): ${added} new transaction(s), ${parsed - added} already logged, ${raw} kept raw` : 'no new messages' };
}
