#!/usr/bin/env node
// KITT WhatsApp listener: a LINKED DEVICE on Travis's personal number via @whiskeysockets/baileys (an unofficial client;
// docs/WHATSAPP.md has the risk statement and the decision). Start it with `kitt whatsapp link` (foreground, opens the pairing page)
// or under launchd once paired. First run serves a pairing page on http://127.0.0.1:<whatsapp.pairing_port> (default 7899, loopback only)
// that shows the live QR; scan it in WhatsApp > Settings > Linked devices > Link a device. After that it stores messages in KITT's
// SQLite store, keeps a heartbeat, and sends ONLY outbox rows with status 'approved' (which exist only when whatsapp.allow_send is true).
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { loadConfig } from '../../config.js';
import { openDb, migrateCore, kv } from '../../db.js';
import { log } from '../../log.js';

const { config, paths } = loadConfig();
const db = openDb(paths.dbFile); migrateCore(db);
const vips = (config.whatsapp?.vips || []).map((v) => String(v).toLowerCase());
const allowSend = Boolean(config.whatsapp?.allow_send);
const PORT = Number(config.whatsapp?.pairing_port || 7899);
const authDir = path.join(paths.configDir, 'whatsapp-auth');
fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
const OPEN_BROWSER = process.argv.includes('--open');

let baileys; let QR;
try { baileys = await import('@whiskeysockets/baileys'); QR = (await import('qrcode')).default; }
catch { console.error('Missing dependencies. Run: cd ~/dev/kitt && npm install --ignore-scripts'); process.exit(2); }
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;

// ---- live state shown on the pairing page and in the heartbeat ----
const S = { status: 'starting', qr: null, qrId: 0, linkedAs: null, startedAt: new Date().toISOString() };
let sock = null; let shuttingDown = false; let openedBrowser = false;
const beat = (state) => { try { kv.set(db, 'whatsapp', 'heartbeat', { at: new Date().toISOString(), state, pid: process.pid, port: PORT }); } catch (e) { log.warn('wa heartbeat failed', { err: e.message }); } };

// ---- pairing page: loopback only, Host header checked, no external requests ----
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link WhatsApp to KITT</title>
<style>:root{color-scheme:light dark;--bg:#fff;--ink:#3a3a3a;--muted:#6e6e6e;--card:#f5f6f8;--accent:#ffc107}@media(prefers-color-scheme:dark){:root{--bg:#3a3a3a;--ink:#fff;--muted:#bcbcbc;--card:#2b2b2b;--accent:#00bcd4}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 'Poppins','Century Gothic',Futura,-apple-system,'Segoe UI',sans-serif}main{max-width:520px;margin:0 auto;padding:40px 20px}
.bar{width:56px;height:20px;background:var(--accent);margin-bottom:16px}h1{font-size:28px;line-height:1.15;margin:0 0 8px;font-weight:700}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
.qr{background:#fff;padding:12px;width:fit-content;margin:16px 0}.qr img{display:block;width:280px;height:280px}.state{background:var(--card);padding:12px 14px;margin:16px 0;font-weight:500}
ol{padding-left:20px;margin:0 0 16px}li{margin:4px 0}.risk{border:2px solid var(--ink);padding:12px 14px;font-size:14px}</style></head><body><main>
<div class="bar"></div><h1>Link WhatsApp to KITT</h1><p class="muted">One scan. KITT becomes a linked device, like WhatsApp Web.</p>
<div class="state" id="state" role="status" aria-live="polite">Starting…</div>
<div class="qr" id="qrbox" hidden><img id="qr" alt="WhatsApp pairing QR code" src=""></div>
<ol><li>On your phone open WhatsApp, then Settings, then Linked devices.</li><li>Tap Link a device and scan the code above.</li><li>This page turns green when KITT is connected. The code refreshes about every 20 seconds.</li></ol>
<p class="risk"><b>Before you scan:</b> this is an unofficial client. WhatsApp's terms prohibit third-party clients and a number can be banned. Back up WhatsApp to iCloud first. KITT reads and drafts only; sending stays off unless you turn it on in kitt.json.</p>
<script>
const $=id=>document.getElementById(id);let last=-1;
const TEXT={starting:'Starting the listener…',connecting:'Connecting to WhatsApp…',qr:'Waiting for you to scan the code.',open:'Connected. You can close this page.',closed:'Disconnected. Reconnecting…',logged_out:'This device was unlinked on the phone. A new code will appear.'};
async function tick(){try{const r=await fetch('/state.json',{cache:'no-store'});const s=await r.json();
$('state').textContent=(TEXT[s.status]||s.status)+(s.status==='open'&&s.linkedAs?' Linked as +'+s.linkedAs+'.':'');
$('qrbox').hidden=!s.hasQr;if(s.hasQr&&s.qrId!==last){last=s.qrId;$('qr').src='/qr.svg?id='+s.qrId;}}catch(e){$('state').textContent='The listener is not answering. Is it still running?';}}
tick();setInterval(tick,2000);
</script></main></body></html>`;

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return; }
  const base = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/state.json') { res.writeHead(200, { ...base, 'content-type': 'application/json' }); res.end(JSON.stringify({ status: S.status, hasQr: Boolean(S.qr), qrId: S.qrId, linkedAs: S.status === 'open' ? S.linkedAs : null })); return; }
  if (url.pathname === '/qr.svg') {
    if (!S.qr) { res.writeHead(404, base); res.end(); return; }
    const svg = await QR.toString(S.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
    res.writeHead(200, { ...base, 'content-type': 'image/svg+xml' }); res.end(svg); return;
  }
  if (url.pathname === '/') { res.writeHead(200, { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; connect-src 'self'" }); res.end(PAGE); return; }
  res.writeHead(404, base); res.end();
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is already in use: another KITT WhatsApp listener is probably running (open http://127.0.0.1:${PORT}/). Not starting a second one.`); process.exit(3); }
  log.error('wa pairing server failed', { err: e.message }); process.exit(1);
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log(`KITT WhatsApp pairing page: http://127.0.0.1:${PORT}/`);

