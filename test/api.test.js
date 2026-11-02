import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// End-to-end over HTTP with an isolated config/data dir and only offline-safe skills loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-api-'));
process.env.KITT_CONFIG_DIR = path.join(tmp, 'cfg'); process.env.KITT_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.KITT_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.env'), 'KITT_TOKEN=testtoken-testtoken-testtoken-0001\nKITT_FEED_TOKEN=feedtoken-feedtoken-feedtoken-0001\n');
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.json'), JSON.stringify({ server: { port: 2999 }, skills: { enabled: ['money', 'ideas', 'shoplog'] }, brain: { provider: 'cli' } }));

test('hub HTTP contract: auth, ask, confirm, sms, state, events, view, feed', async () => {
  const { startServer } = await import('../src/server.js');
  const srv = await startServer({ port: 2999 });
  const H = { Authorization: 'Bearer testtoken-testtoken-testtoken-0001', 'content-type': 'application/json' };
  const base = 'http://127.0.0.1:2999';
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/v1/state`)).status, 401);
    const ask = await (await fetch(`${base}/v1/ask`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Kit, log cash 50 parking', source: 'siri' }) })).json();
    assert.equal(ask.needs_confirm, true); assert.equal(ask.intent, 'money.log_cash');
    const conf = await (await fetch(`${base}/v1/confirm`, { method: 'POST', headers: H, body: JSON.stringify({ source: 'siri' }) })).json();
    assert.match(conf.speak, /Logged 50 kwacha cash for parking/);
    // a screen that shows a decision sends the code it showed; a different pending action is refused (409) and nothing runs
    await fetch(`${base}/v1/ask`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Kit, log cash 60 taxi', source: 'tv' }) });
    const waiting = (await (await fetch(`${base}/v1/state`, { headers: H })).json()).pending;
    assert.equal(waiting.length, 1);
    const wrong = await fetch(`${base}/v1/confirm`, { method: 'POST', headers: H, body: JSON.stringify({ source: 'tv', code: waiting[0].code === '10' ? '11' : '10' }) });
    assert.equal(wrong.status, 409);
    assert.equal((await (await fetch(`${base}/v1/state`, { headers: H })).json()).pending.length, 1, 'a refused confirm leaves the action pending');
    const right = await (await fetch(`${base}/v1/confirm`, { method: 'POST', headers: H, body: JSON.stringify({ source: 'tv', code: waiting[0].code }) })).json();
    assert.match(right.speak, /Logged 60 kwacha cash for taxi/);
    assert.equal((await fetch(`${base}/v1/cancel`, { method: 'POST', headers: H, body: JSON.stringify({ source: 'tv', code: waiting[0].code }) })).status, 200, 'nothing waiting is a normal answer, not an error');
    const sms = await (await fetch(`${base}/v1/sms`, { method: 'POST', headers: H, body: JSON.stringify({ sender: 'MTNMoMo', body: 'You have received K2,000.00 from JOHN DOE. Your new balance is K3,234.56.' }) })).json();
    assert.equal(sms.parsed, true); assert.equal(sms.tx.amount, 2000);
    const pos = await (await fetch(`${base}/v1/ask`, { method: 'POST', headers: H, body: JSON.stringify({ text: "what's my cash position" }) })).json();
    assert.match(pos.speak, /3,235 kwacha/);
    const state = await (await fetch(`${base}/v1/state`, { headers: H })).json();
    assert.equal(state.version, '0.1.0'); assert.ok(state.skills.money); assert.ok(Array.isArray(state.routines));
    const ev = await (await fetch(`${base}/v1/events?since=0`, { headers: H })).json();
    assert.ok(ev.audit.length >= 3); assert.ok(ev.next > 0);
    // the feed asks for the newest rows, oldest first within them
    const newest = await (await fetch(`${base}/v1/events?latest=2`, { headers: H })).json();
    assert.equal(newest.audit.length, 2); assert.ok(newest.audit[0].id < newest.audit[1].id); assert.equal(newest.audit[1].id, ev.next);
    const view = await (await fetch(`${base}/v1/skills/money/view`, { headers: H })).json();
    assert.equal(view.id, 'money'); assert.equal(view.view.balances[0].wallet, 'MTN MoMo'); assert.equal(view.view.recent.length, 3);
    assert.equal((await fetch(`${base}/v1/skills/nope/view`, { headers: H })).status, 404);
    const feed = await fetch(`${base}/feed/feedtoken-feedtoken-feedtoken-0001/kitt.xml`);
    assert.equal(feed.status, 200); assert.match(await feed.text(), /<rss/);
    assert.equal((await fetch(`${base}/feed/wrong-wrong-wrong-wrong-wrong/kitt.xml`)).status, 404);
    const idea = await (await fetch(`${base}/v1/idea`, { method: 'POST', headers: { Authorization: 'Bearer feedtoken-feedtoken-feedtoken-0001', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) }));
    assert.equal(idea.status, 403); // feed token has no write scope
  } finally {
    srv.app.scheduler.stop(); await new Promise((r) => srv.server.close(r));
  }
});
