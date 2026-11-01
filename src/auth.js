// Bearer-token auth with scopes, constant-time compare, and a per-client token bucket.
import crypto from 'node:crypto';
import { HttpError } from './router.js';

export const SCOPES = {
  full: ['read', 'write', 'admin', 'feed'],   // Mac-side CLI/dashboard only — never on a phone
  app: ['read', 'write', 'feed'],              // iPhone/iPad/Watch/Shortcuts: can ask and confirm, cannot run routines, read audit or import files
  read: ['read', 'feed'],
  feed: ['feed'],
};

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

/** Build the token table from secrets: KITT_TOKEN (full), KITT_READ_TOKEN (read), KITT_FEED_TOKEN (feed). */
export function tokenTable(secrets) {
  const t = [];
  if (secrets.KITT_TOKEN) t.push({ name: 'full', token: secrets.KITT_TOKEN, scopes: SCOPES.full });
  if (secrets.KITT_APP_TOKEN) t.push({ name: 'app', token: secrets.KITT_APP_TOKEN, scopes: SCOPES.app });
  if (secrets.KITT_READ_TOKEN) t.push({ name: 'read', token: secrets.KITT_READ_TOKEN, scopes: SCOPES.read });
  if (secrets.KITT_FEED_TOKEN) t.push({ name: 'feed', token: secrets.KITT_FEED_TOKEN, scopes: SCOPES.feed });
  return t;
}

export function identify(table, presented) {
  if (!presented || presented.length < 16) return null;
  for (const row of table) if (safeEqual(row.token, presented)) return row;
  return null;
}

/** A request that came through a tunnel/proxy carries X-Forwarded-* headers; tokens may then travel ONLY in the Authorization header. */
export function isForwarded(req) { return Boolean(req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']); }

export function extractToken(req, url) {
  const h = req.headers.authorization || '';
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  if (isForwarded(req)) return null; // never accept URL or cookie tokens over the public path (they end up in proxy logs)
  const q = url.searchParams.get('token');
  if (q) return q;
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('kitt_token='));
  if (c) return decodeURIComponent(c.slice('kitt_token='.length));
  return null;
}

/** Token bucket per key (token name or IP). */
export function createRateLimiter({ perMinute = 60, burst = 20 } = {}) {
  const buckets = new Map();
  return function take(key) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: burst, ts: now }; buckets.set(key, b); }
    b.tokens = Math.min(burst, b.tokens + ((now - b.ts) / 60000) * perMinute);
    b.ts = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

export function requireScope(identity, scope) {
  if (!identity) throw new HttpError(401, 'unauthorized');
  if (!identity.scopes.includes(scope)) throw new HttpError(403, `scope ${scope} required`);
}

export function newToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
