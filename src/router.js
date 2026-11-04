// Minimal HTTP router: method + path patterns with :params, JSON bodies (size-capped), JSON responses.
import { log } from './log.js';

const MAX_BODY = 256 * 1024;

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/+$/, '').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => { routes.push({ method, pattern, handler, opts, ...compile(pattern) }); };
  return {
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    routes,
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
      return null;
    },
  };
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON body'); }
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}

export function send(res, status, body, contentType, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-type': contentType, 'content-length': buf.length, 'x-content-type-options': 'nosniff', ...headers });
  res.end(buf);
}

/** Wrap a handler so thrown HttpErrors/other errors become JSON responses. */
export async function dispatch(router, req, res, ctxFactory) {
  const started = Date.now();
  const url = new URL(req.url, 'http://kitt.local');
  const found = router.match(req.method, url.pathname);
  if (!found) return sendJson(res, 404, { error: 'not found' });
  try {
    const ctx = await ctxFactory({ req, res, url, params: found.params, route: found.route });
    const out = await found.route.handler(ctx);
    if (res.writableEnded || res.headersSent) return;   // a streamed answer (audio) has already started
    if (out === undefined) return sendJson(res, 204, {});
    return sendJson(res, 200, out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) log.error('route error', { path: url.pathname, err: e.message, stack: e.stack?.split('\n').slice(0, 4).join(' | ') });
    else log.warn('route rejected', { path: url.pathname, status, err: e.message });
    if (!res.writableEnded && !res.headersSent) sendJson(res, status, { error: e.message, ...(e.extra || {}) });
  } finally {
    log.debug('http', { m: req.method, p: url.pathname, ms: Date.now() - started, status: res.statusCode });
  }
}
