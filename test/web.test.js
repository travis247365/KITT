import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The hub serves the built web app under /app (single-page fallback, immutable assets) and answers CORS for the hosted copy.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-web-'));
process.env.KITT_CONFIG_DIR = path.join(tmp, 'cfg'); process.env.KITT_DATA_DIR = path.join(tmp, 'data');
const webDir = path.join(tmp, 'dist');
fs.mkdirSync(process.env.KITT_CONFIG_DIR, { recursive: true });
fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./assets/app-abcd1234.js"></script></body></html>');
fs.writeFileSync(path.join(webDir, 'assets', 'app-abcd1234.js'), 'console.log("kitt")');
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.env'), 'KITT_TOKEN=testtoken-testtoken-testtoken-0002\n');
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.json'), JSON.stringify({ server: { port: 2997, web_dir: webDir, web_origins: ['https://example-app.test', 'https://preview-*.example-app.test'] }, skills: { enabled: ['ideas'] }, brain: { provider: 'cli' } }));

test('hub serves the web app under /app and answers CORS for its hosted origins', async () => {
  const { startServer } = await import('../src/server.js');
  const srv = await startServer({ port: 2997 });
  const base = 'http://127.0.0.1:2997';
  try {
    const r1 = await fetch(`${base}/app`, { redirect: 'manual' });
    assert.equal(r1.status, 302); assert.equal(r1.headers.get('location'), '/app/');
    const r2 = await fetch(`${base}/app/`);
    assert.equal(r2.status, 200); assert.match(r2.headers.get('content-type'), /text\/html/); assert.match(await r2.text(), /id="root"/);
    assert.equal(r2.headers.get('cache-control'), 'no-cache');
    const r3 = await fetch(`${base}/app/assets/app-abcd1234.js`);
    assert.equal(r3.status, 200); assert.match(r3.headers.get('content-type'), /javascript/); assert.match(r3.headers.get('cache-control'), /immutable/);
    const r4 = await fetch(`${base}/app/skills/money`);   // a deep link: the app, not a 404
    assert.equal(r4.status, 200); assert.match(r4.headers.get('content-type'), /text\/html/);
    const r5 = await fetch(`${base}/app/..%2Fkitt.json`); // cannot climb out of the folder
    assert.equal(r5.status, 200); assert.match(r5.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(`${base}/app/`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/v1/state`)).status, 401, 'the API behind it still wants the token');

    const pre = await fetch(`${base}/v1/state`, { method: 'OPTIONS', headers: { origin: 'https://example-app.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://example-app.test');
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    const preview = await fetch(`${base}/healthz`, { headers: { origin: 'https://preview-a1b2c3-x.example-app.test' } });
    assert.equal(preview.headers.get('access-control-allow-origin'), 'https://preview-a1b2c3-x.example-app.test', 'a * matches one label of a preview deployment');
    const local = await fetch(`${base}/healthz`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const evil = await fetch(`${base}/healthz`, { headers: { origin: 'https://evil.test' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal(evil.status, 200, 'an unknown origin is simply not granted CORS; the route itself still answers');
  } finally {
    srv.app.scheduler.stop(); await new Promise((r) => srv.server.close(r));
  }
});
