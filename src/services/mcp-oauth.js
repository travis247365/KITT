// Minimal MCP client for remote streamable-HTTP servers with OAuth 2.1 (dynamic client registration + PKCE).
// Verified against https://mcp.linktr.ee on 2026-10-26: protected-resource metadata, DCR endpoint, S256, refresh tokens.
import crypto from 'node:crypto';
import http from 'node:http';
import { log } from '../log.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function createMcpOAuthClient({ name, resourceUrl, kv, ns, clientName = 'KITT (personal agent)', redirectPort = 2001 }) {
  const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;

  async function discover() {
    const cached = kv.get(ns, 'metadata');
    if (cached && Date.now() - new Date(cached.at).getTime() < 7 * 86400000) return cached;
    const origin = new URL(resourceUrl).origin;
    const prm = await (await fetch(`${origin}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(15000) })).json();
    const asUrl = (prm.authorization_servers || [origin])[0].replace(/\/$/, '');
    const as = await (await fetch(`${asUrl}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(15000) })).json();
    const meta = { at: new Date().toISOString(), resource: prm.resource || resourceUrl, as };
    kv.set(ns, 'metadata', meta);
    return meta;
  }

  async function register(meta) {
    const existing = kv.get(ns, 'client');
    if (existing?.client_id) return existing;
    if (!meta.as.registration_endpoint) throw new Error(`${name}: no dynamic client registration; a client id must be obtained manually`);
    const r = await fetch(meta.as.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.client_id) throw new Error(`${name}: client registration failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const client = { client_id: j.client_id, client_secret: j.client_secret || null, at: new Date().toISOString() };
    kv.set(ns, 'client', client);
    return client;
  }

  /** Start the browser login. Resolves with the authorization URL; the local listener completes the exchange. */
  async function login({ open = true, timeoutMs = 10 * 60 * 1000 } = {}) {
    const meta = await discover(); const client = await register(meta);
    const verifier = b64u(crypto.randomBytes(48)); const challenge = b64u(crypto.createHash('sha256').update(verifier).digest()); const state = b64u(crypto.randomBytes(16));
    const u = new URL(meta.as.authorization_endpoint);
    u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', client.client_id); u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('code_challenge', challenge); u.searchParams.set('code_challenge_method', 'S256'); u.searchParams.set('state', state);
    u.searchParams.set('scope', 'offline_access'); u.searchParams.set('resource', meta.resource);
    const authUrl = u.toString();
    const done = new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, redirectUri);
        if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        try {
          if (url.searchParams.get('state') !== state) throw new Error('state mismatch');
          if (url.searchParams.get('error')) throw new Error(`${url.searchParams.get('error')}: ${url.searchParams.get('error_description') || ''}`);
          const code = url.searchParams.get('code'); if (!code) throw new Error('no code');
          const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: meta.resource });
          if (client.client_secret) body.set('client_secret', client.client_secret);
          const tr = await fetch(meta.as.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
          const tok = await tr.json().catch(() => ({}));
          if (!tr.ok || !tok.access_token) throw new Error(`token exchange failed: HTTP ${tr.status} ${JSON.stringify(tok).slice(0, 200)}`);
          saveTokens(tok);
          res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><body style="font-family:Poppins,Arial;padding:40px"><h2>KITT connected to ${name}.</h2><p>You can close this tab.</p></body></html>`);
          server.close(); resolve(true);
        } catch (e) { res.writeHead(400, { 'content-type': 'text/plain' }); res.end(`Login failed: ${e.message}`); server.close(); reject(e); }
      });
      server.listen(redirectPort, '127.0.0.1');
      setTimeout(() => { try { server.close(); } catch { /* ignore */ } reject(new Error('login timed out')); }, timeoutMs).unref();
    });
    if (open) { const { spawn } = await import('node:child_process'); spawn('/usr/bin/open', [authUrl], { stdio: 'ignore' }).unref(); }
    return { authUrl, done };
  }

  function saveTokens(tok) {
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000).toISOString();
    const prev = kv.get(ns, 'tokens') || {};
    kv.set(ns, 'tokens', { access_token: tok.access_token, refresh_token: tok.refresh_token || prev.refresh_token || null, expires_at: expiresAt, token_type: tok.token_type || 'Bearer', at: new Date().toISOString() });
  }

  async function accessToken() {
    const t = kv.get(ns, 'tokens');
    if (!t?.access_token) throw Object.assign(new Error(`${name} is not connected — run: kitt ${ns} login`), { needsLogin: true });
    if (new Date(t.expires_at).getTime() > Date.now()) return t.access_token;
    if (!t.refresh_token) throw Object.assign(new Error(`${name} token expired and no refresh token — run: kitt ${ns} login`), { needsLogin: true });
    const meta = await discover(); const client = await register(meta);
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id, resource: meta.resource });
    if (client.client_secret) body.set('client_secret', client.client_secret);
    const r = await fetch(meta.as.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) { kv.del(ns, 'tokens'); throw Object.assign(new Error(`${name} refresh failed (HTTP ${r.status}); run: kitt ${ns} login`), { needsLogin: true }); }
    saveTokens(tok);
    return tok.access_token;
  }

  // ---- JSON-RPC over streamable HTTP ----
  let sessionId = null; let nextId = 1;
  async function rpc(method, params, { timeoutMs = 45000 } = {}) {
    const token = await accessToken();
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const id = nextId++;
    const r = await fetch(resourceUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }), signal: AbortSignal.timeout(timeoutMs) });
    if (r.headers.get('mcp-session-id')) sessionId = r.headers.get('mcp-session-id');
    if (r.status === 401) { kv.set(ns, 'tokens', { ...(kv.get(ns, 'tokens') || {}), expires_at: new Date(0).toISOString() }); throw Object.assign(new Error(`${name}: unauthorized`), { needsLogin: !kv.get(ns, 'tokens')?.refresh_token }); }
    const ct = r.headers.get('content-type') || '';
    let msg = null;
    if (ct.includes('text/event-stream')) {
      const text = await r.text();
      for (const chunk of text.split(/\n\n/)) { const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'); if (!data) continue; try { const j = JSON.parse(data); if (j.id === id) { msg = j; break; } } catch { /* ignore */ } }
    } else if (ct.includes('application/json')) msg = await r.json();
    else { const t = await r.text(); throw new Error(`${name}: unexpected response ${r.status} ${ct}: ${t.slice(0, 200)}`); }
    if (!msg) throw new Error(`${name}: no JSON-RPC response for ${method} (HTTP ${r.status})`);
    if (msg.error) throw new Error(`${name} ${method}: ${msg.error.message || JSON.stringify(msg.error).slice(0, 200)}`);
    return msg.result;
  }

  async function initialize() {
    const res = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kitt', version: '0.1.0' } });
    // notifications/initialized is fire-and-forget
    try { const token = await accessToken(); const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }; if (sessionId) headers['mcp-session-id'] = sessionId; await fetch(resourceUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: AbortSignal.timeout(10000) }); } catch { /* ignore */ }
    return res;
  }

  let initialized = false;
  async function callTool(toolName, args = {}) {
    if (!initialized) { await initialize(); initialized = true; }
    const res = await rpc('tools/call', { name: toolName, arguments: args });
    if (res?.isError) throw new Error(`${name}.${toolName}: ${(res.content || []).map((c) => c.text || '').join(' ').slice(0, 300)}`);
    const text = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* text result */ }
    return { text, data: res?.structuredContent ?? parsed, raw: res };
  }

  async function listTools() { if (!initialized) { await initialize(); initialized = true; } return rpc('tools/list', {}); }

  function status() { const t = kv.get(ns, 'tokens'); const c = kv.get(ns, 'client'); return { connected: Boolean(t?.access_token), expires_at: t?.expires_at || null, has_refresh: Boolean(t?.refresh_token), client_registered: Boolean(c?.client_id) }; }

  return { discover, register, login, accessToken, callTool, listTools, status, redirectUri };
}
