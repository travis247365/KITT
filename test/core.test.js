import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, matches, localParts, scheduledToday } from '../src/scheduler.js';
import { speakable, spokenList } from '../src/voice.js';
import { normalize, compilePattern, createIntentRouter } from '../src/intents/router.js';
import { parseEnvFile } from '../src/config.js';
import { identify, tokenTable, createRateLimiter } from '../src/auth.js';
import { redact } from '../src/log.js';
import { createRouter } from '../src/router.js';

test('cron parsing and matching', () => {
  const c = parseCron('0 7 * * 1-5');
  assert.deepEqual([...c.min], [0]); assert.deepEqual([...c.hour], [7]); assert.equal(c.dom, null); assert.deepEqual([...c.dow], [1, 2, 3, 4, 5]);
  assert.ok(matches(c, { min: 0, hour: 7, dom: 27, mon: 10, dow: 2 }));
  assert.ok(!matches(c, { min: 0, hour: 7, dom: 25, mon: 10, dow: 0 }));
  const every5 = parseCron('*/5 * * * *');
  assert.ok(matches(every5, { min: 15, hour: 3, dom: 1, mon: 1, dow: 1 }));
  assert.ok(!matches(every5, { min: 16, hour: 3, dom: 1, mon: 1, dow: 1 }));
  assert.throws(() => parseCron('61 * * * *'));
  assert.throws(() => parseCron('* * * *'));
});

test('local parts and scheduledToday in Africa/Lusaka (UTC+2)', () => {
  const now = new Date('2026-10-26T06:30:00Z'); // 08:30 CAT, Monday
  const p = localParts(now, 'Africa/Lusaka');
  assert.equal(p.hour, 8); assert.equal(p.min, 30); assert.equal(p.dow, 1);
  const sched = scheduledToday(parseCron('0 7 * * *'), now, 'Africa/Lusaka');
  assert.equal(sched.toISOString(), '2026-10-26T05:00:00.000Z');
  assert.equal(scheduledToday(parseCron('*/5 * * * *'), now, 'Africa/Lusaka'), null);
  assert.equal(scheduledToday(parseCron('0 7 * * 0'), now, 'Africa/Lusaka'), null); // Sunday-only, today is Monday
});

test('speakable strips markdown and spells money', () => {
  const r = speakable('**Cash**: K12,500 in MoMo, $11.99 for iCloud (3%). See [link](https://x.y)\n- item one\n- item two');
  assert.ok(!r.text.includes('*') && !r.text.includes('['));
  assert.match(r.text, /12,500 kwacha/);
  assert.match(r.text, /11\.99 dollars/);
  assert.match(r.text, /3 percent/);
  assert.match(r.text, /mobile money/);
  assert.equal(r.rest, '');
  const long = speakable(Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' '), { maxChars: 300 });
  assert.ok(long.text.length <= 340 && long.rest.length > 0);
  assert.match(long.text, /Kit, more/);
  assert.equal(spokenList(['a', 'b', 'c']), 'a, b, and c');
  assert.equal(spokenList(['a', 'b', 'c', 'd', 'e', 'f', 'g'], { max: 3 }), 'a, b, and c, and 4 more');
});

test('intent normalization, templates, and routing without a brain', async () => {
  assert.equal(normalize("Hey KITT, what's on my plate?"), "what's on my plate");
  assert.equal(normalize('Kit please run the security check.'), 'run the security check');
  const re = compilePattern('status of {item}');
  assert.equal(re.exec('status of the vendor addendum').groups.item, 'the vendor addendum');
  const re2 = compilePattern("(what's|what is) my cash position");
  assert.ok(re2.test("what's my cash position") && re2.test('what is my cash position'));
  const skills = [{ id: 'money', intents: [{ name: 'position', patterns: ["(what's|what is) my cash position", 'cash position'] }, { name: 'log_cash', patterns: ['log cash {amount} {note}', 'log cash {amount}'], write: true }] }];
  const r = createIntentRouter({ skills, brain: null });
  assert.deepEqual((await r.route("KITT what's my cash position")).intent, 'position');
  const lc = await r.route('kitt log cash 200 fuel');
  assert.equal(lc.intent, 'log_cash'); assert.deepEqual(lc.slots, { amount: '200', note: 'fuel' }); assert.equal(lc.write, true);
  assert.equal((await r.route('kitt confirm')).intent, 'confirm');
  assert.equal((await r.route('kitt good morning')).intent, 'morning');
  assert.equal((await r.route('kitt tell me a joke')).intent, 'unknown');
});