// ---- storage ----
const upChat = db.prepare("INSERT INTO wa_chats(jid, name, is_group, vip, last_ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), wa_chats.name), last_ts = MAX(COALESCE(wa_chats.last_ts, ''), excluded.last_ts), vip = MAX(wa_chats.vip, excluded.vip)");
const upMsg = db.prepare('INSERT OR IGNORE INTO wa_messages(id, chat_jid, sender, sender_name, ts, type, text, from_me, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

function textOf(m) { const c = m.message || {}; return c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption || c.videoMessage?.caption || c.documentMessage?.caption || null; }
function typeOf(m) { const c = m.message || {}; return c.audioMessage ? (c.audioMessage.ptt ? 'voice' : 'audio') : c.imageMessage ? 'image' : c.videoMessage ? 'video' : c.documentMessage ? 'document' : c.stickerMessage ? 'sticker' : 'text'; }

const groupNames = new Map();
async function groupName(jid) {
  if (groupNames.has(jid)) return groupNames.get(jid);
  try { const meta = await sock.groupMetadata(jid); groupNames.set(jid, meta.subject || ''); return meta.subject || ''; } catch { return ''; }
}

const quiet = { level: 'silent', child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function archiveAuth() {
  // never delete: a logged-out credential set is renamed, then a clean directory is created so a fresh QR can appear
  try { fs.renameSync(authDir, `${authDir}.loggedout-${new Date().toISOString().replace(/[:.]/g, '-')}`); } catch (e) { log.warn('wa archive auth failed', { err: e.message }); }
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
}

async function start() {
  if (shuttingDown) return;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const mine = makeWASocket({ auth: state, version, browser: Browsers.macOS('Desktop'), logger: quiet, syncFullHistory: false, markOnlineOnConnect: false, generateHighQualityLinkPreview: false });
  sock = mine;
  mine.ev.on('creds.update', saveCreds);
  mine.ev.on('connection.update', (u) => {
    if (mine !== sock) return;
    if (u.qr) {
      S.qr = u.qr; S.qrId += 1; S.status = 'qr'; beat('qr_waiting');
      if (OPEN_BROWSER && !openedBrowser) { openedBrowser = true; execFile('open', [`http://127.0.0.1:${PORT}/`], () => {}); }
    }
    if (u.connection === 'connecting' && S.status !== 'qr') { S.status = 'connecting'; beat('connecting'); }
    if (u.connection === 'open') { S.status = 'open'; S.qr = null; S.linkedAs = String(mine.user?.id || '').split(':')[0].split('@')[0] || null; beat('open'); log.info('wa connected'); }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      S.qr = null;
      if (shuttingDown) return;
      log.warn('wa closed', { code });
      if (code === DisconnectReason.loggedOut) { S.status = 'logged_out'; beat('logged_out'); archiveAuth(); setTimeout(start, 3000); return; }
      S.status = 'closed'; beat('closed');
      const paired = Boolean(state.creds?.me?.id); // 'registered' stays false for a linked device; 'me' is set once linked
      setTimeout(start, code === DisconnectReason.restartRequired ? 1000 : paired ? 5000 : 20000);
    }
  });
  mine.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      try {
        const jid = m.key.remoteJid; if (!jid || jid === 'status@broadcast') continue;
        const body = textOf(m); const kind = typeOf(m);
        if (!m.message || (kind === 'text' && !body)) continue; // reactions, protocol and key-exchange messages
        const isGroup = jid.endsWith('@g.us');
        const ts = new Date((Number(m.messageTimestamp) || Date.now() / 1000) * 1000).toISOString();
        // pushName is the SENDER's display name: never use it to name a chat when the message is mine
        const chatName = isGroup ? (await groupName(jid) || '') : (m.key.fromMe ? '' : (m.pushName || ''));
        const vipHit = vips.some((v) => chatName.toLowerCase().includes(v) || jid.includes(v.replace(/\D/g, ''))) ? 1 : 0;
        upChat.run(jid, chatName || jid.replace(/@.*/, ''), isGroup ? 1 : 0, vipHit, ts);
        // history pushed right after linking ('append') and my own messages are stored as already read, so the digest starts clean
        upMsg.run(m.key.id, jid, m.key.participant || jid, m.key.fromMe ? '' : (m.pushName || ''), ts, kind, body, m.key.fromMe ? 1 : 0, type === 'notify' && !m.key.fromMe ? 0 : 1);
      } catch (e) { log.warn('wa store failed', { err: e.message }); }
    }
    if (S.status === 'open') beat('open');
  });
}

