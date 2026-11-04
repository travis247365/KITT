// HTTP front door for Siri Shortcuts, the podcast feed, the dashboard and skill routes. Binds 127.0.0.1 only; a tunnel fronts it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { createRouter, dispatch, readJson, sendJson, send, HttpError } from './router.js';
import { tokenTable, identify, extractToken, createRateLimiter, requireScope, isForwarded } from './auth.js';
import { tailAudit } from './audit.js';
import { listPending } from './confirm.js';
import { log } from './log.js';
import { renderDashboard } from './web/dashboard.js';
import { renderTV } from './web/tv.js';

export async function startServer({ port, host } = {}) {
  const app = await createApp();
  const { config, secrets, paths } = app;
  const tokens = tokenTable(secrets);
  if (!tokens.length) log.warn('NO KITT_TOKEN configured — every protected route will 401. Run: kitt token new');
  const limiter = createRateLimiter({ perMinute: config.rate_limit?.per_minute || 60, burst: config.rate_limit?.burst || 20 });
  const podcast = app.podcast;
  const router = createRouter();
  const started = Date.now();

  router.get('/healthz', () => ({ ok: true, version: app.version, uptime_s: Math.round((Date.now() - started) / 1000) }));
  router.get('/v1/health', async (c) => { requireScope(c.identity, 'read'); return app.health(); });
  router.post('/v1/ask', async (c) => { requireScope(c.identity, 'read'); const b = await readJson(c.req); if (!b.text) throw new HttpError(400, 'text required'); return app.ask(String(b.text).slice(0, 2000), { source: b.source || 'siri' }); });
  router.get('/v1/brief/:name', async (c) => { requireScope(c.identity, 'read'); return app.brief(c.params.name, { source: c.url.searchParams.get('source') || 'siri' }); });
  router.post('/v1/confirm', async (c) => { requireScope(c.identity, 'write'); const b = await readJson(c.req); const r = await app.confirm(b.source || 'siri', b.code); if (r.stale) throw new HttpError(409, r.speak); return app.finish(b.source || 'siri', r.speak); });
  router.post('/v1/cancel', async (c) => { requireScope(c.identity, 'write'); const b = await readJson(c.req); const r = app.cancel(b.source || 'siri', b.code); if (r.stale) throw new HttpError(409, r.speak); return app.finish(b.source || 'siri', r.speak); });
  router.get('/v1/more', async (c) => { requireScope(c.identity, 'read'); const src = c.url.searchParams.get('source') || 'siri'; return app.finish(src, app.more(src).speak); });
  router.post('/v1/idea', async (c) => { requireScope(c.identity, 'write'); const b = await readJson(c.req); const s = app.skills.ideas; if (!s) throw new HttpError(503, 'ideas skill unavailable'); return app.finish(b.source || 'siri', (await s.capture(b, { ...app, source: b.source || 'siri' })).speak); });
  router.post('/v1/sms', async (c) => { requireScope(c.identity, 'write'); const b = await readJson(c.req); const s = app.skills.money; if (!s) throw new HttpError(503, 'money skill unavailable'); return s.ingestSms(b, { ...app, source: 'ios-automation' }); });
  router.get('/v1/skills', (c) => { requireScope(c.identity, 'read'); return { skills: app.skillList.map((s) => ({ id: s.id, name: s.name, description: s.description, intents: s.intents.map((i) => ({ name: i.name, examples: i.examples || [], write: Boolean(i.write) })), routines: (s.routines || []).map((r) => ({ name: r.name, cron: r.cron })) })), unavailable: app.failures }; });
  router.get('/v1/routines', (c) => { requireScope(c.identity, 'read'); return { routines: app.scheduler.list() }; });
  router.post('/v1/routines/:name/run', async (c) => { requireScope(c.identity, 'admin'); return app.scheduler.runNow(c.params.name, { source: 'api' }); });
  router.get('/v1/audit', (c) => { requireScope(c.identity, 'admin'); return { audit: tailAudit(app.db, Number(c.url.searchParams.get('limit') || 50)) }; });
  router.get('/v1/pending', (c) => { requireScope(c.identity, 'read'); return { pending: listPending(app.db) }; });
  router.get('/v1/state', async (c) => { requireScope(c.identity, 'read'); return app.state(); });
  router.get('/v1/events', (c) => { requireScope(c.identity, 'read'); return app.events(c.url.searchParams.get('since') || 0, Number(c.url.searchParams.get('limit') || 100), c.url.searchParams.get('latest') || 0); });
  router.get('/v1/skills/:id/view', async (c) => { requireScope(c.identity, 'read'); const s = app.skills[c.params.id]; if (!s) throw new HttpError(404, 'unknown skill'); const view = typeof s.view === 'function' ? await s.view({ ...app, source: 'api' }) : {}; const health = typeof s.health === 'function' ? await s.health(app) : { ok: true }; return { id: s.id, name: s.name, description: s.description, health, intents: s.intents.map((i) => ({ name: i.name, examples: i.examples || [], write: Boolean(i.write) })), routines: (s.routines || []).map((r) => ({ name: r.name, cron: r.cron, description: r.description })), view }; });

  // Podcast feed: Apple Podcasts cannot send headers, so the feed token lives in the path.
  router.get('/feed/:token/kitt.xml', (c) => { const id = identify(tokens, c.params.token); if (!id || !id.scopes.includes('feed')) throw new HttpError(404, 'not found'); send(c.res, 200, podcast.rss(`${publicBase(c)}/feed/${c.params.token}`), 'application/rss+xml; charset=utf-8'); });
  // One audio server for both doors: the podcast feed (token in the path) and the apps (bearer token): seekable, with Range support.
  function serveAudio(c, name) {
    const safe = path.basename(name); const file = path.join(paths.audioDir, safe);
    if (!/^[\w.-]+\.(m4a|mp3)$/.test(safe) || !fs.existsSync(file)) throw new HttpError(404, 'not found');
    const stat = fs.statSync(file); const type = safe.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4';
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.headers.range || '');
    if (range) { // seekable playback for Podcasts and the app player
      let start = range[1] ? Number(range[1]) : 0; let end = range[2] ? Number(range[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) { c.res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); c.res.end(); return; }
      end = Math.min(end, stat.size - 1);
      c.res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' });
      fs.createReadStream(file, { start, end }).pipe(c.res); return;
    }
    c.res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' });
    fs.createReadStream(file).pipe(c.res);
  }
  router.get('/feed/:token/audio/:file', (c) => {
    const id = identify(tokens, c.params.token); if (!id || !id.scopes.includes('feed')) throw new HttpError(404, 'not found');
    serveAudio(c, c.params.file);
  });
  // For the apps (CarPlay audio, the phone): the brief episodes and their audio under the app token.
  router.get('/v1/episodes', (c) => { requireScope(c.identity, 'read'); return { episodes: podcast.list() }; });
  router.get('/v1/audio/:file', (c) => { requireScope(c.identity, 'read'); serveAudio(c, c.params.file); });

  router.get('/dashboard', async (c) => { requireScope(c.identity, 'read'); const html = await renderDashboard(app); const headers = {}; const q = c.url.searchParams.get('token'); if (q && !isForwarded(c.req)) headers['set-cookie'] = `kitt_token=${encodeURIComponent(q)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${c.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`; send(c.res, 200, html, 'text/html; charset=utf-8', headers); });
  // Always-on big-screen view: a TV (via the lgtv-vibehack /kitt proxy) or a propped-up laptop in Chrome.
  // Cheap on purpose — reads app.state() only, no live skill panels — so it's safe to refresh every 60s forever.
  router.get('/tv', async (c) => { requireScope(c.identity, 'read'); const html = await renderTV(app); const headers = {}; const q = c.url.searchParams.get('token'); if (q && !isForwarded(c.req)) headers['set-cookie'] = `kitt_token=${encodeURIComponent(q)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${c.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`; send(c.res, 200, html, 'text/html; charset=utf-8', headers); });
  router.get('/', (c) => { c.res.writeHead(302, { location: '/dashboard' }); c.res.end(); });

  for (const s of app.skillList) for (const r of s.routes || []) {
    const fn = async (c) => { requireScope(c.identity, r.scope || 'read'); const body = c.req.method === 'GET' ? {} : await readJson(c.req); return r.handler({ ...app, source: 'api', params: c.params, query: Object.fromEntries(c.url.searchParams), body, req: c.req, res: c.res }); };
    router[r.method.toLowerCase()](`/v1/${s.id}${r.path}`, fn);
  }

  function publicBase(c) { return config.server?.public_base_url || `${c.req.headers['x-forwarded-proto'] || 'http'}://${c.req.headers['x-forwarded-host'] || c.req.headers.host}`; }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://kitt.local');
    const presented = extractToken(req, url);
    const identity = identify(tokens, presented);
    const key = identity ? `t:${identity.name}` : `ip:${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`;
    if (!limiter(key)) return sendJson(res, 429, { error: 'rate limited' });
    if (presented && !identity && url.pathname !== '/healthz') log.warn('bad token presented', { path: url.pathname, ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress });
    dispatch(router, req, res, ({ params, route }) => ({ req, res, url, params, route, identity, app }));
  });
  server.keepAliveTimeout = 5000;
  const p = port || config.server?.port || 2000; const h = host || config.server?.host || '127.0.0.1';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, h, resolve); });
  log.info('kitt listening', { host: h, port: p, version: app.version, skills: app.skillList.map((s) => s.id), unavailable: app.failures.map((f) => f.id) });
  app.scheduler.start();
  const shutdown = (sig) => { log.info('shutting down', { sig }); app.scheduler.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
  return { server, app, port: p, host: h, podcast };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) startServer().catch((e) => { log.error('server failed to start', { err: e.message, stack: e.stack }); process.exit(1); });
