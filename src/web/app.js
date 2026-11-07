// Serves the built web app (mockups/dist, Vite) under /app so every device on the LAN gets it from the hub over plain http,
// and answers CORS for the copy of the same app hosted elsewhere (Vercel), which talks to the hub cross-origin.
import fs from 'node:fs';
import path from 'node:path';
import { sendJson } from '../router.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};

/** Static files under `prefix`, with the single-page fallback to index.html. No token: the app asks for it itself. */
export function createWebApp({ dir, prefix = '/app' }) {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  function handle(req, res, url) {
    const p = url.pathname;
    if (p !== prefix && !p.startsWith(`${prefix}/`)) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return true; }
    if (p === prefix) { res.writeHead(302, { location: `${prefix}/` }); res.end(); return true; }
    if (!fs.existsSync(index)) { sendJson(res, 404, { error: 'web app not built', hint: 'cd mockups && npm install && npm run build' }); return true; }
    let rel = '';
    try { rel = decodeURIComponent(p.slice(prefix.length + 1)); } catch { rel = ''; }
    let file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) file = index;        // no escaping the folder
    let stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (!stat || stat.isDirectory()) { file = index; stat = fs.statSync(index); } // hash routes and unknown paths get the app
    const ext = path.extname(file).toLowerCase();
    const hashed = /[\\/]assets[\\/]/.test(file) || /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(file);
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': stat.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return { handle, root };
}

/** Allowed origins: the list from config (a `*` matches one label, e.g. preview deployments) plus anything on localhost. */
export function createCors(origins = []) {
  const patterns = origins.map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i'));
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const allows = (origin) => Boolean(origin) && (local.test(origin) || patterns.some((re) => re.test(origin)));
  /** Adds the headers for an allowed origin; answers a preflight itself and returns true when the request is finished. */
  function apply(req, res) {
    const origin = req.headers.origin;
    if (!allows(origin)) return false;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, range');
    res.setHeader('access-control-expose-headers', 'content-range, accept-ranges, content-length');
    res.setHeader('access-control-max-age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
    return false;
  }
  return { allows, apply };
}
