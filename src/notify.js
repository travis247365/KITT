// Outbound notifications: ntfy.sh push to the iPhone and Resend email (standing rule: Resend for all email).
// Every failure is spooled in SQLite and retried by the scheduler; nothing vanishes silently.
import { log } from './log.js';

const UA = 'kitt/0.1 (macOS launchd)';

export function createNotifier({ db, secrets, config }) {
  const topic = secrets.KITT_NTFY_TOPIC || secrets.NTFY_TOPIC;
  const resendKey = secrets.KITT_RESEND_API_KEY || secrets.RESEND_API_KEY;
  const from = secrets.KITT_RESEND_FROM || secrets.RESEND_FROM;
  const defaultTo = secrets.KITT_EMAIL_TO || secrets.REPORT_TO || config.owner?.email;

  async function push({ title, body, tags = 'robot', priority = 'default', click, actions }) {
    if (!topic) { log.warn('ntfy topic not configured; push skipped', { title }); return { ok: false, skipped: true }; }
    const headers = { Title: title, Tags: tags, Priority: String(priority), 'User-Agent': UA };
    if (click) headers.Click = click;
    if (actions) headers.Actions = actions;
    try {
      const r = await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', headers, body: String(body ?? ''), signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`ntfy HTTP ${r.status}`);
      return { ok: true };
    } catch (e) {
      spool(db, 'push', { title, body, tags, priority, click, actions }, e.message);
      log.warn('ntfy failed; spooled', { err: e.message });
      return { ok: false, error: e.message };
    }
  }

  async function email({ to, subject, text, html }) {
    const rcpt = to || defaultTo;
    if (!resendKey || !from) { log.warn('Resend not configured; email spooled', { subject }); spool(db, 'email', { to: rcpt, subject, text, html }, 'resend not configured'); return { ok: false, skipped: true }; }
    if (!rcpt) throw new Error('no recipient: set KITT_EMAIL_TO');
    const payload = { from, to: Array.isArray(rcpt) ? rcpt : [rcpt], subject };
    if (html) payload.html = html;
    payload.text = text || (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`resend HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      return { ok: true, id: j.id };
    } catch (e) {
      spool(db, 'email', payload, e.message);
      log.warn('resend failed; spooled', { err: e.message });
      return { ok: false, error: e.message };
    }
  }

  /** Retry spooled items (called by the scheduler every few minutes). */
  async function flushSpool(limit = 20) {
    const rows = db.prepare('SELECT * FROM spool WHERE sent_at IS NULL AND attempts < 10 ORDER BY id LIMIT ?').all(limit);
    let sent = 0;
    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      let res;
      if (row.kind === 'push') res = await rawPush(payload);
      else if (row.kind === 'email') res = await rawEmail(payload);
      else res = { ok: false, error: 'unknown kind' };
      if (res.ok) { db.prepare("UPDATE spool SET sent_at = datetime('now') WHERE id = ?").run(row.id); sent++; }
      else db.prepare('UPDATE spool SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(String(res.error || '').slice(0, 300), row.id);
    }
    return { tried: rows.length, sent };
  }

  async function rawPush({ title, body, tags, priority, click, actions }) {
    if (!topic) return { ok: false, error: 'no topic' };
    const headers = { Title: title, Tags: tags || 'robot', Priority: String(priority || 'default'), 'User-Agent': UA };
    if (click) headers.Click = click; if (actions) headers.Actions = actions;
    try { const r = await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', headers, body: String(body ?? ''), signal: AbortSignal.timeout(10000) }); return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  async function rawEmail(payload) {
    if (!resendKey || !from) return { ok: false, error: 'resend not configured' };
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ ...payload, from: payload.from || from }), signal: AbortSignal.timeout(30000) });
      return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { push, email, flushSpool, configured: { push: Boolean(topic), email: Boolean(resendKey && from), defaultTo: defaultTo || null } };
}

function spool(db, kind, payload, err) {
  try { db.prepare('INSERT INTO spool(kind, payload, attempts, last_error) VALUES (?, ?, 1, ?)').run(kind, JSON.stringify(payload), String(err || '').slice(0, 300)); } catch { /* ignore */ }
}
