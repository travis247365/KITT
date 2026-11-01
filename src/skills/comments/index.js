// Skill 6 — Comment Scraper → OneNote: pulls comments on Travis's Instagram posts through Composio's Instagram toolkit
// (official Graph API), scores sentiment/need-for-reply deterministically, writes a daily OneNote page (Composio OneNote,
// once linked), and speaks a digest. LinkedIn has no sanctioned comments API for personal posts — tracked as a manual source.
import fs from 'node:fs';
import path from 'node:path';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS comments_media (id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'instagram', caption TEXT, permalink TEXT, ts TEXT, comments_count INTEGER, like_count INTEGER, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, media_id TEXT, source TEXT NOT NULL DEFAULT 'instagram', username TEXT, text TEXT, ts TEXT, sentiment TEXT, needs_reply INTEGER NOT NULL DEFAULT 0, replied INTEGER NOT NULL DEFAULT 0, exported INTEGER NOT NULL DEFAULT 0, seen_at TEXT NOT NULL DEFAULT (datetime('now')));`,
];

const POS = /\b(love|great|awesome|amazing|congrats|congratulations|well done|brilliant|insightful|thank|thanks|🔥|👏|❤️|💯|inspiring|excellent|nice|good)\b/i;
const NEG = /\b(scam|fake|bad|terrible|hate|wrong|disappointed|worst|useless|lie|lies|fraud|rubbish|poor)\b/i;
export function score(text) { const t = String(text || ''); const q = /\?|how (do|can|much)|where|when|price|cost|contact|dm|details|link/i.test(t); const s = NEG.test(t) ? 'negative' : POS.test(t) ? 'positive' : 'neutral'; return { sentiment: s, needs_reply: q || s === 'negative' ? 1 : 0 }; }

export default function define(ctx) {
  const { db, composio, config, log, paths, brain } = ctx;
  const outDir = path.join(paths.dataDir, 'comments');
  const oneNote = { section_id: config.comments?.onenote_section_id || null };

  async function igUserId() {
    const cached = config.comments?.ig_user_id || ctx.kv.get('comments', 'ig_user_id');
    if (cached) return String(cached);
    const me = await composio.execute('INSTAGRAM_GET_USER_INFO', {}, { timeoutMs: 60000 }); // defaults to the linked account
    if (!me?.id) throw new Error('could not resolve the linked Instagram user id');
    ctx.kv.set('comments', 'ig_user_id', String(me.id)); ctx.kv.set('comments', 'ig_account', { username: me.username, name: me.name, followers: me.followers_count, type: me.account_type });
    return String(me.id);
  }

  async function syncInstagram() {
    const uid = await igUserId();
    const media = await composio.execute('INSTAGRAM_GET_IG_USER_MEDIA', { ig_user_id: uid, limit: 12, fields: 'id,caption,permalink,timestamp,comments_count,like_count,media_type' }, { timeoutMs: 60000 });
    const list = media?.data || media?.media || [];
    let fresh = 0;
    for (const m of list) {
      db.prepare('INSERT INTO comments_media(id, caption, permalink, ts, comments_count, like_count, synced_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET comments_count = excluded.comments_count, like_count = excluded.like_count, synced_at = excluded.synced_at').run(String(m.id), (m.caption || '').slice(0, 500), m.permalink || '', m.timestamp || null, m.comments_count ?? null, m.like_count ?? null);
      if (!m.comments_count) continue;
      const cs = await composio.execute('INSTAGRAM_GET_IG_MEDIA_COMMENTS', { ig_media_id: String(m.id), limit: 50, fields: 'id,text,username,timestamp,like_count' }, { timeoutMs: 60000 }).catch((e) => { log.warn('ig comments failed', { media: m.id, err: e.message }); return null; });
      for (const c of cs?.data || cs?.comments || []) {
        if (db.prepare('SELECT 1 FROM comments WHERE id = ?').get(String(c.id))) continue;
        const sc = score(c.text);
        db.prepare('INSERT INTO comments(id, media_id, username, text, ts, sentiment, needs_reply) VALUES (?, ?, ?, ?, ?, ?, ?)').run(String(c.id), String(m.id), c.username || c.from?.username || '', (c.text || '').slice(0, 2000), c.timestamp || null, sc.sentiment, sc.needs_reply); fresh++;
      }
    }
    ctx.kv.set('comments', 'last_sync', { at: new Date().toISOString(), media: list.length, fresh });
    return { media: list.length, fresh };
  }

  /** Export unexported comments to OneNote (if linked) as one HTML page per run; otherwise keep the HTML locally and retry later. */
  async function exportOneNote() {
    const rows = db.prepare('SELECT c.*, m.permalink, m.caption FROM comments c LEFT JOIN comments_media m ON m.id = c.media_id WHERE c.exported = 0 ORDER BY c.ts').all();
    if (!rows.length) return { exported: 0 };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const day = new Date().toISOString().slice(0, 10);
    const html = `<!DOCTYPE html><html><head><title>Comments ${day}</title></head><body><p>${rows.length} new comments collected by KITT.</p><table border="1"><tr><th>When</th><th>Post</th><th>User</th><th>Comment</th><th>Sentiment</th><th>Reply?</th></tr>${rows.map((r) => `<tr><td>${esc((r.ts || '').slice(0, 16))}</td><td><a href="${esc(r.permalink)}">${esc((r.caption || '').slice(0, 40))}</a></td><td>@${esc(r.username)}</td><td>${esc(r.text)}</td><td>${esc(r.sentiment)}</td><td>${r.needs_reply ? 'yes' : ''}</td></tr>`).join('')}</table></body></html>`;
    fs.mkdirSync(outDir, { recursive: true }); const file = path.join(outDir, `comments-${day}.html`); fs.writeFileSync(file, html, 'utf8');
    if (!oneNote.section_id) return { exported: 0, pending: rows.length, file, note: 'OneNote not configured (comments.onenote_section_id) — kept locally' };
    try {
      await composio.execute('ONENOTE_CREATE_ME_SECTIONS_PAGES', { onenoteSection_id: oneNote.section_id, html }, { timeoutMs: 60000 });
      db.prepare(`UPDATE comments SET exported = 1 WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id));
      return { exported: rows.length, file };
    } catch (e) { log.warn('onenote export failed; kept locally', { err: e.message, needsLink: e.needsLink }); return { exported: 0, pending: rows.length, file, error: e.message, needsLink: e.needsLink }; }
  }

  const fresh = (days = 2) => db.prepare("SELECT c.*, m.caption FROM comments c LEFT JOIN comments_media m ON m.id = c.media_id WHERE c.seen_at >= datetime('now', ?) ORDER BY c.needs_reply DESC, c.ts DESC").all(`-${days} days`);

  return {
    id: 'comments', name: 'Comment Scraper', aliases: ['ig'],
    description: 'collects comments on your Instagram posts, flags questions and negatives, exports to OneNote, suggests replies (never posts)',
    migrations: MIGRATIONS,
    intents: [
      { name: 'new', description: 'new comments since yesterday', examples: ['any new comments'], patterns: ['(any |are there any )?new comments( on my posts)?', 'what are people (saying|commenting)', 'comments (digest|summary|update)', 'check (my )?(instagram|ig) comments'] },
      { name: 'read', description: 'read comments on the latest post', examples: ['read the comments on my latest post'], patterns: ['read (me )?(the )?comments( on my (latest|last) post)?', 'what did people say on my (latest|last) post'] },
      { name: 'suggest', description: 'suggest a reply to a commenter (spoken draft only)', examples: ['suggest a reply to chanda'], patterns: ['suggest (a )?reply (to|for) {user}', 'how should i (reply|respond) to {user}', 'draft (a )?reply to {user}\'?s comment'], slots: ['user'] },
      { name: 'sync', description: 'refresh comments now', examples: ['refresh comments'], patterns: ['(refresh|sync|update|fetch) (the |my )?comments'] },
      { name: 'export', description: 'push pending comments to OneNote', examples: ['export comments to OneNote'], patterns: ['(export|send|push) (the )?comments to one ?note', 'one ?note export'], write: true },
    ],
    routines: [{ name: 'comments.daily', cron: '10 7 * * *', description: 'fetch comments, export to OneNote, push if negatives/questions', run: async () => { const s = await syncInstagram(); const e = await exportOneNote(); const hot = fresh(1).filter((c) => c.needs_reply); return { summary: `media ${s.media}, new ${s.fresh}, exported ${e.exported}${e.pending ? `, pending ${e.pending}` : ''}`, notify: hot.length ? { push: { title: `KITT: ${plural(hot.length, 'comment')} need a reply`, body: hot.slice(0, 4).map((c) => `@${c.username}: ${c.text.slice(0, 80)}`).join('\n'), tags: 'speech_balloon' } } : undefined }; } }],
    async handle(intent, slots, c) {
      if (intent === 'sync' || !ctx.kv.get('comments', 'last_sync')) { try { const r = await syncInstagram(); if (intent === 'sync') return { speak: `Comments refreshed: ${r.media} posts checked, ${r.fresh} new comments.` }; } catch (e) { return { speak: e.needsLink ? 'Instagram is not connected in Composio yet.' : `Instagram fetch failed: ${e.message.slice(0, 100)}` }; } }
      if (intent === 'new') { const rows = fresh(2); if (!rows.length) return { speak: 'No new comments in the last two days.' }; const hot = rows.filter((r) => r.needs_reply); return { speak: `${plural(rows.length, 'new comment')}${hot.length ? `, ${hot.length} worth a reply: ${spokenList(hot.map((r) => `${r.username} said ${r.text.slice(0, 60)}`), { max: 3 })}` : ', nothing that needs a reply'}.`, display: rows }; }
      if (intent === 'read') { const m = db.prepare('SELECT * FROM comments_media ORDER BY ts DESC LIMIT 1').get(); if (!m) return { speak: 'No posts on file yet.' }; const rows = db.prepare('SELECT * FROM comments WHERE media_id = ? ORDER BY ts DESC LIMIT 8').all(m.id); return { speak: rows.length ? `Latest post, ${(m.caption || '').slice(0, 60)}: ${spokenList(rows.map((r) => `${r.username}: ${r.text.slice(0, 80)}`), { max: 5 })}.` : `Latest post has no comments yet.`, display: { media: m, comments: rows } }; }
      if (intent === 'suggest') { const u = String(slots.user || '').toLowerCase().replace(/^@/, ''); const r = db.prepare('SELECT * FROM comments WHERE lower(username) LIKE ? ORDER BY ts DESC LIMIT 1').get(`%${u}%`); if (!r) return { speak: `No comment from ${slots.user} on file.` }; try { const s = await brain.speak(`Travis (data and AI consultant in Zambia) got this Instagram comment from @${r.username}: "${r.text}". Draft a warm, short reply (max 30 words) he could post. Output only the reply text.`, { maxWords: 35 }); return { speak: `Suggested reply to ${r.username}: ${s}. I never post replies; copy it from the dashboard.`, display: { comment: r, suggestion: s } }; } catch { return { speak: 'My language brain is unavailable for a draft right now.' }; } }
      if (intent === 'export') return { speak: `Export ${plural(db.prepare('SELECT count(*) n FROM comments WHERE exported = 0').get().n, 'pending comment')} to OneNote?`, confirm: { summary: 'export comments to OneNote', action: { type: 'export' } } };
      return { speak: "I didn't catch which comments action that was." };
    },
    async execute(action) { if (action.type === 'export') { const r = await exportOneNote(); return { speak: r.exported ? `Exported ${plural(r.exported, 'comment')} to OneNote.` : r.needsLink ? 'OneNote is not linked in Composio yet; the page is saved locally.' : `Nothing exported${r.note ? `: ${r.note}` : ''}.` }; } return { speak: 'Unknown action.' }; },
    async brief({ kind }) { if (kind !== 'morning') return null; const hot = fresh(1).filter((c) => c.needs_reply); return hot.length ? { speak: `${plural(hot.length, 'comment')} need a reply on Instagram.` } : null; },
    async view() { return { account: ctx.kv.get('comments', 'ig_account'), fresh: fresh(14), media: db.prepare('SELECT * FROM comments_media ORDER BY ts DESC LIMIT 12').all(), last_sync: ctx.kv.get('comments', 'last_sync'), onenote_configured: Boolean(oneNote.section_id) }; },
    async health() { const ls = ctx.kv.get('comments', 'last_sync'); return { ok: true, detail: `${ls ? `last sync ${ls.at}, ${ls.media} posts` : 'never synced'}; OneNote ${oneNote.section_id ? 'section set' : 'NOT configured'}` }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); const rows = fresh(14); return `<table><tr><th>When</th><th>User</th><th>Comment</th><th>Sentiment</th><th>Reply?</th><th>Exported</th></tr>${rows.map((r) => `<tr><td>${esc((r.ts || '').slice(0, 16))}</td><td>@${esc(r.username)}</td><td>${esc(r.text)}</td><td>${esc(r.sentiment)}</td><td>${r.needs_reply ? 'yes' : ''}</td><td>${r.exported ? 'yes' : ''}</td></tr>`).join('')}</table>`; },
    _internal: { score, syncInstagram, exportOneNote },
  };
}