test('env parsing, tokens, rate limiter, redaction', () => {
  const env = parseEnvFile('# c\nA=1\nexport B="two words"\nC=\'x=y\'\nbad line\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x=y' });
  const table = tokenTable({ KITT_TOKEN: 'a'.repeat(40), KITT_FEED_TOKEN: 'f'.repeat(40) });
  assert.equal(identify(table, 'a'.repeat(40)).name, 'full');
  assert.equal(identify(table, 'a'.repeat(39) + 'b'), null);
  assert.equal(identify(table, 'short'), null);
  assert.ok(identify(table, 'f'.repeat(40)).scopes.includes('feed') && !identify(table, 'f'.repeat(40)).scopes.includes('read'));
  const take = createRateLimiter({ perMinute: 60, burst: 3 });
  assert.ok(take('k') && take('k') && take('k') && !take('k'));
  assert.ok(!redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789').includes('ijklmnop'));
  assert.ok(redact('key re_ABCDEFGHIJKLMNOP').includes('[redacted]'));
});

test('router params', () => {
  const r = createRouter(); r.get('/v1/brief/:name', () => 1); r.get('/feed/:token/audio/:file', () => 2);
  assert.equal(r.match('GET', '/v1/brief/morning').params.name, 'morning');
  assert.equal(r.match('GET', '/feed/abc/audio/x.m4a').params.file, 'x.m4a');
  assert.equal(r.match('POST', '/v1/brief/morning'), null);
  assert.equal(r.match('GET', '/v1/brief/morning/')?.params.name, 'morning');
});

test('confirmations are owner-scoped: asked on one channel, confirmed on another; forwarded requests reject URL tokens', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrateCore } = await import('../src/db.js');
  const { createPending, getPending, resolvePending } = await import('../src/confirm.js');
  const { extractToken, isForwarded, tokenTable, identify } = await import('../src/auth.js');
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  createPending(db, { source: 'siri', skill: 'money', summary: 'log cash 50', action: { type: 'log_cash' } });
  const p = getPending(db); assert.equal(p.source, 'siri'); assert.equal(p.skill, 'money');
  resolvePending(db, p.code, 'done'); assert.equal(getPending(db), null);
  createPending(db, { source: 'siri', skill: 'a', summary: '1', action: {} }); createPending(db, { source: 'watch', skill: 'b', summary: '2', action: {} });
  assert.equal(getPending(db).skill, 'b'); // latest supersedes, regardless of channel
  const url = new URL('http://x/dashboard?token=abcdefghijklmnopqrstuvwxyz');
  assert.equal(extractToken({ headers: {} }, url), 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(extractToken({ headers: { 'x-forwarded-for': '1.2.3.4' } }, url), null);
  assert.ok(isForwarded({ headers: { 'x-forwarded-proto': 'https' } }));
  const t = tokenTable({ KITT_APP_TOKEN: 'p'.repeat(40) }); const id = identify(t, 'p'.repeat(40));
  assert.ok(id.scopes.includes('write') && !id.scopes.includes('admin'));
});

test('pending actions: one claim wins, expired ones leave the listing, and codes never run out', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrateCore } = await import('../src/db.js');
  const { createPending, getPending, claimPending, listPending, resolvePending } = await import('../src/confirm.js');
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  const a = createPending(db, { source: 'tv', skill: 'money', summary: 'log cash 50', action: {} });
  assert.equal(claimPending(db, a.code), true);
  assert.equal(claimPending(db, a.code), false, 'a second confirm cannot take the same action');
  assert.equal(getPending(db), null, 'a claimed action is no longer pending');
  resolvePending(db, a.code, 'done');
  const b = createPending(db, { source: 'tv', skill: 'money', summary: 'log cash 70', action: {} });
  db.prepare("UPDATE pending_actions SET expires_at = datetime('now', '-1 minute') WHERE code = ?").run(b.code);
  assert.equal(listPending(db).length, 0, 'an expired action is not offered to a screen');
  for (let i = 0; i < 300; i++) { const p = createPending(db, { source: 'siri', skill: 'money', summary: `n${i}`, action: {} }); resolvePending(db, p.code, 'done'); }
  assert.equal(createPending(db, { source: 'siri', skill: 'money', summary: 'last', action: {} }).summary, 'last', 'codes are reused once their rows are finished');
});
