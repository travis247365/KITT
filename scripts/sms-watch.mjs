#!/usr/bin/env node
// One pass of the Mac-side money SMS feed, by hand: the same code the hub's `money.sms_watch` routine runs every 10 minutes
// (src/skills/money/smswatch.js). Reads ~/Library/Messages/chat.db, so whatever runs this needs Full Disk Access
// (System Settings > Privacy & Security > Full Disk Access: Terminal, when run from Terminal).
//
//   node scripts/sms-watch.mjs                         new messages since the last pass
//   node scripts/sms-watch.mjs --since 2026-11-05      re-read everything from that date (safe: the ledger and the raw log
//                                                      both skip what they already have), then carry on from the newest
//
// First run without a cursor: starts watching from now (history is the one-off backfill's job).
import path from 'node:path';
import { createApp } from '../src/app.js';
import { smsWatchOnce, readCursor, writeCursor } from '../src/skills/money/smswatch.js';

const app = await createApp();
const money = app.skills.money;
if (!money) { console.error('money skill unavailable'); process.exit(1); }
const cursorFile = path.join(app.paths?.configDir || path.join(process.env.HOME, '.config/kitt'), 'sms-watch-cursor.json');
const i = process.argv.indexOf('--since');
if (i > 0) {
  const since = new Date(process.argv[i + 1]);
  if (Number.isNaN(since.getTime())) { console.error('--since needs a date, e.g. 2026-11-05'); process.exit(1); }
  writeCursor(cursorFile, (readCursor(cursorFile) || { rowid: 0 }).rowid, since.toISOString());
}
try {
  const r = smsWatchOnce({ money, cursorFile, ctx: app });
  console.log(r.summary);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
