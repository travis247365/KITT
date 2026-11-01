import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateCore, migrate } from '../../src/db.js';
import define from '../../src/skills/chief/index.js';

function mkctx(items, ops) {
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  const store = new Map();
  const ctx = { db, secrets: { KITT_COO_PASSWORD: 'x' }, config: {}, log: { info() {}, warn() {}, error() {}, debug() {} }, kv: { get: (ns, k, f) => store.get(`${ns}:${k}`) ?? f, set: (ns, k, v) => store.set(`${ns}:${k}`, v), del: (ns, k) => store.delete(`${ns}:${k}`) } };
  const skill = define(ctx); migrate(db, skill.id, skill.migrations);
  // seed cache directly (no network)
  for (const it of items) db.prepare('INSERT INTO chief_items(id, ref, title, workstream, client, status, priority, due_date, target, r, a, labels, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(String(it.id), it.ref || '', it.title, it.workstream || '', it.client || '', it.status, it.priority || 'Medium', it.due_date || '', it.target || '', it.r || '', 'Operations', '[]', '{}');
  for (const o of ops) db.prepare('INSERT INTO chief_ops(collection, id, title, severity, status, process, created_at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(o.collection, String(o.id), o.title, o.severity || '', o.status, '', '', '{}');
  ctx.kv.set('chief', 'last_sync', { at: new Date().toISOString(), items: items.length, ops: {} });
  return { skill, db };
}

test("plate: overdue, blocked, due this week, incidents", async () => {
  const today = new Date(); const y = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10); const soon = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const { skill } = mkctx([
    { id: 1, ref: 'P01', title: 'Vendor addendum signature', client: 'Client A', status: 'In progress', priority: 'High', due_date: y, r: 'Sam' },
    { id: 2, ref: 'P02', title: 'Roster import v2', status: 'Blocked', priority: 'Medium' },
    { id: 3, ref: 'P03', title: 'Welcome calls QA', client: 'Client B', status: 'Not started', priority: 'High', due_date: soon },
    { id: 4, ref: 'P04', title: 'Old thing', status: 'Done', due_date: y },
  ], [{ collection: 'incidents', id: 9, title: 'Dialler outage', severity: 'sev1', status: 'assigned' }, { collection: 'incidents', id: 10, title: 'Closed one', severity: 'sev3', status: 'resolved' }]);
  const p = await skill.handle('plate', {}, { source: 'cli' });
  assert.match(p.speak, /1 open incident including a sev one/);
  assert.match(p.speak, /1 overdue item: Vendor addendum signature for Client A/);
  assert.match(p.speak, /1 blocked item: Roster import v2/);
  assert.match(p.speak, /Due this week: Welcome calls QA for Client B by/);
  const s = await skill.handle('status', { item: 'roster import' }, { source: 'cli' });
  assert.match(s.speak, /Roster import v2: Blocked/);
  const d = await skill.handle('done', { item: 'welcome calls' }, { source: 'cli' });
  assert.equal(d.confirm.action.type, 'done'); assert.equal(d.confirm.action.id, '3');
  const a = await skill.handle('add', { title: 'call the bank about the loan' }, { source: 'cli' });
  assert.equal(a.confirm.action.type, 'add');
  const ev = await skill.brief({ kind: 'evening' });
  assert.match(ev.speak, /1 overdue, 1 blocked, 1 open incidents/);
});
