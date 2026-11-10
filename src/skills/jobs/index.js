// Skill 13 — Jobs: the state of the owner's job applications, read from the tracker AppyJobHunter keeps (a markdown file in the
// Career Applications folder) and from the mail the Receptionist has already stored locally. No model, no network: the hub shows,
// speaks and queues; the packs themselves are built in Claude Code by AppyJobHunter, who also writes the tracker.
//   ~/.config/kitt/kitt.json → "jobs": { "tracker": "~/…/Career Applications/00_TRACKER.md", "inbox": "<optional, default next to it>" }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plural, spokenList } from '../../voice.js';
import { parseTracker, deadlines, isSent, cleanUrl, parseInbox, inboxLine, INBOX_HEADER } from './tracker.js';

// Applicant-tracking systems and job boards: a mail from one of these is about an application, whatever the subject says.
const ATS = /(^|[@.])(myworkday\.com|myworkdayjobs\.com|successfactors\.com|greenhouse\.io|lever\.co|smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|oraclecloud\.com|bamboohr\.com|ashbyhq\.com|jobvite\.com|breezy\.hr|recruitee\.com|teamtailor\.com|pnet\.co\.za|careers24\.com|indeed\.com|glassdoor\.com)$/i;
const LINKEDIN_MESSAGE = /\b(message|inmail|replied|reply|wrote|sent you|recruiter|application)\b/i;
const ROBOT = /^(no-?reply|noreply|jobs-noreply|notifications?|donotreply|do-not-reply|messages-noreply|invitations|jobalerts|jobs-listings)/i;

