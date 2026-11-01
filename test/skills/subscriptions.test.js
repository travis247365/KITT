import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateCore, migrate } from '../../src/db.js';
import { matchRule, extractAmount, extractCadence, extractRenewalDate, extractPlan } from '../../src/skills/subscriptions/rules.js';
import define from '../../src/skills/subscriptions/index.js';

test('merchant rules and extractors', () => {
  assert.equal(matchRule({ sender_email: 'no_reply@email.apple.com', subject: 'Your receipt from Apple.' }).rule.merchant, 'apple');
  assert.equal(matchRule({ sender_email: 'no_reply@email.apple.com', subject: 'Your Subscription is Expiring' }).rule.kind, 'expiring');
  assert.equal(matchRule({ sender_email: 'microsoft-noreply@microsoft.com', subject: 'Action required: Pay your past due invoice to avoid online service interruption' }).rule.kind, 'past_due');
  assert.equal(matchRule({ sender_email: 'no-reply-2U@mail.anthropic.com', subject: 'Your subscription access has been paused' }).rule.kind, 'past_due');
  assert.equal(matchRule({ sender_email: 'message-service@sender.zohobooks.com', subject: 'New auto-generated invoice' }).excluded, true);
  assert.equal(matchRule({ sender_email: 'friend@example.com', subject: 'receipt' }), null);
  assert.deepEqual(extractAmount('iCloud+ with 2 TB of storage (Monthly) Renews 3 November 2026 US$11.99 Billing'), { amount: 11.99, currency: 'USD', provenance: 'EXTRACTED' });
  assert.deepEqual(extractAmount('Invoice IN-00000001: $0.00 due October 21, 2026'), { amount: 0, currency: 'USD', provenance: 'EXTRACTED' });
  assert.equal(extractAmount('Subtotal $5.00 Tax $0.50 Total $5.50').amount, 5.5);
  assert.equal(extractAmount('Paid ZMW 1,826.00 for Claude Pro Max').amount, 1826);
  assert.equal(extractCadence('Annual Plan (Mac + iOS) (1 year) US$29.99/year'), 'annual');
  assert.equal(extractCadence('iCloud+ with 2 TB (Monthly)'), 'monthly');
  assert.equal(extractRenewalDate('Renews 3 November 2026 US$11.99'), '2026-11-03');
  assert.equal(extractRenewalDate('renews on Nov 3, 2026'), '2026-11-03');
  assert.equal(extractPlan('Tax Invoice ... iCloud+ with 2 TB of storage (Monthly) Renews'), 'iCloud+ with 2 TB of storage (Monthly)');
  assert.equal(extractPlan('Item(s) Premium Family Date October 10, 2026'), 'Premium Family');
});

test('ledger: ingest fixtures → merchants, totals, renewals, flags', async () => {
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  const kvStore = new Map();
  const ctx = { db, composio: { execute: async () => { throw new Error('offline'); } }, log: { info() {}, warn() {}, error() {}, debug() {} }, kv: { get: (ns, k, f) => kvStore.get(`${ns}:${k}`) ?? f, set: (ns, k, v) => kvStore.set(`${ns}:${k}`, v) } };
  const skill = define(ctx); migrate(db, skill.id, skill.migrations);
  // pre-seed FX so parse is offline-deterministic
  db.prepare("INSERT INTO subs_fx(code, rate_to_zmw, fetched_at, source) VALUES ('USD', 25, datetime('now'), 'test')").run();
  const fx = [
    { id: 'a1', sender_email: 'no_reply@email.apple.com', subject: 'Your receipt from Apple.', snippet: 'iCloud+ with 2 TB (Monthly) Renews 3 October 2026 US$11.99', ts: '2026-09-04T22:37:06Z' },
    { id: 'a2', sender_email: 'no_reply@email.apple.com', subject: 'Your receipt from Apple.', snippet: 'iCloud+ with 2 TB of storage (Monthly) Renews 3 November 2026 US$11.99', ts: '2026-10-07T11:12:05Z' },
    { id: 's1', sender_email: 'no-reply@spotify.com', subject: 'Your order confirmation for Premium Family', snippet: 'Item(s) Premium Family Date October 10, 2026 Total $9.99', ts: '2026-10-10T18:21:31Z' },
    { id: 'm1', sender_email: 'microsoft-noreply@microsoft.com', subject: 'Action required: Pay your past due invoice to avoid online service interruption', snippet: 'You have a past due balance.', ts: '2026-10-06T11:22:16Z' },
    { id: 'c1', sender_email: 'noreply@notify.cloudflare.com', subject: 'Your invoice is available', snippet: 'Invoice IN-00000001: $0.00 due October 21, 2026', ts: '2026-10-21T14:40:07Z' },
    { id: 'z1', sender_email: 'message-service@sender.zohobooks.com', subject: 'New auto-generated invoice for the recurring profile', snippet: 'INV-000031 Employer Ltd', ts: '2026-09-30T04:28:41Z' },
  ];
  const parsed = await skill._internal.ingest(fx);
  assert.equal(parsed, 5); // zoho excluded
  const ms = skill._internal.merchants();
  const apple = ms.find((m) => m.merchant === 'apple');
  assert.equal(apple.last_amount, 11.99); assert.equal(apple.cadence, 'monthly'); assert.equal(apple.cadence_provenance, 'EXTRACTED');
  assert.equal(apple.next_renewal, '2026-11-03'); assert.equal(apple.next_renewal_provenance, 'EXTRACTED');
  assert.equal(apple.monthly_zmw, Math.round(11.99 * 25));
  const ms365 = ms.find((m) => m.merchant === 'microsoft');
  assert.equal(ms365.status, 'past_due'); assert.ok(ms365.flags.includes('past due notice'));
  const t = skill._internal.totals();
  assert.equal(t.monthly_zmw, Math.round(11.99 * 25) + Math.round(9.99 * 25) + 0);
  const r = await skill.handle('past_due', {});
  assert.match(r.speak, /Microsoft 365 is past due/);
  const tot = await skill.handle('monthly_total', {});
  assert.match(tot.speak, /kwacha a month across/);
  const b = await skill.brief({ kind: 'morning' });
  assert.match(b.speak, /past due or paused/);
});
