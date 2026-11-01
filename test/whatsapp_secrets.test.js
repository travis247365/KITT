import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setEnvValue, writeSecret, listSecretNames, checkBoardLogin } from '../src/secrets.js';
import { parseEnvFile } from '../src/config.js';
import defineWhatsapp from '../src/skills/whatsapp/index.js';

test('setEnvValue replaces, de-duplicates, appends, and round-trips through parseEnvFile', () => {
  const base = '# KITT secrets\nKITT_TOKEN=abc\n# Optional: KITT_COO_PASSWORD=ignored comment\nKITT_COO_PASSWORD=old\nKITT_COO_PASSWORD=dup\n';
  const out = setEnvValue(base, 'KITT_COO_PASSWORD', 'new pass#word=1');
  assert.equal((out.match(/^KITT_COO_PASSWORD=/gm) || []).length, 1);
  assert.match(out, /# Optional: KITT_COO_PASSWORD=ignored comment/);
  assert.equal(parseEnvFile(out).KITT_COO_PASSWORD, 'new pass#word=1');
  assert.equal(parseEnvFile(out).KITT_TOKEN, 'abc');
  assert.equal(parseEnvFile(setEnvValue('', 'KITT_EMAIL_TO', 'a@b.co')).KITT_EMAIL_TO, 'a@b.co');
  assert.equal(parseEnvFile(setEnvValue('X=1\n', 'KITT_COO_PASSWORD', ' lead')).KITT_COO_PASSWORD, ' lead');
  assert.throws(() => setEnvValue('', 'KITT_COO_PASSWORD', 'a\nb'));
  assert.throws(() => setEnvValue('', 'lower', 'x'));
  assert.throws(() => setEnvValue('', 'KITT_COO_PASSWORD', ''));
});

test('writeSecret keeps mode 600, one .bak, and listSecretNames never returns values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-sec-'));
  const env = path.join(dir, 'kitt.env');
  fs.writeFileSync(env, 'KITT_TOKEN=keepme\n', { mode: 0o600 });
  writeSecret(env, 'KITT_COO_PASSWORD', 'p4ss');
  assert.equal(fs.statSync(env).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${env}.bak`).mode & 0o777, 0o600);
  assert.deepEqual(listSecretNames(env), ['KITT_TOKEN', 'KITT_COO_PASSWORD']);
  assert.equal(parseEnvFile(fs.readFileSync(env, 'utf8')).KITT_TOKEN, 'keepme');
});

test('checkBoardLogin uses the team route or the account route, and never leaks the cookie', async () => {
  const ok = await checkBoardLogin('https://board.example/', 'pw', { fetchImpl: async (url, init) => { assert.equal(url, 'https://board.example/api/login'); assert.deepEqual(JSON.parse(init.body), { password: 'pw' }); return { ok: true, status: 200, json: async () => ({ role: 'member' }) }; } });
  assert.deepEqual(ok, { ok: true, role: 'member', via: 'team password' });
  const acct = await checkBoardLogin('https://board.example', 'pw', { email: 'kitt@example.com', fetchImpl: async (url, init) => { assert.equal(url, 'https://board.example/api/auth/login'); assert.deepEqual(JSON.parse(init.body), { email: 'kitt@example.com', password: 'pw' }); return { ok: true, status: 200, json: async () => ({ role: 'member' }) }; } });
  assert.deepEqual(acct, { ok: true, role: 'member', via: 'account' });
  assert.deepEqual(await checkBoardLogin('https://b', 'pw', { fetchImpl: async () => ({ ok: false, status: 401 }) }), { ok: false, status: 401, via: 'team password' });
  assert.equal((await checkBoardLogin('https://b', 'pw', { fetchImpl: async () => { throw new Error('offline'); } })).ok, false);
});

test('WhatsApp health is green only when the listener is linked and fresh', async () => {
  let hb = null;
  const ctx = { db: { prepare: () => ({ all: () => [], get: () => ({}) }) }, config: { whatsapp: {} }, brain: {}, kv: { get: (_ns, k) => (k === 'heartbeat' ? hb : null), set() {}, del() {} } };
  const wa = defineWhatsapp(ctx);
  assert.equal((await wa.health()).ok, false); assert.match((await wa.health()).detail, /kitt whatsapp link/);
  hb = { at: new Date().toISOString(), state: 'qr_waiting', port: 7899 };
  const q = await wa.health(); assert.equal(q.ok, false); assert.match(q.detail, /waiting for the QR scan.*127\.0\.0\.1:7899/);
  hb = { at: new Date().toISOString(), state: 'open' };
  assert.equal((await wa.health()).ok, true);
  hb = { at: new Date(Date.now() - 3600e3).toISOString(), state: 'open' };
  const stale = await wa.health(); assert.equal(stale.ok, false); assert.match(stale.detail, /silent/);
});
