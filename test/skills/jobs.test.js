import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTracker, deadlines, isSent, cleanUrl, parseInbox, inboxLine, INBOX_HEADER, findDate } from '../../src/skills/jobs/tracker.js';

// The Jobs skill reads the tracker AppyJobHunter keeps and the mail already stored locally; it never sends anything.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(HERE, '..', 'fixtures', 'jobs-tracker.md'), 'utf8');
const soon = new Date(Date.now() + 3 * 86_400_000);
const SOON = soon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });   // "13 Nov 2026"
const SOON_ISO = soon.toISOString().slice(0, 10);
const md = fixture.replace('CLOSE_SOON', SOON);

test('the tracker parser: sections by name, table by header, dates wherever they are written', () => {
  const t = parseTracker(md);
  assert.equal(t.version, '1.3'); assert.equal(t.updated, '2026-11-02');
  assert.equal(t.holds.length, 2); assert.equal(t.holds[0].title, 'NOTICE PERIOD'); assert.match(t.holds[1].text, /Re-date/);
  assert.equal(t.packs.length, 4);
  assert.deepEqual(t.packs.map((p) => p.fit), ['3/5', '3/5', '2.5/5', '3/5']);
  assert.equal(t.packs[1].deadline, '2026-10-15', 'a date inside the table cell, year from the title');
  assert.equal(t.packs[3].deadline, SOON_ISO);
  assert.equal(t.packs.filter(isSent).length, 1);
  assert.equal(t.out.length, 2); assert.equal(t.out[0].date, '2026-11-01');
  assert.equal(t.discovery.length, 2); assert.equal(t.discovery[0].deadline, '2026-10-10');
  assert.equal(t.decisions.length, 3); assert.match(t.decisions[2].text, /Vandelay first/);
  assert.equal(t.log.length, 2); assert.deepEqual(t.other, []);
  assert.equal(findDate('Fri 16 Oct', 2026), '2026-10-16'); assert.equal(findDate('2026-12-01 noon'), '2026-12-01'); assert.equal(findDate('no date here', 2026), null);
  assert.equal(parseTracker('').packs.length, 0, 'an empty file is an empty tracker, not a crash');
});

test('deadlines: upcoming first, passed kept, nothing invented', () => {
  const d = deadlines(parseTracker(md), '2026-10-12');
  assert.deepEqual(d.upcoming.map((x) => [x.date, x.in_days, x.kind]).slice(0, 1), [['2026-10-15', 3, 'pack']]);
  assert.ok(d.passed.some((x) => x.date === '2026-10-10' && x.kind === 'discovery'));
});

test('job links: cleaned of tracking, queued once, read back', () => {
  assert.equal(cleanUrl('https://www.linkedin.com/jobs/view/12345/?refId=abc&trackingId=xyz&utm_source=mail#top'), 'https://www.linkedin.com/jobs/view/12345/');
  assert.equal(cleanUrl('Apply >> https://example.com/careers/role?id=7)'), 'https://example.com/careers/role?id=7');
  assert.equal(cleanUrl('ftp://example.com/x'), null); assert.equal(cleanUrl('not a link'), null); assert.equal(cleanUrl('http://localhost/x'), null);
  const file = INBOX_HEADER + inboxLine('https://example.com/a', 'phone', '2026-11-10 08:00') + inboxLine('https://example.com/b', 'siri', '2026-11-10 08:05').replace('\n', ' → pack built, 10 Nov\n');
  const rows = parseInbox(file);
  assert.equal(rows.length, 2); assert.equal(rows[0].done, false); assert.equal(rows[1].done, true); assert.equal(rows[1].note, 'pack built, 10 Nov'); assert.equal(rows[1].from, 'siri');
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-jobs-'));
process.env.KITT_CONFIG_DIR = path.join(tmp, 'cfg'); process.env.KITT_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'career'), { recursive: true }); fs.mkdirSync(process.env.KITT_CONFIG_DIR, { recursive: true });
const trackerFile = path.join(tmp, 'career', '00_TRACKER.md');
fs.writeFileSync(trackerFile, md);
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.env'), '');
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.json'), JSON.stringify({ skills: { enabled: ['jobs'] }, jobs: { tracker: trackerFile } }));

