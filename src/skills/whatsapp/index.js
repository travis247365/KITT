// Skill 3 — WhatsApp Assistant for the owner's number. Transport-agnostic core: a local message store, a digest, a DRAFT outbox
// that is only ever sent by a human (or by the listener when Travis has explicitly enabled sending). The optional listener
// (listener.mjs, Baileys linked-device) is a separate process that Travis chooses to run after reading docs/WHATSAPP.md.
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS wa_chats (jid TEXT PRIMARY KEY, name TEXT, is_group INTEGER NOT NULL DEFAULT 0, vip INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, last_ts TEXT);
   CREATE TABLE IF NOT EXISTS wa_messages (id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, sender TEXT, sender_name TEXT, ts TEXT NOT NULL, type TEXT, text TEXT, from_me INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0, media_path TEXT, transcript TEXT, received_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX IF NOT EXISTS wa_msg_chat ON wa_messages(chat_jid, ts);
   CREATE TABLE IF NOT EXISTS wa_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_jid TEXT NOT NULL, chat_name TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, sent_at TEXT, error TEXT);`,
];

export default function define(ctx) {
  const { db, config, brain } = ctx;
  const cfg = { allow_send: false, vips: [], retention_days: 30, ...(config.whatsapp || {}) };

  const heartbeat = () => ctx.kv.get('whatsapp', 'heartbeat');
  const fresh = (h) => Boolean(h) && Date.now() - new Date(h.at).getTime() < 10 * 60 * 1000;
  // "online" means LINKED and receiving: a listener that is only showing a QR code is running but not connected.
  const online = () => { const h = heartbeat(); return fresh(h) && h.state === 'open'; };
  const pairUrl = (h) => `http://127.0.0.1:${(h && h.port) || cfg.pairing_port || 7899}/`;
  const unread = () => db.prepare(`SELECT m.chat_jid, c.name, c.is_group, c.vip, COUNT(*) n, MAX(m.ts) last_ts FROM wa_messages m JOIN wa_chats c ON c.jid = m.chat_jid WHERE m.read = 0 AND m.from_me = 0 AND c.muted = 0 GROUP BY m.chat_jid ORDER BY c.vip DESC, last_ts DESC`).all();
  const findChat = (q) => { const s = String(q || '').toLowerCase(); return db.prepare('SELECT * FROM wa_chats ORDER BY last_ts DESC').all().find((c) => (c.name || '').toLowerCase().includes(s)) || null; };
  const recent = (jid, n = 10) => db.prepare('SELECT * FROM wa_messages WHERE chat_jid = ? ORDER BY ts DESC LIMIT ?').all(jid, n).reverse();
  const ownerPhone = cfg.owner_phone || config.owner?.phone || 'your number';

  const notConnected = () => ({ speak: online() ? 'WhatsApp is connected but has nothing new.' : 'WhatsApp is not linked yet. On the Mac, run kitt whatsapp link and scan the code with WhatsApp, under Linked devices. Docs slash WHATSAPP dot M D explains the risk first.' });

  return {
    id: 'whatsapp', name: 'WhatsApp Assistant', aliases: ['wa'],
    description: `digest of your WhatsApp (${ownerPhone}), read-outs per contact, and reply drafts that you approve before anything is sent`,
    migrations: MIGRATIONS,
    intents: [
      { name: 'new', description: 'what is new on WhatsApp', examples: ["what's new on WhatsApp"], patterns: ["(what's|what is|whats) new on whatsapp", 'whatsapp (digest|summary|update|messages)', 'any (new )?whatsapp messages', 'who messaged me on whatsapp', 'check whatsapp'] },
      { name: 'read', description: 'read recent messages from a contact or group', examples: ['read messages from Rahul'], patterns: ['read (the )?(whatsapp )?(messages|chat) (from|with|in) {who}', 'what did {who} say on whatsapp', 'whatsapp from {who}'], slots: ['who'] },
      { name: 'summarise', description: 'summarise a group', examples: ['summarise the ops group'], patterns: ['summari[sz]e (the )?{who} (group|chat)', "(what's|what is) happening in (the )?{who} (group|chat)"], slots: ['who'] },
      { name: 'reply', description: 'draft a reply (you approve before it is sent)', examples: ['reply to Rahul: on my way'], patterns: ['reply to {who} (saying|with|that)?:? {text}', 'tell {who} (that )?{text}', 'message {who} (saying|that)?:? {text}'], slots: ['who', 'text'], write: true },
      { name: 'mark_read', description: 'mark all WhatsApp as read in KITT', examples: ['mark WhatsApp as read'], patterns: ['mark (all )?whatsapp (as )?read', 'clear (the )?whatsapp digest'], write: true },
    ],
    routines: [
      { name: 'whatsapp.retention', cron: '0 2 * * *', description: 'purge messages older than the retention window', run: async () => ({ summary: `${db.prepare('DELETE FROM wa_messages WHERE ts < datetime(\'now\', ?)').run(`-${cfg.retention_days} days`).changes} purged` }) },
      { name: 'whatsapp.heartbeat', cron: '*/30 7-21 * * *', description: 'alert if the listener has been silent for 30 minutes', catchUpMinutes: 0, run: async () => { const h = heartbeat(); if (!h) return { summary: 'listener never seen' }; const silent = Date.now() - new Date(h.at).getTime() > 30 * 60 * 1000; if (silent && !ctx.kv.get('whatsapp', 'alerted')) { ctx.kv.set('whatsapp', 'alerted', 1); return { summary: 'listener silent', notify: { push: { title: 'KITT: WhatsApp listener offline', body: `last heartbeat ${h.at}`, tags: 'warning' } } }; } if (!silent) ctx.kv.del('whatsapp', 'alerted'); return { summary: silent ? 'silent (already alerted)' : 'ok' }; } },
    ],
    async handle(intent, slots) {
      if (intent === 'new') { const u = unread(); if (!u.length) return notConnected(); const vip = u.filter((x) => x.vip); return { speak: `${plural(u.reduce((s, x) => s + x.n, 0), 'unread message')} in ${plural(u.length, 'chat')}${vip.length ? `. VIP: ${spokenList(vip.map((x) => `${x.name} ${x.n}`), { max: 4 })}` : ''}. Others: ${spokenList(u.filter((x) => !x.vip).map((x) => `${x.name || x.chat_jid} ${x.n}`), { max: 5 })}.`, display: u }; }
      if (intent === 'read') { const c = findChat(slots.who); if (!c) return online() ? { speak: `No chat matching ${slots.who}.` } : notConnected(); const msgs = recent(c.jid, 6).filter((m) => !m.from_me); ctx.kv.set('whatsapp', 'last_chat', c.jid); if (!msgs.length) return { speak: `Nothing recent from ${c.name}.` }; db.prepare('UPDATE wa_messages SET read = 1 WHERE chat_jid = ?').run(c.jid); return { speak: `${c.name}: ${spokenList(msgs.map((m) => `${c.is_group ? (m.sender_name || 'someone') + ' said ' : ''}${m.transcript || m.text || `a ${m.type || 'media'} message`}`), { max: 6 })}.`, display: msgs }; }
      if (intent === 'summarise') { const c = findChat(slots.who); if (!c) return notConnected(); const msgs = recent(c.jid, 40); if (!msgs.length) return { speak: `Nothing recent in ${c.name}.` }; try { const s = await brain.speak(`Summarise this WhatsApp ${c.is_group ? 'group' : 'chat'} "${c.name}" for a driver in at most 70 words: decisions, asks of Travis, anything urgent.\n${msgs.map((m) => `${m.sender_name || (m.from_me ? 'Travis' : 'them')}: ${m.transcript || m.text || `[${m.type}]`}`).join('\n').slice(0, 6000)}`, { maxWords: 70 }); db.prepare('UPDATE wa_messages SET read = 1 WHERE chat_jid = ?').run(c.jid); return { speak: s, display: msgs }; } catch { return { speak: `My language brain is unavailable; ${c.name} has ${plural(msgs.length, 'recent message')}.` }; } }
      if (intent === 'reply') { const c = findChat(slots.who) || (ctx.kv.get('whatsapp', 'last_chat') ? db.prepare('SELECT * FROM wa_chats WHERE jid = ?').get(ctx.kv.get('whatsapp', 'last_chat')) : null); if (!c) return { speak: `I can't find a chat for ${slots.who}.` }; const text = String(slots.text || '').trim(); if (!text) return { speak: 'What should the message say?' }; return { speak: `Queue a reply to ${c.name}: "${text}"? ${cfg.allow_send ? 'It will be sent by the listener after you confirm.' : 'It stays as a draft you send from your phone; automatic sending is off.'}`, confirm: { summary: `whatsapp draft to ${c.name}: ${text.slice(0, 60)}`, action: { type: 'reply', jid: c.jid, name: c.name, text } } }; }
      if (intent === 'mark_read') return { speak: 'Mark everything as read in my digest?', confirm: { summary: 'mark whatsapp read', action: { type: 'mark_read' } } };
      return { speak: "I didn't catch which WhatsApp action that was." };
    },
    async execute(action) {
      if (action.type === 'reply') { const status = cfg.allow_send ? 'approved' : 'draft'; db.prepare("INSERT INTO wa_outbox(chat_jid, chat_name, text, status, approved_at) VALUES (?, ?, ?, ?, CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END)").run(action.jid, action.name, action.text, status, status); return { speak: status === 'approved' ? `Queued for ${action.name}; the listener will send it with a natural delay.` : `Draft saved for ${action.name}. Open WhatsApp to send it; automatic sending is off.` }; }
      if (action.type === 'mark_read') { const n = db.prepare('UPDATE wa_messages SET read = 1 WHERE read = 0').run().changes; return { speak: `Marked ${plural(n, 'message')} read.` }; }
      return { speak: 'Unknown action.' };
    },
    async brief({ kind }) { if (!online()) return null; const u = unread(); if (!u.length) return null; const vip = u.filter((x) => x.vip); return { speak: `WhatsApp: ${plural(u.reduce((s, x) => s + x.n, 0), 'unread')} in ${plural(u.length, 'chat')}${vip.length ? `, VIP ${spokenList(vip.map((x) => x.name), { max: 3 })}` : ''}.${kind === 'morning' && db.prepare("SELECT count(*) n FROM wa_outbox WHERE status = 'draft'").get().n ? ' You have WhatsApp drafts waiting to be sent.' : ''}` }; },
    async view() { return { online: online(), state: (heartbeat() || {}).state || 'not_running', heartbeat: heartbeat(), allow_send: cfg.allow_send, unread: unread(), outbox: db.prepare('SELECT * FROM wa_outbox ORDER BY id DESC LIMIT 20').all() }; },
    async health() {
      const h = heartbeat();
      if (!h) return { ok: false, detail: 'listener not running. Start it with: kitt whatsapp link (see docs/WHATSAPP.md)' };
      if (!fresh(h)) return { ok: false, detail: `listener silent since ${h.at} (last state ${h.state || '?'}). Restart it: kitt whatsapp link` };
      if (h.state === 'qr_waiting') return { ok: false, detail: `listener running, waiting for the QR scan: open ${pairUrl(h)} and scan it in WhatsApp, Linked devices` };
      if (h.state !== 'open') return { ok: false, detail: `listener running but not connected (${h.state || 'starting'}); pairing page ${pairUrl(h)}` };
      return { ok: true, detail: `linked and receiving; last heartbeat ${h.at}; sending ${cfg.allow_send ? 'ENABLED' : 'off (drafts only)'}` };
    },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); const u = unread(); const ob = db.prepare('SELECT * FROM wa_outbox ORDER BY id DESC LIMIT 20').all(); return `<p>${esc((await this.health()).detail)}</p><h3>Unread by chat</h3><table><tr><th>Chat</th><th>VIP</th><th>Unread</th><th>Last</th></tr>${u.map((x) => `<tr><td>${esc(x.name || x.chat_jid)}</td><td>${x.vip ? 'yes' : ''}</td><td>${x.n}</td><td>${esc((x.last_ts || '').slice(0, 16))}</td></tr>`).join('')}</table><h3>Outbox (drafts and queued)</h3><table><tr><th>To</th><th>Text</th><th>Status</th><th>Created</th></tr>${ob.map((o) => `<tr><td>${esc(o.chat_name)}</td><td>${esc(o.text)}</td><td>${esc(o.status)}</td><td>${esc(o.created_at)}</td></tr>`).join('')}</table>`; },
  };
}
