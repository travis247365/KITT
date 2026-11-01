// Skill 1 — AI Receptionist: triages the Gmail inbox (rules first, LLM for one-line summaries), speaks a short brief,
// reads a message aloud, drafts replies IN THE THREAD (never sends), archives/snoozes on confirmation.
import { createGmail, GMAIL_MIGRATIONS } from '../../services/gmail.js';
import { triage, newTextOnly } from './rules.js';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  ...GMAIL_MIGRATIONS,
  `CREATE TABLE IF NOT EXISTS recep_triage (
     message_id TEXT PRIMARY KEY, thread_id TEXT, category TEXT NOT NULL, vip INTEGER NOT NULL DEFAULT 0, client INTEGER NOT NULL DEFAULT 0, why TEXT, decided_by TEXT,
     sender_email TEXT, sender_name TEXT, subject TEXT, ts TEXT, summary TEXT, handled INTEGER NOT NULL DEFAULT 0, snoozed_until TEXT, draft_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS recep_cat ON recep_triage(category, handled, ts);`,
];

export default function define(ctx) {
  const { db, composio, config, brain, log } = ctx;
  const gmail = createGmail({ db, composio });
  const rc = { vips: [], client_domains: [], llm_summaries: true, ...(config.receptionist || {}) };
  const owner = [config.owner?.email, ...(config.owner?.aliases || [])].filter(Boolean);
  let syncing = null;

  const INBOX_Q = 'in:inbox newer_than:3d -in:draft';

  async function sync({ max = 40 } = {}) {
    const { messages } = await gmail.sync(INBOX_Q, { max, tag: 'inbox' });
    let fresh = 0;
    const ins = db.prepare(`INSERT INTO recep_triage(message_id, thread_id, category, vip, client, why, decided_by, sender_email, sender_name, subject, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`);
    for (const m of messages) {
      if (db.prepare('SELECT 1 FROM recep_triage WHERE message_id = ?').get(m.id)) continue;
      const t = triage(m, { vips: rc.vips, clientDomains: rc.client_domains, ownerEmails: owner });
      ins.run(m.id, m.thread_id, t.category, t.vip, t.client, t.why, t.decided_by, m.sender_email, m.sender_name, m.subject, m.ts); fresh++;
    }
    // messages that left the inbox (archived/handled elsewhere) are marked handled
    const live = new Set(messages.map((m) => m.id));
    for (const row of db.prepare("SELECT message_id FROM recep_triage WHERE handled = 0 AND ts >= datetime('now', '-3 days')").all()) if (!live.has(row.message_id) && messages.length) db.prepare('UPDATE recep_triage SET handled = 1 WHERE message_id = ?').run(row.message_id);
    if (rc.llm_summaries) await summarise(6).catch((e) => log.warn('summaries skipped', { err: e.message }));
    ctx.kv.set('receptionist', 'last_sync', { at: new Date().toISOString(), fetched: messages.length, fresh });
    return { fetched: messages.length, fresh };
  }

  /** One-line summaries for the newest NEEDS_REPLY items that lack one (bounded; brain may be rate-limited). */
  async function summarise(limit) {
    const rows = db.prepare("SELECT t.*, m.snippet, m.body_text FROM recep_triage t JOIN mail_messages m ON m.id = t.message_id WHERE t.category IN ('NEEDS_REPLY','LINKEDIN_DM') AND t.handled = 0 AND t.summary IS NULL ORDER BY t.vip DESC, t.ts DESC LIMIT ?").all(limit);
    for (const r of rows) {
      const text = newTextOnly(r.body_text || r.snippet || '').slice(0, 1500);
      try { const s = await brain.speak(`Summarise this e-mail in one plain sentence (max 22 words) for a driver. Sender: ${r.sender_name || r.sender_email}. Subject: ${r.subject}. Text: ${text}`, { maxWords: 25 }); db.prepare('UPDATE recep_triage SET summary = ? WHERE message_id = ?').run(s.slice(0, 300), r.message_id); }
      catch (e) { if (e.kind === 'rate_limit' || e.kind === 'auth') break; db.prepare('UPDATE recep_triage SET summary = ? WHERE message_id = ?').run((r.snippet || '').slice(0, 200), r.message_id); }
    }
  }

  const open = (cat, { vipOnly = false, limit = 20 } = {}) => db.prepare(`SELECT * FROM recep_triage WHERE handled = 0 AND (snoozed_until IS NULL OR snoozed_until <= datetime('now')) ${cat ? 'AND category = ?' : ''} ${vipOnly ? 'AND vip = 1' : ''} ORDER BY vip DESC, ts DESC LIMIT ?`).all(...(cat ? [cat] : []), limit);
  const first = (r) => (r.sender_name || r.sender_email || 'someone').split(/[\s<@]/)[0];
  const line = (r) => `${first(r)}${r.client ? ' (client)' : ''}: ${r.summary || r.subject}`;
  const counts = () => { const c = {}; for (const r of db.prepare("SELECT category, count(*) n FROM recep_triage WHERE handled = 0 AND (snoozed_until IS NULL OR snoozed_until <= datetime('now')) GROUP BY category").all()) c[r.category] = r.n; return c; };

  function findBy(who) {
    const s = String(who || '').toLowerCase().trim();
    const rows = open(null, { limit: 60 });
    return rows.find((r) => (r.sender_name || '').toLowerCase().includes(s) || (r.sender_email || '').toLowerCase().includes(s) || (r.subject || '').toLowerCase().includes(s)) || null;
  }
  const remember = (source, id) => ctx.kv.set('receptionist', `last:${source}`, id);
  const recall = (source) => { const id = ctx.kv.get('receptionist', `last:${source}`); return id ? db.prepare('SELECT * FROM recep_triage WHERE message_id = ?').get(id) : null; };

  function briefText() {
    const c = counts(); const nr = open('NEEDS_REPLY', { limit: 5 }); const li = open('LINKEDIN_DM', { limit: 3 });
    const parts = [];
    if (nr.length) parts.push(`${plural(c.NEEDS_REPLY || nr.length, 'email')} need${(c.NEEDS_REPLY || nr.length) === 1 ? 's' : ''} a reply: ${spokenList(nr.map(line), { max: 4 })}.`);
    if (li.length) parts.push(`${plural(li.length, 'LinkedIn message')}: ${spokenList(li.map((r) => first(r)), { max: 3 })}.`);
    const other = ['FYI', 'RECEIPT', 'EVENT', 'CALENDAR', 'NEWSLETTER'].map((k) => c[k] ? `${c[k]} ${k === 'FYI' ? 'for information' : k.toLowerCase()}` : null).filter(Boolean);
    if (other.length) parts.push(`${parts.length ? 'Also' : 'Nothing needs a reply;'} ${spokenList(other, { max: 5 })}.`);
    if (!parts.length) parts.push('Inbox is quiet; nothing needs a reply.');
    return parts.join(' ');
  }

  return {
    id: 'receptionist', name: 'Receptionist', aliases: ['inbox', 'mail'],
    description: 'triages your Gmail inbox, reads messages aloud, drafts replies (never sends), archives on confirmation',
    migrations: MIGRATIONS,
    intents: [
      { name: 'brief', description: 'what is in the inbox', examples: ["what's in my inbox"], patterns: ["(what's|what is|whats) in my (inbox|mail|email)", 'inbox (brief|summary|status)', 'any (new )?(mail|email|emails)( for me)?', 'check (my )?(inbox|mail|email)', 'who (emailed|wrote to) me'] },
      { name: 'unread', description: 'how many need attention', examples: ['how many emails need a reply'], patterns: ['how many (emails|messages) (need a reply|are waiting|do i have)', 'how many unread'] },
      { name: 'from', description: 'anything from a person or clients', examples: ['anything from Rahul'], patterns: ['anything from (the )?{who}', 'did {who} (email|write|reply)', 'any (email|mail) from {who}'], slots: ['who'] },
      { name: 'read', description: 'read a message aloud', examples: ['read me the email from the bank'], patterns: ['read (me )?(the )?(email|message|mail) from {who}', 'read {who}\'s (email|message)', 'what did {who} (say|write)', 'open the (email|message) from {who}'], slots: ['who'] },
      { name: 'draft', description: 'draft a reply in the thread (never sent)', examples: ['draft a reply to the bank saying I will call tomorrow'], patterns: ['(draft|write) (a )?reply to {who} saying {text}', 'reply to {who} (saying|with|that) {text}', '(draft|write) (a )?reply saying {text}'], slots: ['who', 'text'], write: true },
      { name: 'archive', description: 'archive the last-mentioned message', examples: ['archive that'], patterns: ['archive (that|it|this)( one)?', 'mark (that|it) (as )?(handled|done|read)', 'file (that|it)'], write: true },
      { name: 'snooze', description: 'snooze the last-mentioned message', examples: ['snooze that until tomorrow'], patterns: ['snooze (that|it|this)( until| till| to)? {when}', 'remind me about (that|it) {when}'], slots: ['when'], write: true },
      { name: 'sync', description: 'refresh the inbox now', examples: ['refresh my inbox'], patterns: ['(refresh|sync|update) (my )?(inbox|mail|email)'] },
    ],
    routines: [
      { name: 'receptionist.sync', cron: '*/15 6-21 * * *', description: 'poll the inbox and triage new mail', catchUpMinutes: 0, run: async () => { const r = await sync(); return { summary: `fetched ${r.fetched}, new ${r.fresh}` }; } },
      { name: 'receptionist.vip_push', cron: '*/15 7-20 * * 1-5', description: 'push when a VIP or client e-mail needs a reply', catchUpMinutes: 0, run: async () => { const vip = open('NEEDS_REPLY', { vipOnly: true, limit: 5 }).filter((r) => !ctx.kv.get('receptionist', `pushed:${r.message_id}`)); for (const r of vip) ctx.kv.set('receptionist', `pushed:${r.message_id}`, 1); return { summary: `${vip.length} vip pushes`, notify: vip.length ? { push: { title: `KITT: ${plural(vip.length, 'VIP email')} waiting`, body: vip.map((r) => `${first(r)}: ${r.subject}`).join('\n'), tags: 'email', priority: 'high' } } : undefined }; } },
    ],
    async handle(intent, slots, c) {
      if (intent === 'sync' || !ctx.kv.get('receptionist', 'last_sync')) {
        if (c.source === 'cli' || !ctx.kv.get('receptionist', 'last_sync')) { const r = await sync(); if (intent === 'sync') return { speak: `Inbox refreshed: ${r.fetched} recent messages, ${r.fresh} new.` }; }
        else { if (!syncing) syncing = sync().catch((e) => log.warn('inbox sync failed', { err: e.message })).finally(() => { syncing = null; }); return { speak: 'Refreshing the inbox in the background.' }; }
      }
      if (intent === 'brief') { const nr = open('NEEDS_REPLY', { limit: 1 }); if (nr[0]) remember(c.source, nr[0].message_id); return { speak: briefText(), display: { counts: counts(), needs_reply: open('NEEDS_REPLY'), linkedin: open('LINKEDIN_DM') } }; }
      if (intent === 'unread') { const cn = counts(); return { speak: `${plural(cn.NEEDS_REPLY || 0, 'email')} need${(cn.NEEDS_REPLY || 0) === 1 ? 's' : ''} a reply, ${cn.LINKEDIN_DM || 0} LinkedIn, ${cn.FYI || 0} for information, ${cn.RECEIPT || 0} receipts.`, display: cn }; }
      if (intent === 'from') { const who = String(slots.who || '').toLowerCase(); const rows = /client/.test(who) ? open(null, { limit: 60 }).filter((r) => r.client) : open(null, { limit: 60 }).filter((r) => (r.sender_name || '').toLowerCase().includes(who) || (r.sender_email || '').toLowerCase().includes(who)); if (!rows.length) return { speak: `Nothing from ${slots.who} in the last three days.` }; remember(c.source, rows[0].message_id); return { speak: `${plural(rows.length, 'message')} from ${/client/.test(who) ? 'clients' : first(rows[0])}: ${spokenList(rows.map((r) => `${r.subject}${r.summary ? `, ${r.summary}` : ''}`), { max: 3 })}.`, display: rows }; }
      if (intent === 'read') {
        const r = findBy(slots.who); if (!r) return { speak: `I can't find a recent message from ${slots.who}.` };
        remember(c.source, r.message_id);
        const m = await gmail.hydrate(r.message_id).catch(() => null);
        const text = newTextOnly(m?.body_text || m?.snippet || '');
        if (!text) return { speak: `From ${first(r)}, subject ${r.subject}. I could not fetch the body.` };
        let spoken = text.length > 700 ? null : text;
        if (!spoken) { try { spoken = await brain.speak(`Read this e-mail to a driver in at most 90 words, keeping names, dates and amounts exact: ${text.slice(0, 4000)}`, { maxWords: 90 }); } catch { spoken = text.slice(0, 700); } }
        return { speak: `From ${r.sender_name || r.sender_email}, subject ${r.subject}. ${spoken}`, display: { subject: r.subject, from: r.sender_email, text } };
      }
      if (intent === 'draft') {
        const r = slots.who ? findBy(slots.who) : recall(c.source); if (!r) return { speak: `I can't find a message ${slots.who ? `from ${slots.who}` : 'to reply to'}.` };
        const text = String(slots.text || '').trim(); if (!text) return { speak: 'What should the reply say?' };
        return { speak: `Draft a reply to ${first(r)} on "${r.subject}" saying: ${text}. It will be saved as a Gmail draft, not sent.`, confirm: { summary: `draft reply to ${r.sender_email}: ${text.slice(0, 80)}`, action: { type: 'draft', message_id: r.message_id, thread_id: r.thread_id, to: r.sender_email, text } } };
      }
      if (intent === 'archive') { const r = recall(c.source); if (!r) return { speak: 'Which message? Ask me to read or find one first.' }; return { speak: `Archive the message from ${first(r)}, "${r.subject}"?`, confirm: { summary: `archive ${r.subject}`, action: { type: 'archive', message_id: r.message_id, thread_id: r.thread_id } } }; }
      if (intent === 'snooze') { const r = recall(c.source); if (!r) return { speak: 'Which message? Ask me to read or find one first.' }; const until = parseWhen(slots.when); if (!until) return { speak: `I didn't understand ${slots.when}. Try 'tomorrow' or 'Monday'.` }; return { speak: `Snooze "${r.subject}" until ${until.slice(0, 10)}?`, confirm: { summary: `snooze ${r.subject} until ${until.slice(0, 10)}`, action: { type: 'snooze', message_id: r.message_id, until } } }; }
      return { speak: "I didn't catch which inbox action that was." };
    },
    async execute(action) {
      if (action.type === 'draft') {
        const body = `${action.text}\n`;
        const res = await composio.execute('GMAIL_CREATE_EMAIL_DRAFT', { recipient_email: action.to, body, is_html: false, thread_id: action.thread_id, include_signature: true }, { timeoutMs: 60000 });
        const id = res?.id || res?.draft?.id || res?.response_data?.id || null;
        db.prepare('UPDATE recep_triage SET draft_id = ? WHERE message_id = ?').run(id || 'created', action.message_id);
        return { speak: 'Draft saved in Gmail, not sent. Review it on your phone before sending.' };
      }
      if (action.type === 'archive') { await composio.execute('GMAIL_MODIFY_THREAD_LABELS', { thread_id: action.thread_id, remove_label_ids: ['INBOX'] }, { timeoutMs: 60000 }); db.prepare('UPDATE recep_triage SET handled = 1 WHERE message_id = ?').run(action.message_id); return { speak: 'Archived.' }; }
      if (action.type === 'snooze') { db.prepare('UPDATE recep_triage SET snoozed_until = ? WHERE message_id = ?').run(action.until, action.message_id); return { speak: `Snoozed until ${action.until.slice(0, 10)}. It will come back in the brief then.` }; }
      return { speak: 'Unknown action.' };
    },
    async brief({ kind }) { if (!ctx.kv.get('receptionist', 'last_sync')) { try { await sync(); } catch { return { speak: 'Mail is unreachable right now.' }; } } if (kind === 'evening') { const cn = counts(); return (cn.NEEDS_REPLY || 0) ? { speak: `${plural(cn.NEEDS_REPLY, 'email')} still need${cn.NEEDS_REPLY === 1 ? 's' : ''} a reply.` } : null; } return { speak: `Inbox: ${briefText()}` }; },
    async view() { return { counts: counts(), needs_reply: open('NEEDS_REPLY'), linkedin: open('LINKEDIN_DM'), fyi: open('FYI', { limit: 25 }), receipts: open('RECEIPT', { limit: 10 }), events: open('EVENT', { limit: 10 }), last_sync: ctx.kv.get('receptionist', 'last_sync'), speak: briefText() }; },
    async health() { const ls = ctx.kv.get('receptionist', 'last_sync'); const err = gmail.lastSync(INBOX_Q)?.last_error; return { ok: !err, detail: ls ? `last sync ${ls.at}; open: ${JSON.stringify(counts())}${err ? `; error: ${err}` : ''}` : 'never synced' }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const rows = open(null, { limit: 40 }); return `<p>Open by category: ${esc(JSON.stringify(counts()))}</p><table><tr><th>When</th><th>From</th><th>Subject</th><th>Category</th><th>VIP</th><th>Summary</th></tr>${rows.map((r) => `<tr><td>${esc((r.ts || '').slice(0, 16))}</td><td>${esc(r.sender_name || r.sender_email)}</td><td>${esc(r.subject)}</td><td>${esc(r.category)}</td><td>${r.vip ? 'yes' : ''}</td><td>${esc(r.summary || '')}</td></tr>`).join('')}</table>`; },
    _internal: { triage, sync, open, counts, briefText, findBy },
  };
}

function parseWhen(s) {
  const t = String(s || '').toLowerCase().trim(); const now = new Date(); const d = new Date(now);
  const at = (date, h = 8) => { date.setHours(h, 0, 0, 0); return date.toISOString(); };
  if (/tomorrow/.test(t)) { d.setDate(d.getDate() + 1); return at(d); }
  if (/tonight|this evening/.test(t)) return at(d, 18);
  if (/next week/.test(t)) { d.setDate(d.getDate() + 7); return at(d); }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']; const di = days.findIndex((x) => t.includes(x));
  if (di >= 0) { let diff = (di - d.getDay() + 7) % 7; if (!diff) diff = 7; d.setDate(d.getDate() + diff); return at(d); }
  const m = /(\d+)\s*(hour|day|week)s?/.exec(t); if (m) { const n = Number(m[1]); if (m[2] === 'hour') d.setHours(d.getHours() + n); else d.setDate(d.getDate() + n * (m[2] === 'week' ? 7 : 1)); return d.toISOString(); }
  return null;
}