test('the skill: status, deadlines, replies from local mail, a queued link, the brief and the screen', async () => {
  const { createApp } = await import('../../src/app.js');
  const app = await createApp();
  const jobs = app.skills.jobs; assert.ok(jobs, `jobs skill failed to load: ${JSON.stringify(app.failures)}`);
  const c = { ...app, source: 'test' };

  // no mail table yet: the skill says so instead of failing
  let r = await jobs.handle('replies', {}, c); assert.match(r.speak, /inbox is not synced/i);
  r = await jobs.handle('status', {}, c);
  assert.match(r.speak, /4 application packs built, 1 sent/); assert.match(r.speak, /closing soon: Initech in 3 days/); assert.match(r.speak, /3 decisions waiting/);

  // the Receptionist's table, with one mail of each kind and one that is noise
  app.db.exec(`CREATE TABLE mail_messages (id TEXT PRIMARY KEY, thread_id TEXT, sender_name TEXT, sender_email TEXT, to_addr TEXT, subject TEXT, snippet TEXT, body_text TEXT, ts TEXT, labels TEXT, has_attachments INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL DEFAULT (datetime('now')), tags TEXT NOT NULL DEFAULT '')`);
  const ins = app.db.prepare("INSERT INTO mail_messages(id, thread_id, sender_name, sender_email, subject, ts) VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'))");
  const addr = (local, domain) => `${local}@${domain}`;   // built at run time: the public leak scan rejects literal addresses
  ins.run('m1', 't1', 'Example Corp Talent', addr('talent', 'example-corp.example'), 'Your application: Director Consulting');
  ins.run('m2', 't2', 'LinkedIn', addr('messages-noreply', 'linkedin.com'), 'Pat, you have a new message');
  ins.run('m3', 't3', 'Workday', addr('no-reply', 'myworkday.com'), 'Application received');
  ins.run('m4', 't4', 'A newsletter', addr('news', 'newsletter.example'), 'Ten tips for Monday');
  ins.run('m5', 't5', 'LinkedIn', addr('jobs-listings', 'linkedin.com'), '30 new jobs for you');   // an alert, not a message
  const rep = jobs._internal.replies(jobs._internal.load().tracker);
  assert.deepEqual(rep.rows.map((x) => x.kind).sort(), ['ats', 'human', 'linkedin']);
  assert.equal(rep.humans, 1);
  r = await jobs.handle('replies', {}, c); assert.match(r.speak, /3 application e-mails this week/);

  // deadlines and decisions
  r = await jobs.handle('deadlines', {}, c); assert.match(r.speak, /Initech in 3 days/); assert.match(r.speak, /dates have passed/);
  r = await jobs.handle('decisions', {}, c); assert.match(r.speak, /3 decisions waiting on you: 1\. Notice period/);

  // queue a link: confirm first, then one line in the file next to the tracker; a repeat is refused
  r = await jobs.handle('queue', { url: 'https://www.linkedin.com/jobs/view/99/?trackingId=abc' }, c);
  assert.ok(r.confirm); assert.equal(r.confirm.action.url, 'https://www.linkedin.com/jobs/view/99/');
  r = await jobs.execute(r.confirm.action, c); assert.match(r.speak, /^Queued/);
  r = await jobs.execute({ type: 'queue', url: 'https://www.linkedin.com/jobs/view/99/' }, c); assert.match(r.speak, /already queued/);
  const inbox = fs.readFileSync(path.join(tmp, 'career', '00_KITT_LINKS.md'), 'utf8');
  assert.equal((inbox.match(/linkedin\.com\/jobs\/view\/99/g) || []).length, 1); assert.match(inbox, /^# Job links queued from KITT/);
  r = await jobs.handle('queue', { url: 'mailto:someone@example.com' }, c); assert.match(r.speak, /didn't catch a web address/);

  // the brief and the screen
  const morning = await jobs.brief({ ...c, kind: 'morning' });
  assert.match(morning.speak, /^Jobs: 1 application closes soon: Initech in 3 days; 4 packs ready, 1 sent; 3 application e-mails this week; 3 decisions waiting on you\.$/);
  assert.equal(morning.decisions, 3);
  const evening = await jobs.brief({ ...c, kind: 'evening' }); assert.equal(evening, null, 'nothing closes within 2 days and no mail today');
  const v = await jobs.view();
  assert.equal(v.ok, true); assert.equal(v.counts.packs, 4); assert.equal(v.counts.queued_open, 1);
  assert.match(v.ui.headline, /^Initech closes in 3 days$/);
  assert.deepEqual(v.ui.sections.map((s) => s.type), ['kpis', 'timeline', 'table', 'list', 'list', 'list', 'list', 'list', 'notice', 'actions']);
  assert.equal(v.ui.sections[0].items[0].value, '4');
  const h = await jobs.health(); assert.equal(h.ok, true); assert.match(h.detail, /tracker v1\.3 updated 2026-11-02; 4 packs; mail on/);

  // the tracker vanishes (iCloud eviction, a move): every surface says so, nothing throws
  fs.renameSync(trackerFile, `${trackerFile}.away`);
  r = await jobs.handle('status', {}, c); assert.match(r.speak, /can't read the applications tracker: tracker file not found/);
  assert.equal((await jobs.health()).ok, false);
  assert.match((await jobs.view()).ui.headline, /not available/);
  fs.renameSync(`${trackerFile}.away`, trackerFile);
  app.scheduler?.stop?.();
});

test('without jobs.tracker the skill loads, says it is not configured and stays out of the brief', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-jobs-off-'));
  const { default: define } = await import('../../src/skills/jobs/index.js');
  const db = { prepare: () => ({ get: () => undefined, all: () => [] }) };
  const s = define({ db, config: {}, paths: { dataDir: dir }, log: { info() {}, warn() {} }, kv: {} });
  assert.equal((await s.health()).ok, false); assert.match((await s.health()).detail, /jobs\.tracker is not set/);
  assert.equal(await s.brief({ kind: 'evening' }), null);
  assert.match((await s.brief({ kind: 'morning' })).speak, /not readable/);
  assert.match((await s.handle('status', {}, {})).speak, /jobs\.tracker is not set/);
  assert.match((await s.execute({ type: 'queue', url: 'https://example.com/j' }, { source: 'test' })).speak, /could not queue/);
});
