// Skill 7 — Creator Collab Matchmaker: discovers creators in Travis's niche (Firecrawl web search), scores fit deterministically,
// keeps a small CRM, e-mails a weekly recommendation list (Resend) with suggested openers. KITT never contacts creators.
import { run, BIN, parseJson } from '../../services/cli.js';
import { spokenList, plural } from '../../voice.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS collab_creators (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT, url TEXT, handle TEXT, snippet TEXT, country TEXT, audience INTEGER, audience_source TEXT,
     score INTEGER NOT NULL DEFAULT 0, reasons TEXT, status TEXT NOT NULL DEFAULT 'new', opener TEXT, discovered_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), query TEXT
   );
   CREATE TABLE IF NOT EXISTS collab_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), queries INTEGER, found INTEGER, fresh INTEGER, error TEXT);`,
];

const TOPICS = [[/\b(data|analytics|analyst|bi|dashboard)\b/i, 'data', 18], [/\b(ai|machine learning|ml|llm|automation|agent)\b/i, 'AI', 16], [/\b(fintech|payments|mobile money|momo|paygo|lending|collections|credit)\b/i, 'fintech/collections', 16], [/\b(telecom|telco|bpo|call cent(?:er|re)|customer experience|cx|cvm)\b/i, 'telecom/BPO/CX', 14], [/\b(consult|strategy|founder|entrepreneur|business)\b/i, 'business', 8], [/\b(podcast|host|show|interview)\b/i, 'podcast format', 10], [/\b(linkedin|creator|newsletter|youtube|tiktok|instagram)\b/i, 'creator platform', 6]];
const GEO = [[/\b(zambia|zambian|lusaka|kitwe|ndola)\b/i, 'Zambia', 20], [/\b(south africa|johannesburg|cape town|pretoria|durban|sa\b)/i, 'South Africa', 10], [/\b(kenya|nairobi|nigeria|lagos|ghana|accra|uganda|tanzania|rwanda|zimbabwe|botswana|malawi)\b/i, 'Africa', 8], [/\bafrica(n)?\b/i, 'Africa', 6]];

export function scoreCandidate(c) {
  const hay = `${c.name || ''} ${c.snippet || ''} ${c.url || ''}`;
  let score = 0; const reasons = [];
  for (const [re, label, pts] of TOPICS) if (re.test(hay)) { score += pts; reasons.push(label); }
  let geo = null; for (const [re, label, pts] of GEO) if (re.test(hay)) { score += pts; geo = geo || label; reasons.push(label); break; }
  const aud = /(\d[\d,.]*)\s?([kKmM])?\s?(followers|subscribers|members|listeners)/i.exec(hay);
  let audience = null;
  if (aud) { audience = Math.round(Number(aud[1].replace(/,/g, '')) * (aud[2] ? (aud[2].toLowerCase() === 'k' ? 1000 : 1000000) : 1)); if (audience >= 1000 && audience <= 100000) { score += 12; reasons.push(`audience ${audience.toLocaleString('en-GB')} (sweet spot)`); } else if (audience > 100000) { score += 4; reasons.push('large audience (harder reach)'); } }
  const platform = /linkedin\.com/i.test(c.url) ? 'linkedin' : /youtube\.com|youtu\.be/i.test(c.url) ? 'youtube' : /instagram\.com/i.test(c.url) ? 'instagram' : /spotify\.com|podcast|anchor\.fm|apple\.com\/.*podcast/i.test(c.url) ? 'podcast' : /tiktok\.com/i.test(c.url) ? 'tiktok' : 'web';
  if (['linkedin', 'podcast', 'youtube'].includes(platform)) { score += 6; reasons.push(platform); }
  if (/\b(job|vacancy|hiring|recruit|course for sale|buy now)\b/i.test(hay)) score -= 15;
  return { score: Math.max(0, Math.min(100, score)), reasons: [...new Set(reasons)], platform, country: geo, audience };
}

export default function define(ctx) {
  const { db, config, brain, notifier, log } = ctx;
  const cfg = { queries: ['Zambia data analytics LinkedIn creator', 'Zambian tech podcast host', 'Lusaka business podcast founder interviews', 'Africa fintech YouTube creator mobile money', 'Zambia AI automation consultant LinkedIn newsletter', 'African customer experience BPO thought leader podcast', 'Zambia entrepreneurship content creator Instagram', 'PAYGo solar Africa podcast'], per_query: 6, ...(config.collab || {}) };
  let running = null;

  async function searchFirecrawl(q, limit) {
    if (!fs.existsSync(BIN.firecrawl)) throw new Error('firecrawl CLI not installed');
    // firecrawl CLI prints text blocks: "Title\n  URL: https://…\n  description…" (no JSON flag in v1.26)
    const r = await run(BIN.firecrawl, ['search', q, '--limit', String(limit)], { timeoutMs: 90000 });
    const j = parseJson(r.out);
    if (j) { const items = Array.isArray(j) ? j : j?.data?.web || j?.data || j?.results || j?.web || []; return items.map((x) => ({ name: (x.title || x.name || '').slice(0, 120), url: x.url || x.link || '', snippet: (x.description || x.snippet || x.markdown || '').slice(0, 500) })).filter((x) => x.url); }
    const out = []; let cur = null;
    for (const raw of String(r.out).split(/\r?\n/)) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
      const u = /^\s+URL:\s*(\S+)/.exec(line);
      if (u && cur) { cur.url = u[1]; continue; }
      if (/^\S/.test(line) && line.trim()) { if (cur?.url) out.push(cur); cur = { name: line.trim().slice(0, 120), url: '', snippet: '' }; continue; }
      if (cur && line.trim()) cur.snippet = `${cur.snippet} ${line.trim()}`.trim().slice(0, 500);
    }
    if (cur?.url) out.push(cur);
    return out;
  }

  async function discover() {
    const started = Date.now(); let found = 0; let fresh = 0; let error = null;
    for (const q of cfg.queries) {
      try {
        const items = await searchFirecrawl(q, cfg.per_query);
        for (const it of items) {
          if (/linkedin\.com\/jobs|indeed|glassdoor|wikipedia/i.test(it.url)) continue;
          const sc = scoreCandidate(it); if (sc.score < 20) continue;
          const id = crypto.createHash('sha1').update(it.url.replace(/[?#].*$/, '').toLowerCase()).digest('hex').slice(0, 14);
          found++;
          const exists = db.prepare('SELECT 1 FROM collab_creators WHERE id = ?').get(id);
          if (exists) { db.prepare("UPDATE collab_creators SET last_seen = datetime('now'), score = MAX(score, ?) WHERE id = ?").run(sc.score, id); continue; }
          db.prepare('INSERT INTO collab_creators(id, name, platform, url, handle, snippet, country, audience, audience_source, score, reasons, query) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, it.name || it.url, sc.platform, it.url, handleFrom(it.url), it.snippet, sc.country, sc.audience, sc.audience ? 'EXTRACTED (snippet)' : null, sc.score, sc.reasons.join('; '), q); fresh++;
        }
      } catch (e) { error = e.message; log.warn('collab query failed', { q, err: e.message }); }
    }
    db.prepare('INSERT INTO collab_runs(queries, found, fresh, error) VALUES (?, ?, ?, ?)').run(cfg.queries.length, found, fresh, error);
    ctx.kv.set('collab', 'last_run', { at: new Date().toISOString(), found, fresh, error, ms: Date.now() - started });
    return { found, fresh, error };
  }

  const top = (n = 5, status = 'new') => db.prepare('SELECT * FROM collab_creators WHERE status = ? ORDER BY score DESC, discovered_at DESC LIMIT ?').all(status, n);
  const find = (q) => { const s = String(q || '').toLowerCase(); return db.prepare('SELECT * FROM collab_creators ORDER BY score DESC').all().find((c) => c.name.toLowerCase().includes(s) || (c.handle || '').toLowerCase().includes(s)) || null; };

  async function opener(c) {
    if (c.opener) return c.opener;
    try { const o = await brain.speak(`Write a two-sentence, specific, non-salesy LinkedIn opener from the owner (a data/AI consultant) proposing a collaboration (podcast guest, co-written post or a joint LinkedIn Live) with this creator: "${c.name}" — ${c.snippet.slice(0, 300)}. Output only the message.`, { maxWords: 60 }); db.prepare('UPDATE collab_creators SET opener = ? WHERE id = ?').run(o, c.id); return o; }
    catch { return null; }
  }

  async function weeklyEmail() {
    const picks = top(5);
    if (!picks.length) return { sent: false, reason: 'no new candidates' };
    for (const c of picks) await opener(c);
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const rows = picks.map((c) => `<tr><td><a href="${esc(c.url)}">${esc(c.name)}</a><br><small>${esc(c.platform)}${c.country ? ' · ' + esc(c.country) : ''}${c.audience ? ' · ~' + c.audience.toLocaleString('en-GB') : ''}</small></td><td>${c.score}</td><td>${esc(c.reasons)}</td><td>${esc(c.opener || '—')}</td></tr>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#3A3A3A"><p>KITT's collaboration shortlist for the week. Nobody has been contacted; openers are drafts.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Creator</th><th>Fit</th><th>Why</th><th>Suggested opener</th></tr>${rows}</table><p>Reply in the car: "Kit, shortlist &lt;name&gt;" or "Kit, pass on &lt;name&gt;".</p></div>`;
    const r = await notifier.email({ subject: `KITT: ${picks.length} creator collab recommendations`, html });
    return { sent: r.ok, picks: picks.length };
  }

  return {
    id: 'collab', name: 'Collab Matchmaker', aliases: ['creators'],
    description: 'finds creators worth collaborating with, scores the fit, and e-mails a weekly shortlist with draft openers',
    migrations: MIGRATIONS,
    intents: [
      { name: 'recommend', description: 'who to collaborate with this week', examples: ['who should I collaborate with this week'], patterns: ['who should i (collaborate|collab|partner) with( this week)?', '(any |my )?collab (recommendations|suggestions|shortlist)', 'creator (recommendations|matches)', 'who should i reach out to'] },
      { name: 'shortlist', description: 'shortlist a creator', examples: ['shortlist Alex'], patterns: ['shortlist {who}', 'add {who} to the shortlist', 'i like {who}'], slots: ['who'], write: true },
      { name: 'pass', description: 'pass on a creator', examples: ['pass on Alex'], patterns: ['pass on {who}', 'skip {who}', 'not {who}'], slots: ['who'], write: true },
      { name: 'discover', description: 'run discovery now', examples: ['find new creators'], patterns: ['find (new |more )?creators( to collaborate with)?', '(run|refresh) (creator |collab )?discovery', 'look for collaborators'] },
      { name: 'email', description: 'send the weekly recommendation e-mail now', examples: ['send me the collab email'], patterns: ['(send|email) (me )?(the )?collab (email|recommendations|shortlist)', 'email the creator shortlist'], write: true },
    ],
    routines: [
      { name: 'collab.discover', cron: '0 5 * * 1', description: 'weekly discovery sweep', catchUpMinutes: 720, run: async () => ({ summary: JSON.stringify(await discover()) }) },
      { name: 'collab.weekly_email', cron: '0 8 * * 1', description: 'weekly recommendation e-mail', catchUpMinutes: 0, run: async () => ({ summary: JSON.stringify(await weeklyEmail()) }) },
    ],
    async handle(intent, slots, c) {
      if (intent === 'discover') { if (c.source === 'cli') { const r = await discover(); return { speak: `Discovery done: ${r.found} candidates seen, ${r.fresh} new.${r.error ? ` Last error: ${r.error.slice(0, 80)}` : ''}` }; } if (!running) running = discover().catch(() => {}).finally(() => { running = null; }); return { speak: 'Looking for creators in the background; ask for recommendations in a few minutes.' }; }
      if (intent === 'recommend') { const picks = top(3); if (!picks.length) return { speak: ctx.kv.get('collab', 'last_run') ? 'No new creator candidates right now.' : "I haven't run discovery yet. Say 'find new creators'." }; return { speak: `Top matches: ${spokenList(picks.map((p) => `${p.name}, ${p.platform}${p.country ? ` in ${p.country}` : ''}, fit ${p.score}`))}. Say shortlist or pass with a name.`, display: picks }; }
      if (intent === 'shortlist' || intent === 'pass') { const cr = find(slots.who); if (!cr) return { speak: `I can't find a creator matching ${slots.who}.` }; return { speak: `${intent === 'shortlist' ? 'Shortlist' : 'Pass on'} ${cr.name}?`, confirm: { summary: `${intent} ${cr.name}`, action: { type: intent, id: cr.id, name: cr.name } } }; }
      if (intent === 'email') return { speak: `Send the weekly collab e-mail with the top ${Math.min(5, top(5).length)} to ${notifier.configured.defaultTo || 'you'}?`, confirm: { summary: 'send collab e-mail', action: { type: 'email' } } };
      return { speak: "I didn't catch which collab action that was." };
    },
    async execute(action) {
      if (action.type === 'shortlist' || action.type === 'pass') { db.prepare('UPDATE collab_creators SET status = ? WHERE id = ?').run(action.type === 'shortlist' ? 'shortlist' : 'passed', action.id); return { speak: `${action.name} ${action.type === 'shortlist' ? 'shortlisted' : 'passed'}.` }; }
      if (action.type === 'email') { const r = await weeklyEmail(); return { speak: r.sent ? `Sent with ${plural(r.picks, 'recommendation')}.` : `Not sent: ${r.reason || 'delivery failed, spooled for retry'}.` }; }
      return { speak: 'Unknown action.' };
    },
    async brief({ kind }) { if (kind !== 'morning' || new Date().getDay() !== 1) return null; const n = top(5).length; return n ? { speak: `${plural(n, 'creator recommendation')} ready; ask who you should collaborate with.` } : null; },
    async view() { return { top: top(10), shortlist: top(20, 'shortlist'), last_run: ctx.kv.get('collab', 'last_run') }; },
    async health() { const lr = ctx.kv.get('collab', 'last_run'); return { ok: fs.existsSync(BIN.firecrawl), detail: `${fs.existsSync(BIN.firecrawl) ? 'firecrawl present' : 'firecrawl CLI missing'}; ${lr ? `last run ${lr.at}: ${lr.found} found, ${lr.fresh} new${lr.error ? `, error ${lr.error.slice(0, 60)}` : ''}` : 'never run'}; ${db.prepare('SELECT count(*) n FROM collab_creators').get().n} creators` }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); const rows = db.prepare('SELECT * FROM collab_creators ORDER BY score DESC LIMIT 30').all(); return `<table><tr><th>Creator</th><th>Platform</th><th>Country</th><th>Audience</th><th>Fit</th><th>Why</th><th>Status</th></tr>${rows.map((c) => `<tr><td><a href="${esc(c.url)}">${esc(c.name)}</a></td><td>${esc(c.platform)}</td><td>${esc(c.country || '')}</td><td>${c.audience ? esc(c.audience.toLocaleString('en-GB')) + ' <small>' + esc(c.audience_source) + '</small>' : ''}</td><td>${c.score}</td><td>${esc(c.reasons)}</td><td>${esc(c.status)}</td></tr>`).join('')}</table>`; },
    _internal: { scoreCandidate, discover, weeklyEmail, top },
  };
}

function handleFrom(url) { const m = /linkedin\.com\/(?:in|company)\/([^/?#]+)|instagram\.com\/([^/?#]+)|youtube\.com\/(@[^/?#]+|c\/[^/?#]+|channel\/[^/?#]+)|tiktok\.com\/(@[^/?#]+)/i.exec(url || ''); return m ? (m[1] || m[2] || m[3] || m[4]) : null; }