// approved outbox -> send with a human-cadence delay (3-8 s), max 20/day, one per 30 s. Defined ONCE (not per reconnect).
setInterval(async () => {
  if (!allowSend || S.status !== 'open' || !sock) return;
  const today = db.prepare("SELECT count(*) n FROM wa_outbox WHERE status = 'sent' AND sent_at >= date('now')").get().n; if (today >= 20) return;
  const row = db.prepare("SELECT * FROM wa_outbox WHERE status = 'approved' ORDER BY id LIMIT 1").get(); if (!row) return;
  try { await new Promise((r) => setTimeout(r, 3000 + Math.random() * 5000)); await sock.sendMessage(row.chat_jid, { text: row.text }); db.prepare("UPDATE wa_outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(row.id); log.info('wa sent'); }
  catch (e) { db.prepare("UPDATE wa_outbox SET status = 'failed', error = ? WHERE id = ?").run(String(e.message).slice(0, 200), row.id); }
}, 30000);
setInterval(() => beat(S.status === 'open' ? 'open' : S.status === 'qr' ? 'qr_waiting' : S.status), 60000);

function stop(sig) {
  if (shuttingDown) return; shuttingDown = true; beat('stopped'); log.info('wa listener stopping', { sig });
  try { sock?.end(undefined); } catch { /* closing anyway */ }
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(sig));
process.on('unhandledRejection', (e) => log.warn('wa unhandled rejection', { err: String(e?.message || e).slice(0, 200) }));
process.on('uncaughtException', (e) => { log.error('wa uncaught exception', { err: String(e?.message || e).slice(0, 200) }); process.exit(1); });

beat('starting');
start().catch((e) => { log.error('wa listener failed', { err: e.message }); process.exit(1); });
