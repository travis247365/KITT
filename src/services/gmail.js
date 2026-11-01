// Shared Gmail ingestion over Composio (GMAIL_FETCH_EMAILS). Several skills read mail (receptionist, subscriptions,
// trips, money); they all go through this cache so Gmail is hit once per query window, not once per skill.
import { log } from '../log.js';

export const GMAIL_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS mail_messages (
     id TEXT PRIMARY KEY, thread_id TEXT, sender_name TEXT, sender_email TEXT, to_addr TEXT, subject TEXT, snippet TEXT, body_text TEXT,
     ts TEXT, labels TEXT, has_attachments INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL DEFAULT (datetime('now')), tags TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX IF NOT EXISTS mail_ts ON mail_messages(ts);
   CREATE INDEX IF NOT EXISTS mail_sender ON mail_messages(sender_email);
   CREATE TABLE IF NOT EXISTS mail_sync (query TEXT PRIMARY KEY, last_sync_at TEXT, fetched INTEGER NOT NULL DEFAULT 0, new_rows INTEGER NOT NULL DEFAULT 0, last_error TEXT);`,
];

export function parseAddress(s) {
  const str = String(s || '');
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(str);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: str.trim().toLowerCase() };
}

export function htmlToText(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function normalizeMessage(m) {
  const from = parseAddress(m.sender);
  const text = m.messageText ? (/<[a-z][\s\S]*>/i.test(m.messageText) ? htmlToText(m.messageText) : String(m.messageText)) : '';
  return {
    id: m.messageId, thread_id: m.threadId, sender_name: from.name, sender_email: from.email, to_addr: m.to || '', subject: m.subject || '',
    snippet: (m.preview && m.preview.body) || '', body_text: text, ts: m.messageTimestamp || null, labels: JSON.stringify(m.labelIds || []),
    has_attachments: Array.isArray(m.attachmentList) && m.attachmentList.length ? 1 : 0,
  };
}

export function createGmail({ db, composio }) {
  let _upsert = null; // prepared lazily: the skill's migrations run after define() returns
  const upsert = { run: (row) => (_upsert ||= db.prepare(UPSERT_SQL)).run(row) };
  const UPSERT_SQL = `INSERT INTO mail_messages(id, thread_id, sender_name, sender_email, to_addr, subject, snippet, body_text, ts, labels, has_attachments, tags)
    VALUES (@id, @thread_id, @sender_name, @sender_email, @to_addr, @subject, @snippet, @body_text, @ts, @labels, @has_attachments, @tags)
    ON CONFLICT(id) DO UPDATE SET labels = excluded.labels, snippet = CASE WHEN excluded.snippet <> '' THEN excluded.snippet ELSE mail_messages.snippet END,
      body_text = CASE WHEN excluded.body_text <> '' THEN excluded.body_text ELSE mail_messages.body_text END,
      tags = CASE WHEN instr(mail_messages.tags, excluded.tags) > 0 THEN mail_messages.tags ELSE mail_messages.tags || excluded.tags END`;

  /** Raw fetch (normalized). verbose=true pulls bodies (slower, ~4x). */
  async function fetch(query, { max = 25, verbose = false, pageToken } = {}) {
    const params = { query, max_results: Math.min(500, max), verbose, include_payload: verbose, ids_only: false };
    if (pageToken) params.page_token = pageToken;
    const data = await composio.execute('GMAIL_FETCH_EMAILS', params, { timeoutMs: 180000 });
    const messages = (data.messages || []).map(normalizeMessage);
    return { messages, nextPageToken: data.nextPageToken || null, estimate: data.resultSizeEstimate };
  }

  /** Sync a query into the cache; tags rows with `tag` (e.g. 'receipt', 'spotify') so skills can find their own slice. */
  async function sync(query, { max = 50, verbose = false, tag = '' } = {}) {
    const started = Date.now();
    try {
      const { messages } = await fetch(query, { max, verbose });
      let fresh = 0;
      const tx = db.prepare('SELECT 1 FROM mail_messages WHERE id = ?');
      for (const m of messages) { if (!tx.get(m.id)) fresh++; upsert.run({ ...m, tags: tag ? `|${tag}|` : '' }); }
      db.prepare("INSERT INTO mail_sync(query, last_sync_at, fetched, new_rows, last_error) VALUES (?, datetime('now'), ?, ?, NULL) ON CONFLICT(query) DO UPDATE SET last_sync_at = excluded.last_sync_at, fetched = excluded.fetched, new_rows = excluded.new_rows, last_error = NULL").run(query, messages.length, fresh);
      log.info('gmail sync', { query: query.slice(0, 80), fetched: messages.length, fresh, ms: Date.now() - started });
      return { fetched: messages.length, fresh, messages };
    } catch (e) {
      db.prepare("INSERT INTO mail_sync(query, last_sync_at, last_error) VALUES (?, datetime('now'), ?) ON CONFLICT(query) DO UPDATE SET last_error = excluded.last_error").run(query, String(e.message).slice(0, 300));
      throw e;
    }
  }

  /** Pull the full body for one cached message (when the snippet is not enough, e.g. receipts). */
  async function hydrate(id) {
    const row = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(id);
    if (!row) return null;
    if (row.body_text) return row;
    const { messages } = await fetch(`rfc822msgid:${id}`, { max: 1, verbose: true }).catch(() => ({ messages: [] }));
    let m = messages.find((x) => x.id === id);
    if (!m) {
      // rfc822msgid wants the Message-ID header, not the Gmail id; fall back to the dedicated fetch tool.
      const data = await composio.execute('GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', { message_id: id, format: 'full' }, { timeoutMs: 60000 });
      m = normalizeMessage({ ...data, messageId: data.messageId || id, messageText: data.messageText || data.body || '', preview: data.preview, sender: data.sender || row.sender_email, subject: data.subject || row.subject, messageTimestamp: data.messageTimestamp || row.ts, labelIds: data.labelIds || JSON.parse(row.labels || '[]') });
    }
    if (m && m.body_text) { db.prepare('UPDATE mail_messages SET body_text = ? WHERE id = ?').run(m.body_text, id); return { ...row, body_text: m.body_text }; }
    return row;
  }

  function query({ where = '1=1', params = [], limit = 100, order = 'ts DESC' } = {}) {
    return db.prepare(`SELECT * FROM mail_messages WHERE ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit);
  }

  function byTag(tag, limit = 200) { return query({ where: 'instr(tags, ?) > 0', params: [`|${tag}|`], limit }); }

  function lastSync(q) { return db.prepare('SELECT * FROM mail_sync WHERE query = ?').get(q) || null; }

  return { fetch, sync, hydrate, query, byTag, lastSync };
}
