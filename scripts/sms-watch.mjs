#!/usr/bin/env node
// Watches Messages.app for new mobile-money/bank SMS and logs them into the money ledger - the job the never-set-up
// iPhone "Kit SMS Relay" Shortcut (docs/SETUP.md, "Money SMS relay") was meant to do. This does it from the Mac side
// instead, reading ~/Library/Messages/chat.db directly (needs Full Disk Access on Terminal/whatever runs this -
// System Settings > Privacy & Security > Full Disk Access). Calls the money skill directly, the same in-process
// path `bin/kitt sms` already uses for a manual entry - no HTTP, so the hub's own write-scope rate limiter never
// sees this traffic (that limiter is a real anti-abuse control; this script is trusted local automation, not an
// external client).
//
// Idempotent twice over: ingestSms dedupes every write by a content hash, and the cursor file below stops this
// from ever re-scanning history past the point it first ran.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');
const CURSOR_FILE = path.join(os.homedir(), '.config/kitt/sms-watch-cursor.json');
// The same sender list the one-off 5-Nov-2026 historical backfill used.
const SENDERS = ['MoMo', 'momo', 'AirtelMoney', 'MoMoCard', 'Stanbic', 'stanbic', 'standardbnk', '+13622']; // add your own lenders' sender ids here

function readCursor() {
  try { return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).rowid; } catch { return null; }
}
function writeCursor(rowid) {
  fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ rowid, updated_at: new Date().toISOString() }));
}

const chat = new DatabaseSync(CHAT_DB, { readOnly: true });
let cursor = readCursor();
if (cursor == null) {
  // First run: start watching from now. History is the historical backfill's job, run once, separately.
  cursor = chat.prepare('SELECT MAX(ROWID) AS m FROM message').get().m || 0;
  writeCursor(cursor);
  chat.close();
  console.log(`first run: cursor set to message ${cursor} (now) - not re-scanning history`);
  process.exit(0);
}

const placeholders = SENDERS.map(() => '?').join(',');
const rows = chat.prepare(`
  SELECT m.ROWID AS rowid, h.id AS sender, m.text AS body,
    strftime('%Y-%m-%dT%H:%M:%SZ', m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch') AS received_at
  FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
  WHERE m.ROWID > ? AND m.text IS NOT NULL AND m.text != '' AND h.id IN (${placeholders})
  ORDER BY m.ROWID ASC
`).all(cursor, ...SENDERS);
chat.close();

if (!rows.length) { console.log('no new messages'); process.exit(0); }

const app = await createApp();
const money = app.skills.money;
if (!money) { console.error('money skill unavailable'); process.exit(1); }
let parsed = 0, raw = 0;
for (const r of rows) {
  const out = money.ingestSms({ sender: r.sender, body: r.body, received_at: r.received_at }, { ...app, source: 'sms-watch' });
  if (out.parsed) parsed++; else raw++;
}
writeCursor(rows.at(-1).rowid);
console.log(`${rows.length} new message(s): ${parsed} parsed, ${raw} kept raw (unrecognised format, kept for review)`);
