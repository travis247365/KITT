#!/usr/bin/env node
// A throwaway hub for testing the apps: isolated config and data in a temp folder, port 2998, a fixed development app token, one decision
// waiting. It never touches ~/.config/kitt or ~/.local/share/kitt and stops on Ctrl-C or SIGTERM.
//   node scripts/dev-hub.mjs        then run an app with KITT_DEV_URL=http://127.0.0.1:2998 KITT_DEV_TOKEN=dev-app-token-0123456789abcdef
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEV_PORT = 2998;
export const DEV_TOKEN = 'dev-app-token-0123456789abcdef';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-dev-hub-'));
process.env.KITT_CONFIG_DIR = path.join(tmp, 'cfg');
process.env.KITT_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.KITT_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.env'), `KITT_TOKEN=dev-full-token-0123456789abcdef\nKITT_APP_TOKEN=${DEV_TOKEN}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.json'), JSON.stringify({ server: { port: DEV_PORT }, skills: { enabled: ['money', 'ideas', 'shoplog'] }, brain: { provider: 'cli' } }));

const { startServer } = await import('../src/server.js');
const srv = await startServer({ port: DEV_PORT });
const H = { Authorization: `Bearer ${DEV_TOKEN}`, 'content-type': 'application/json' };
const base = `http://127.0.0.1:${DEV_PORT}`;
await fetch(`${base}/v1/ask`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Kit, log cash 50 parking', source: 'dev' }) });
console.log(`dev hub ready on ${base} (token ${DEV_TOKEN}); one decision is waiting`);
const stop = () => { try { srv.close?.(); } catch { /* already closed */ } fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
