import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTV } from '../src/web/tv.js';

// GRC audit 8 Nov 2026, R1: a screen in a room is read by whoever is in the room, so /tv shows counts and status only.
test('the TV view never shows the brief text or a skill health detail', async () => {
  const secretBrief = 'Good morning. Cash on hand K 48,210.55 across 3 accounts. ExampleClientCo board: 2 items overdue. Pay Pat Example 1,200 kwacha.';
  const app = {
    state: async () => ({
      version: '9.9.9', brain: { ok: true }, pending: [{}, {}], coverage: { days: 7, uptime_pct: 61.2 },
      briefs: { evening: { at: '2026-11-08T17:00:00Z', text: 'older' }, morning: { at: '2026-11-09T05:00:00Z', text: secretBrief } },
      skills: { money: { name: 'Money', ok: false, detail: 'balance K 48,210.55; feed down' }, chief: { name: 'Chief', ok: true, detail: 'ExampleClientCo synced' } },
      unavailable: [{ id: 'trips', error: 'token for pat@example.com expired' }],
    }),
  };
  const html = await renderTV(app);
  for (const leak of ['48,210', 'ExampleClientCo', 'Pat Example', 'kwacha', 'feed down', 'pat@example.com', 'older', 'Good morning']) assert.ok(!html.includes(leak), `leaked: ${leak}`);
  assert.match(html, /Morning brief ready/);
  assert.match(html, /open the KITT app to hear it/);
  assert.match(html, /Money needs attention/);
  assert.match(html, /trips failed to load/);
  assert.match(html, /2 pending confirmations/);
  assert.match(html, /coverage 61\.2%/);
});

test('the TV view without any brief yet', async () => {
  const html = await renderTV({ state: async () => ({ version: '1', briefs: {}, skills: {}, unavailable: [], pending: [] }) });
  assert.match(html, /No brief generated yet/);
  assert.match(html, /All systems nominal/);
});