const expand = (p) => (p ? String(p).replace(/^~(?=$|\/)/, os.homedir()) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const employerOf = (role) => String(role || '').split(/\s[—–-]\s/)[0].trim();
const short = (s, n = 70) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace('T', ' ');

export default function define(ctx) {
  const { db, config, log } = ctx;
  const cfg = config.jobs || {};
  const trackerPath = expand(cfg.tracker);
  const inboxPath = expand(cfg.inbox) || (trackerPath ? path.join(path.dirname(trackerPath), '00_KITT_LINKS.md') : '');
  const mailDays = Number(cfg.mail_days) || 60;
  let cache = { mtime: 0, tracker: null, error: null };

  /** The parsed tracker, re-read only when the file changes. { tracker, error, mtime } */
  function load() {
    if (!trackerPath) return { tracker: null, error: 'jobs.tracker is not set in kitt.json', mtime: 0 };
    try {
      const st = fs.statSync(trackerPath);
      if (st.mtimeMs !== cache.mtime || !cache.tracker) cache = { mtime: st.mtimeMs, tracker: parseTracker(fs.readFileSync(trackerPath, 'utf8')), error: null };
      return cache;
    } catch (e) {
      cache = { mtime: 0, tracker: null, error: e.code === 'ENOENT' ? 'tracker file not found (iCloud may have evicted it: open the folder once)' : e.message };
      return cache;
    }
  }

  const hasMail = () => { try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mail_messages'").get()); } catch { return false; } };

  /** Mail about applications, from the Receptionist's local store: ATS senders, LinkedIn message notifications, and senders or
   *  subjects naming an employer the tracker knows. Counted and listed by sender and subject only; bodies are never read here. */
  function replies(t, days = mailDays) {
    if (!hasMail()) return { available: false, rows: [], humans: 0, linkedin: 0, ats: 0 };
    const employers = [...new Set([...(t?.packs || []).map((p) => employerOf(p.role)), ...(t?.out || []).map((o) => employerOf(o.text.replace(/^[-*]\s*/, '')))]
      .map((e) => e.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).filter((e) => e.length >= 4))];
    const rows = db.prepare("SELECT id, thread_id, sender_name, sender_email, subject, ts FROM mail_messages WHERE ts >= datetime('now', ?) ORDER BY ts DESC").all(`-${days} days`);
    const out = [];
    for (const m of rows) {
      const email = String(m.sender_email || '').toLowerCase(); const domain = email.split('@')[1] || ''; const local = email.split('@')[0] || '';
      const hay = `${m.sender_name || ''} ${m.subject || ''} ${domain}`.toLowerCase();
      let kind = null;
      if (ATS.test(domain)) kind = 'ats';
      else if (/(^|\.)linkedin\.com$/.test(domain)) { if (LINKEDIN_MESSAGE.test(m.subject || '')) kind = 'linkedin'; }
      else { const emp = employers.find((e) => hay.includes(e)); if (emp) kind = ROBOT.test(local) ? 'ats' : 'human'; }
      if (kind) out.push({ id: m.id, thread_id: m.thread_id, kind, from: m.sender_name || domain, subject: short(m.subject, 90), ts: m.ts });
    }
    return { available: true, rows: out.slice(0, 40), humans: out.filter((r) => r.kind === 'human').length, linkedin: out.filter((r) => r.kind === 'linkedin').length, ats: out.filter((r) => r.kind === 'ats').length };
  }

  function queued() {
    if (!inboxPath) return [];
    try { return parseInbox(fs.readFileSync(inboxPath, 'utf8')); } catch { return []; }
  }
  function queue(url, from) {
    if (!inboxPath) throw new Error('jobs.tracker is not set, so there is no folder to queue into');
    const clean = cleanUrl(url); if (!clean) throw new Error('that is not a web address');
    const already = queued().find((q) => q.url === clean);
    if (already) return { url: clean, duplicate: true, when: already.when };
    if (!fs.existsSync(inboxPath)) fs.writeFileSync(inboxPath, INBOX_HEADER, 'utf8');
    fs.appendFileSync(inboxPath, inboxLine(clean, from || 'kitt', stamp()), 'utf8');
    log.info('job link queued', { host: new URL(clean).hostname, from });
    return { url: clean, duplicate: false };
  }

  /** Everything the screens and the voice need, computed once per call (cheap: one file parse, one local query). */
  function snapshot() {
    const { tracker: t, error, mtime } = load();
    const today = new Date().toISOString().slice(0, 10);
    if (!t) return { ok: false, error, counts: { packs: 0, sent: 0, decisions: 0, holds: 0, due7: 0 }, deadlines: { upcoming: [], passed: [] }, replies: replies(null), queued: queued(), today };
    const dl = deadlines(t, today);
    const r = replies(t);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return {
      ok: true, path: trackerPath, updated: t.updated, version: t.version, mtime: new Date(mtime).toISOString(), today,
      counts: { packs: t.packs.length, sent: t.packs.filter(isSent).length, out: t.out.length, decisions: t.decisions.length, holds: t.holds.length, due7: dl.upcoming.filter((d) => d.in_days <= 7).length, discovery: t.discovery.length, replies_week: r.rows.filter((x) => x.ts >= weekAgo).length, queued_open: queued().filter((q) => !q.done).length },
      deadlines: dl, packs: t.packs, holds: t.holds, decisions: t.decisions, out: t.out, discovery: t.discovery, log: t.log.slice(-5), replies: r, queued: queued(),
    };
  }

  // ---------- the screen (drawn by the apps from this descriptor) ----------
  function ui(s) {
    if (!s.ok) return { headline: 'Tracker not available', sections: [{ type: 'notice', tone: 'attention', text: `${s.error}. Set jobs.tracker in ~/.config/kitt/kitt.json to AppyJobHunter's 00_TRACKER.md.` }] };
    const c = s.counts; const due = s.deadlines.upcoming.filter((d) => d.in_days <= 14);
    const lvl = (d) => (d <= 2 ? 3 : d <= 7 ? 2 : 1);
    const headline = due.length ? `${due[0].what.split(/\s[—–-]\s/)[0]} closes ${due[0].in_days === 0 ? 'today' : due[0].in_days === 1 ? 'tomorrow' : `in ${due[0].in_days} days`}` : c.sent ? `${c.sent} sent · ${c.packs - c.sent} ready` : c.packs ? `${c.packs} packs ready, none sent` : 'Nothing in flight';
    const sections = [
      { type: 'kpis', cols: 2, items: [
        { label: 'Packs built', value: String(c.packs), prov: 'measured', sub: `${c.sent} sent` },
        { label: 'Closing in 7 days', value: String(c.due7), prov: 'measured', sub: `${s.deadlines.passed.length} dates passed` },
        { label: 'Decisions waiting', value: String(c.decisions), prov: 'measured', sub: 'only you can answer' },
        { label: 'Replies, 7 days', value: s.replies.available ? String(c.replies_week) : '–', prov: 'measured', sub: s.replies.available ? `${s.replies.humans} from people · ${s.replies.linkedin} LinkedIn · ${s.replies.ats} portals (${mailDays} d)` : 'inbox not synced' },
      ] },
      ...(due.length ? [{ type: 'timeline', title: 'Closing dates', items: due.map((d) => ({ time: d.date, title: short(d.what, 60), sub: d.in_days === 0 ? 'today' : `in ${plural(d.in_days, 'day')}${d.kind === 'discovery' ? ' · no pack yet' : ''}` })) }] : []),
      { type: 'table', title: 'Packs', cols: [{ key: 'r', label: 'Role' }, { key: 'f', label: 'Fit', align: 'r' }, { key: 'p', label: 'Pay vs floor' }, { key: 'v', label: 'Call' }, { key: 's', label: 'Status' }],
        rows: s.packs.map((p) => ({ r: short(p.role, 60), f: p.fit || '–', p: short(p.pay, 28) || '–', v: short(p.recommendation, 22) || '–', s: short(p.status, 40) || '–' })) },
      { type: 'list', title: 'Decisions waiting on you', empty: 'None.', rows: s.decisions.map((d) => ({ title: `${d.n}. ${short(d.text, 110)}`, level: 'medium' })) },
      { type: 'list', title: 'Holds before anything is sent', empty: 'None.', rows: s.holds.map((h) => ({ title: h.title, sub: short(h.text.replace(h.title, '').replace(/^[\s—–:.-]+/, ''), 120), level: 'medium' })) },
      ...(s.replies.available ? [{ type: 'list', title: `Application mail, ${mailDays} days`, empty: 'Nothing matched a pack or a portal.', rows: s.replies.rows.slice(0, 12).map((m) => ({ title: m.subject || '(no subject)', sub: `${m.from} · ${String(m.ts).slice(0, 10)}`, tag: m.kind === 'human' ? 'Person' : m.kind === 'linkedin' ? 'LinkedIn' : 'Portal', level: m.kind === 'human' ? 'high' : 'low' })) }] : []),
      { type: 'list', title: 'Already out', empty: 'Nothing recorded as sent.', rows: s.out.map((o) => ({ title: short(o.text, 110), sub: o.date || '' })) },
      { type: 'list', title: 'Links queued for AppyJobHunter', empty: 'Say "Kit, new job <link>" or paste one here.', rows: s.queued.slice(-8).reverse().map((q) => ({ title: q.url.replace(/^https?:\/\//, ''), sub: `${q.when} · ${q.from}${q.done ? ` · ${q.note}` : ''}`, tag: q.done ? 'Taken' : 'Waiting' })) },
      { type: 'notice', tone: 'info', text: `From the tracker v${s.version || '?'} (updated ${s.updated || 'unknown'}) and the mail already on this Mac. Packs are built and the tracker written by AppyJobHunter in Claude Code; KITT never sends an application.` },
      { type: 'actions', items: [{ label: 'Read my application status', utterance: 'job status', kind: 'primary' }, { label: "What's closing soon", utterance: 'job deadlines', kind: 'ghost' }, { label: 'Any replies', utterance: 'any job replies', kind: 'ghost' }] },
    ];
    return { headline, sections };
  }

  // ---------- speech ----------
  const sayDue = (dl, max = 3) => spokenList(dl.slice(0, max).map((d) => `${employerOf(d.what)} ${d.in_days === 0 ? 'today' : d.in_days === 1 ? 'tomorrow' : `in ${plural(d.in_days, 'day')}`}`), { max });
  function statusText(s) {
    if (!s.ok) return `I can't read the applications tracker: ${s.error}.`;
    const c = s.counts; const due = s.deadlines.upcoming.filter((d) => d.in_days <= 7);
    const bits = [`${plural(c.packs, 'application pack')} built, ${c.sent ? `${c.sent} sent` : 'none sent yet'}`];
    if (due.length) bits.push(`closing soon: ${sayDue(due)}`);
    if (c.decisions) bits.push(`${plural(c.decisions, 'decision')} waiting on you`);
    if (s.replies.available && c.replies_week) bits.push(`${plural(c.replies_week, 'application e-mail')} this week${s.replies.humans ? `, ${s.replies.humans} from people` : ''}`);
    if (c.queued_open) bits.push(`${plural(c.queued_open, 'link')} queued for AppyJobHunter`);
    return `Jobs: ${bits.join('; ')}. Tracker last updated ${s.updated || 'at an unknown date'}.`;
  }

  return {
    id: 'jobs', name: 'Jobs', aliases: ['applications', 'career'],
    description: "job applications: the tracker AppyJobHunter keeps, closing dates, decisions waiting, replies in the inbox, and links queued for a pack",
    intents: [
      { name: 'status', description: 'where the applications stand', examples: ['job status', 'where are my applications'], patterns: ['jobs?( status| update)?', '(job|application)s? (status|update|summary|recap)', 'where are my (job )?applications', 'how are (my|the) (job )?applications( going| doing)?', 'applications? status', 'career (status|update)'] },
      { name: 'deadlines', description: 'closing dates ahead', examples: ['job deadlines'], patterns: ['(job|application)s? deadlines?', "what('s| is) closing( soon)?", 'closing dates?', 'any (job )?deadlines?( this week| soon)?', 'when do (my )?applications close'] },
      { name: 'decisions', description: 'the decisions only the owner can make', examples: ['job decisions'], patterns: ['(job|application)s? decisions?', 'what do you need from me (on|for) (the )?(jobs|applications)', 'what am i holding up on (the )?(jobs|applications)'] },
      { name: 'replies', description: 'application mail: people, LinkedIn, portals', examples: ['any job replies'], patterns: ['any (job|application|recruiter) (replies|reply|feedback|responses?|mail|e-?mails?)', '(job|application|recruiter) (replies|feedback|responses?)', 'did anyone (reply|respond|get back)( to (me|my applications?))?', 'any (news|feedback) on (my )?applications'] },
      { name: 'queue', description: 'queue a job link for AppyJobHunter to triage and pack', examples: ['new job https://…'], patterns: ['(new|queue|save|add|pack) (this )?(job|role|vacancy|posting)[:,]? {url}', '(job|role) link[:,]? {url}', 'apply (to|for)[:,]? {url}'], slots: ['url'], write: true },
    ],
    async handle(intent, slots) {
      const s = snapshot();
      if (intent === 'status') return { speak: statusText(s), display: s };
      if (intent === 'deadlines') {
        if (!s.ok) return { speak: statusText(s) };
        const up = s.deadlines.upcoming.filter((d) => d.in_days <= 30);
        return { speak: up.length ? `${plural(up.length, 'closing date')} in the next month: ${sayDue(up, 5)}.${s.deadlines.passed.length ? ` ${plural(s.deadlines.passed.length, 'date has', 'dates have')} passed.` : ''}` : `No closing dates in the next month.${s.deadlines.passed.length ? ` ${plural(s.deadlines.passed.length, 'date has', 'dates have')} passed.` : ''}`, display: s.deadlines };
      }
      if (intent === 'decisions') {
        if (!s.ok) return { speak: statusText(s) };
        return { speak: s.decisions.length ? `${plural(s.decisions.length, 'decision')} waiting on you: ${spokenList(s.decisions.map((d) => `${d.n}. ${short(d.text.replace(/\.+$/, ''), 80)}`), { max: 4 })}.` : 'No decisions waiting on you.', display: s.decisions };
      }
      if (intent === 'replies') {
        if (!s.replies.available) return { speak: 'The inbox is not synced on this hub, so I cannot see application mail.' };
        const r = s.replies; const week = r.rows.filter((x) => x.ts >= new Date(Date.now() - 7 * 86_400_000).toISOString());
        if (!week.length) return { speak: `No application mail this week. ${plural(r.rows.length, 'message')} in the last ${mailDays} days.`, display: r };
        return { speak: `${plural(week.length, 'application e-mail')} this week: ${spokenList(week.slice(0, 4).map((m) => `${m.kind === 'human' ? 'from' : m.kind === 'linkedin' ? 'LinkedIn,' : 'portal,'} ${m.from}, ${m.subject}`), { max: 4 })}.`, display: r };
      }
      if (intent === 'queue') {
        const clean = cleanUrl(slots.url); if (!clean) return { speak: "I didn't catch a web address in that." };
        const host = new URL(clean).hostname.replace(/^www\./, '');
        return { speak: `Queue the ${host} link for AppyJobHunter to triage?`, confirm: { summary: `queue job link on ${host}`, action: { type: 'queue', url: clean } } };
      }
      return { speak: "I didn't catch which jobs question that was." };
    },
    async execute(action, c) {
      if (action.type === 'queue') {
        try { const r = queue(action.url, c?.source); return { speak: r.duplicate ? `That link was already queued on ${r.when}.` : 'Queued. AppyJobHunter picks it up next time it runs in Claude Code.' }; }
        catch (e) { return { speak: `I could not queue it: ${e.message}.` }; }
      }
      return { speak: 'Unknown action.' };
    },
    routes: [
      { method: 'POST', path: '/link', scope: 'write', handler: (c) => { const r = queue(c.body?.url, c.body?.source || 'api'); return { ok: true, ...r }; } },
    ],
    async brief({ kind }) {
      const s = snapshot();
      if (!s.ok) return kind === 'morning' ? { speak: 'Jobs: the tracker is not readable.' } : null;
      const c = s.counts; const due = s.deadlines.upcoming.filter((d) => d.in_days <= (kind === 'morning' ? 7 : 2));
      const todayMail = s.replies.available ? s.replies.rows.filter((x) => String(x.ts).slice(0, 10) === s.today) : [];
      if (kind === 'evening' && !due.length && !todayMail.length) return null;
      const bits = [];
      if (due.length) bits.push(`${plural(due.length, 'application closes', 'applications close')} soon: ${sayDue(due)}`);
      if (kind === 'morning' && c.packs) bits.push(`${plural(c.packs, 'pack')} ready, ${c.sent ? `${c.sent} sent` : 'none sent'}`);
      if (todayMail.length) bits.push(`${plural(todayMail.length, 'application e-mail')} today${todayMail.some((m) => m.kind === 'human') ? ', one from a person' : ''}`);
      else if (kind === 'morning' && c.replies_week) bits.push(`${plural(c.replies_week, 'application e-mail')} this week`);
      if (kind === 'morning' && c.decisions) bits.push(`${plural(c.decisions, 'decision')} waiting on you`);
      if (!bits.length) return null;
      return { speak: `Jobs: ${bits.join('; ')}.`, decisions: kind === 'morning' ? c.decisions : 0 };
    },
    async view() { const s = snapshot(); return { ...s, ui: ui(s) }; },
    async health() { const { tracker: t, error } = load(); return { ok: Boolean(t), detail: t ? `tracker v${t.version || '?'} updated ${t.updated || '?'}; ${t.packs.length} packs; mail ${hasMail() ? 'on' : 'off'}` : error }; },
    async dashboard() {
      const s = snapshot(); if (!s.ok) return `<p>${esc(s.error)}</p>`;
      const rows = s.packs.map((p) => `<tr><td>${esc(p.role)}</td><td>${esc(p.fit || '')}</td><td>${esc(p.pay || '')}</td><td>${esc(p.recommendation || '')}</td><td>${esc(p.deadline || p.date || '')}</td><td>${esc(p.status || '')}</td></tr>`).join('');
      return `<p>Tracker v${esc(s.version)} updated ${esc(s.updated)} · ${s.counts.decisions} decisions waiting · ${s.counts.due7} closing in 7 days · ${s.replies.available ? `${s.counts.replies_week} application e-mails this week` : 'inbox not synced'}</p><table><tr><th>Role</th><th>Fit</th><th>Pay vs floor</th><th>Call</th><th>Closes</th><th>Status</th></tr>${rows}</table>`;
    },
    _internal: { snapshot, replies, queue, queued, ui, load },
  };
}
