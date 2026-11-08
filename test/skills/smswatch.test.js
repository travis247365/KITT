import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCore, migrate } from '../../src/db.js';
import define from '../../src/skills/money/index.js';
import { smsWatchOnce, textFromAttributedBody, readNewSms, writeCursor } from '../../src/skills/money/smswatch.js';

const APPLE = 978307200;
const appleNs = (iso) => (Math.floor(Date.parse(iso) / 1000) - APPLE) * 1e9;
// an archived NSAttributedString as Messages stores it when `text` is empty (header, class name, 5 bytes, length, UTF-8)
function attributed(text) {
  const t = Buffer.from(text, 'utf8');
  const len = t.length < 0x81 ? Buffer.from([t.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([t.length & 0xff, t.length >> 8])]);
  return Buffer.concat([Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08', 'latin1'), Buffer.from('NSString'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), len, t, Buffer.from([0x86, 0x84])]);
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-smswatch-'));
  const chatDb = path.join(dir, 'chat.db');
  const chat = new DatabaseSync(chatDb);
  chat.exec('CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT); CREATE TABLE message (ROWID INTEGER PRIMARY KEY, handle_id INTEGER, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER DEFAULT 0);');
  chat.exec("INSERT INTO handle(ROWID, id) VALUES (1, 'MoMo'), (2, 'AirtelMoney'), (3, 'Friend')");
  chat.prepare('INSERT INTO message(handle_id, text, date) VALUES (3, ?, ?)').run('see you at 6', appleNs('2026-11-01T08:00:00Z'));
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  const store = new Map();
  const ctx = { db, config: {}, log: { info() {}, warn() {}, error() {}, debug() {} }, paths: { configDir: dir, dataDir: dir }, kv: { get: (ns, k, f) => store.get(`${ns}:${k}`) ?? f, set: (ns, k, v) => store.set(`${ns}:${k}`, v), del: (ns, k) => store.delete(`${ns}:${k}`) } };
  const money = define(ctx); migrate(db, money.id, money.migrations);
  return { dir, chatDb, chat, db, money, kv: ctx.kv, cursorFile: path.join(dir, 'sms-watch-cursor.json') };
}

test('attributedBody: the text of a message stored only as an archived string, short and long', () => {
  assert.equal(textFromAttributedBody(attributed('You have withdrawn 500 ZMW')), 'You have withdrawn 500 ZMW');
  const long = 'x'.repeat(300);
  assert.equal(textFromAttributedBody(attributed(long)), long);
  assert.equal(textFromAttributedBody(null), null);
  assert.equal(textFromAttributedBody(Buffer.from('no string here')), null);
});

test('sms watch: first pass only sets the cursor; later passes read money senders (text or attributedBody) once', () => {
  const { chatDb, chat, db, money, cursorFile } = setup();
  const first = smsWatchOnce({ money, cursorFile, chatDb });
  assert.equal(first.first, true); assert.equal(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).rowid, 1);
  chat.prepare('INSERT INTO message(handle_id, text, date) VALUES (1, ?, ?)').run('You have transferred 150 ZMW to SAMPLE PERSON (100200300) from your mobile money account 100200400 at 2026-11-06 10:11:12. Your new balance: 50 ZMW. Financial Transaction Id: 1001.', appleNs('2026-11-06T08:11:12Z'));
  chat.prepare('INSERT INTO message(handle_id, text, attributedBody, date) VALUES (2, NULL, ?, ?)').run(attributed('Money sent to SAMPLE RECEIVER on 976000111. Amount ZMW 40.00. Your balance is ZMW 10.00. Txn. ID: PP261106.1034.H09137.'), appleNs('2026-11-06T09:00:00Z'));
  chat.prepare('INSERT INTO message(handle_id, text, date) VALUES (3, ?, ?)').run('lunch?', appleNs('2026-11-06T09:30:00Z'));
  chat.prepare('INSERT INTO message(handle_id, text, date, is_from_me) VALUES (1, ?, ?, 1)').run('BAL', appleNs('2026-11-06T09:40:00Z'));
  const r = smsWatchOnce({ money, cursorFile, chatDb });
  assert.equal(r.read, 2); assert.equal(r.parsed, 2); assert.equal(r.added, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM money_tx WHERE direction = 'out'").get().n, 2);
  assert.equal(db.prepare("SELECT ts FROM money_tx WHERE provider = 'mtn_momo'").get().ts, '2026-11-06T08:11:12.000Z');
  assert.equal(smsWatchOnce({ money, cursorFile, chatDb }).summary, 'no new messages');
  // a re-scan from a date reads them again and adds nothing, then carries on by message number
  writeCursor(cursorFile, 0, '2026-11-05T00:00:00Z');
  const again = smsWatchOnce({ money, cursorFile, chatDb });
  assert.equal(again.read, 2); assert.equal(again.added, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM money_tx').get().n, 2); assert.equal(db.prepare('SELECT count(*) n FROM money_raw').get().n, 2);
  const c = JSON.parse(fs.readFileSync(cursorFile, 'utf8')); assert.equal(c.since, undefined); assert.equal(c.rowid, 3);
});

test('sms watch: an unreadable Messages database is an error with a reason, and turns the money skill red', { skip: process.platform !== 'darwin' }, async () => {
  const { dir, money, kv } = setup();
  assert.throws(() => readNewSms({ chatDb: path.join(dir, 'missing', 'chat.db'), cursor: { rowid: 0 } }), (e) => e.code === 'NO_CHAT_DB');
  const routine = money.routines.find((r) => r.name === 'money.sms_watch');
  assert.ok(routine && routine.enabled !== false);
  assert.equal((await money.health()).ok, true);
  kv.set('money', 'sms_watch', { at: '2026-11-08T10:00:00.000Z', ok: false, detail: 'cannot read the Messages database: no Full Disk Access' });
  const h = await money.health();
  assert.equal(h.ok, false); assert.match(h.detail, /SMS feed down since 2026-11-08 10:00 UTC: cannot read the Messages database/);
  kv.set('money', 'sms_watch', { at: '2026-11-08T10:10:00.000Z', ok: true, detail: 'no new messages' });
  assert.equal((await money.health()).ok, true);
});

test('sms watch: a Messages database macOS refuses to open is reported as missing Full Disk Access', { skip: process.platform !== 'darwin' }, () => {
  const { dir } = setup();
  const locked = path.join(dir, 'locked.db'); fs.writeFileSync(locked, ''); fs.chmodSync(locked, 0o000);
  try { assert.throws(() => readNewSms({ chatDb: locked, cursor: { rowid: 0 } }), (e) => e.code === 'NO_FULL_DISK_ACCESS' && /Full Disk Access/.test(e.message)); }
  finally { fs.chmodSync(locked, 0o600); }
});
