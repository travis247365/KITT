// Skill 4 — Voice Note Idea Catcher: capture by voice, store locally first, structure with the brain when it is available,
// mirror into a persistent Claude Code conversation ("KITT Ideas") that Travis can open and continue, and into ideas.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ideas (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), source TEXT NOT NULL, raw TEXT NOT NULL, title TEXT, summary TEXT, tags TEXT, next_action TEXT, project TEXT,
     status TEXT NOT NULL DEFAULT 'new', structured_by TEXT, session_synced INTEGER NOT NULL DEFAULT 0, lat REAL, lon REAL
   );`,
];

const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, next_action: { type: 'string' }, project: { type: 'string' } }, required: ['title', 'summary'] };

export default function define(ctx) {
  const { db, brain, config, paths, log } = ctx;
  const ledger = path.join(paths.configDir, 'ideas.md');
  const projects = config.ideas?.projects || ['Work', 'Consulting', 'KITT', 'personal', 'content', 'finance'];

  function appendLedger(idea) {
    try {
      if (!fs.existsSync(ledger)) fs.writeFileSync(ledger, '# KITT Ideas ledger\n\nCaptured by voice from the car. Newest at the bottom.\n\n', 'utf8');
      fs.appendFileSync(ledger, `## ${idea.ts.slice(0, 16).replace('T', ' ')} — ${idea.title || '(untitled)'}\n${idea.raw}\n${idea.summary ? `\n> ${idea.summary}\n` : ''}${idea.next_action ? `\nNext: ${idea.next_action}\n` : ''}${idea.tags ? `\nTags: ${idea.tags}${idea.project ? ` · Project: ${idea.project}` : ''}\n` : ''}\n`, 'utf8');
    } catch (e) { log.warn('ideas ledger append failed', { err: e.message }); }
  }

  async function capture({ text, lat, lon }, c) {
    const raw = String(text || '').trim();
    if (!raw) return { speak: "I didn't catch the idea. Say it again." };
    const fallbackTitle = raw.split(/\s+/).slice(0, 8).join(' ') + (raw.split(/\s+/).length > 8 ? '…' : '');
    const row = db.prepare('INSERT INTO ideas(source, raw, title, lat, lon) VALUES (?, ?, ?, ?, ?) RETURNING id, ts').get(c?.source || 'cli', raw, fallbackTitle, lat ?? null, lon ?? null);
    let structured = null;
    try {
      structured = await brain.extract(`Structure this spoken idea from the owner (a consultant who builds data/AI tools). Known projects: ${projects.join(', ')}. Idea: "${raw}"`, SCHEMA, { tier: 'fast' });
    } catch (e) { log.warn('idea structuring skipped', { kind: e.kind, err: e.message }); }
    if (structured?.title) db.prepare('UPDATE ideas SET title = ?, summary = ?, tags = ?, next_action = ?, project = ?, structured_by = ? WHERE id = ?').run(structured.title.slice(0, 120), (structured.summary || '').slice(0, 500), (structured.tags || []).join(', '), structured.next_action || null, structured.project || null, brain.provider, row.id);
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(row.id);
    appendLedger(idea);
    return { speak: `Captured idea ${row.id}: ${idea.title}.${idea.next_action ? ` Next step: ${idea.next_action}.` : ''}`, display: idea };
  }

  /** Append unsynced ideas to the persistent "KITT Ideas" Claude Code session as one turn. */
  async function sessionSync() {
    const rows = db.prepare('SELECT * FROM ideas WHERE session_synced = 0 ORDER BY id').all();
    if (!rows.length) return { synced: 0 };
    let session = ctx.kv.get('ideas', 'session');
    const prompt = `${session ? 'More ideas captured by voice' : 'You are KITT Ideas, a standing notebook conversation. Travis will reopen this conversation to think ideas through with you. Keep a running structured list and ask one sharp question per idea when he returns. First batch of ideas'}:\n${rows.map((r) => `- [${r.ts.slice(0, 16)}] ${r.raw}${r.title && r.title !== r.raw ? ` (title: ${r.title})` : ''}${r.next_action ? ` (next: ${r.next_action})` : ''}`).join('\n')}\nAcknowledge in one short line; do not expand yet.`;
    try {
      const r = await brain.raw.complete({ prompt, model: brain.models.fast, persist: true, resume: session?.id || undefined, sessionId: session ? undefined : crypto.randomUUID(), maxTurns: 1, timeoutMs: 120000 });
      if (!session) { session = { id: r.sessionId, created_at: new Date().toISOString() }; ctx.kv.set('ideas', 'session', session); }
      db.prepare(`UPDATE ideas SET session_synced = 1 WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id));
      return { synced: rows.length, session: session.id };
    } catch (e) { log.warn('ideas session sync failed', { kind: e.kind, err: e.message }); return { synced: 0, error: e.message }; }
  }

  function chatInstructions() {
    const s = ctx.kv.get('ideas', 'session');
    if (!s) return 'No KITT Ideas conversation yet — it is created by the nightly sync (ideas.session_sync) after the first idea.';
    return `Open the standing KITT Ideas conversation in Claude Code:\n  cd ${paths.brainDir} && claude --resume ${s.id}\n(ideas captured in the car are appended there every evening; the markdown ledger is ${ledger})`;
  }

  const since = (period) => ({ today: "date('now', 'localtime')", yesterday: "date('now', '-1 day', 'localtime')", week: "date('now', '-7 days')", month: "date('now', '-30 days')" }[period] || "date('now', '-7 days')");
  const list = (period) => db.prepare(`SELECT * FROM ideas WHERE ts >= ${since(period)} AND status <> 'dropped' ORDER BY id DESC`).all();

  return {
    id: 'ideas', name: 'Idea Catcher', aliases: ['notes'],
    description: 'captures ideas by voice, structures them, and keeps them in a standing Claude conversation and a markdown ledger',
    migrations: MIGRATIONS,
    intents: [
      { name: 'capture', description: 'capture an idea', examples: ['idea: a WhatsApp bot for PAYGo collections'], patterns: ['(idea|new idea|note to self|remember this|capture this|log this idea|note)(:| that| -)? {text}', 'i have an idea(:| -)? {text}', 'remember {text}'], slots: ['text'] },
      { name: 'recap', description: 'read back recent ideas', examples: ['what ideas did I have this week'], patterns: ['(what|which) ideas (did i have|have i captured|do i have)( {period})?', 'ideas? (recap|list|summary)( for {period})?', 'read (me )?(my )?ideas( from {period})?', 'my ideas( from {period})?'], slots: ['period'] },
      { name: 'drop', description: 'drop an idea by number', examples: ['drop idea 12'], patterns: ['(drop|delete|remove) idea {n}', 'idea {n} is (dead|dropped|done)'], slots: ['n'], write: true },
      { name: 'where', description: 'how to open the ideas conversation', examples: ['where are my ideas'], patterns: ['where (are|is) my ideas( conversation| chat| notebook)?', 'open (the )?ideas (chat|conversation|notebook)'] },
    ],
    routines: [
      { name: 'ideas.session_sync', cron: '30 21 * * *', description: 'append the day\'s ideas to the standing Claude conversation', catchUpMinutes: 600, run: async () => ({ summary: JSON.stringify(await sessionSync()) }) },
    ],
    capture,
    chatInstructions,
    async handle(intent, slots, c) {
      if (intent === 'capture') return capture({ text: slots.text }, c);
      if (intent === 'recap') { const p = /today/.test(slots.period || '') ? 'today' : /yesterday/.test(slots.period || '') ? 'yesterday' : /month/.test(slots.period || '') ? 'month' : 'week'; const rows = list(p); if (!rows.length) return { speak: `No ideas captured ${p === 'week' ? 'this week' : p === 'month' ? 'this month' : p}.` }; return { speak: `${plural(rows.length, 'idea')} ${p === 'week' ? 'this week' : p === 'month' ? 'this month' : p}: ${spokenList(rows.map((r) => `${r.id}, ${r.title}`), { max: 6 })}.`, display: rows }; }
      if (intent === 'drop') { const r = db.prepare('SELECT * FROM ideas WHERE id = ?').get(Number(slots.n)); if (!r) return { speak: `No idea number ${slots.n}.` }; return { speak: `Drop idea ${r.id}, ${r.title}?`, confirm: { summary: `drop idea ${r.id}`, action: { type: 'drop', id: r.id } } }; }
      if (intent === 'where') return { speak: ctx.kv.get('ideas', 'session') ? 'Your ideas live in the KITT Ideas conversation in Claude Code on the Mac, and in ideas dot M D in the KITT config folder. Run: kitt ideas chat, for the resume command.' : 'The ideas conversation is created after the first nightly sync; the markdown ledger is already in the KITT config folder.' };
      return { speak: "I didn't catch which ideas action that was." };
    },
    async execute(action) { if (action.type === 'drop') { db.prepare("UPDATE ideas SET status = 'dropped' WHERE id = ?").run(action.id); return { speak: 'Dropped.' }; } return { speak: 'Unknown action.' }; },
    async brief({ kind }) { if (kind === 'morning') { const y = list('yesterday'); return y.length ? { speak: `${plural(y.length, 'idea')} captured yesterday, including ${y[0].title}.` } : null; } if (kind === 'evening') { const t = list('today'); return t.length ? { speak: `Ideas today: ${spokenList(t.map((r) => r.title), { max: 3 })}.` } : null; } return null; },
    async view() { return { ideas: list('month'), session: ctx.kv.get('ideas', 'session'), ledger, instructions: chatInstructions() }; },
    async health() { const n = db.prepare('SELECT count(*) n FROM ideas').get().n; const s = ctx.kv.get('ideas', 'session'); return { ok: true, detail: `${n} ideas; ledger ${ledger}; session ${s ? s.id.slice(0, 8) : 'not created yet'}` }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const rows = list('month'); return `<p>${chatInstructions().replace(/\n/g, '<br>')}</p><table><tr><th>#</th><th>When</th><th>Title</th><th>Idea</th><th>Next</th><th>Project</th><th>Synced</th></tr>${rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.ts.slice(0, 16))}</td><td>${esc(r.title)}</td><td>${esc(r.raw)}</td><td>${esc(r.next_action || '')}</td><td>${esc(r.project || '')}</td><td>${r.session_synced ? 'yes' : ''}</td></tr>`).join('')}</table>`; },
    _internal: { sessionSync, list },
  };
}
