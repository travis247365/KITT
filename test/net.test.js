import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { isLoopback, isTailnet, isUnspecified, tailscaleAddresses, networkIdentity, prefix64, listenPlan, peerAllowed, createListeners, currentNetwork } from '../src/net.js';
import { parseFirewall, exposureFindings, parseLsof, openToNetwork } from '../src/skills/security/exposure.js';

// GRC audit 8 Nov 2026, R1: the hub must not listen on every network the laptop joins.
const v4 = (address, netmask = '255.255.255.0') => ({ address, netmask, family: 'IPv4', internal: false });
const v6 = (address) => ({ address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false });
const HOME = {
  lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true }],
  en0: [v4('192.0.2.31'), v6('fe80::1'), v6('2001:db8:aa:1::5')],
  utun3: [v4('100.101.102.103', '255.255.255.255'), v6('fd7a:115c:a1e0::abcd')],   // Tailscale
  utun4: [v4('100.96.0.2', '255.255.255.255')],                                     // another VPN on the same IPv4 range
};
const HOTEL = { ...HOME, en0: [v4('100.70.1.2', '255.255.0.0'), v6('fe80::1')] };     // hands out carrier-grade NAT addresses
const quiet = { info() {}, warn() {} };

test('address classes: loopback, the tailnet ranges and every spelling of "all interfaces"', () => {
  for (const a of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(a), true, a);
  for (const a of ['192.0.2.31', '100.64.0.1', '::ffff:192.0.2.5', '', undefined, '127.0.0.1.example']) assert.equal(isLoopback(a), false, String(a));
  for (const a of ['100.64.0.1', '100.127.255.254', '::ffff:100.101.102.103', 'fd7a:115c:a1e0::1', 'FD7A:115C:A1E0:ab::1']) assert.equal(isTailnet(a), true, a);
  for (const a of ['100.63.255.255', '100.128.0.1', '10.0.0.1', '192.0.2.31', 'fd00::1', '100.64.0']) assert.equal(isTailnet(a), false, a);
  for (const h of ['0.0.0.0', '::', '::0', '0', '0000', '0:0:0:0:0:0:0:0', ' 0.0.0.0 ', 'LAN', '*']) assert.equal(isUnspecified(h), true, h);
  for (const h of ['127.0.0.1', 'tailscale', '', '10.0.0.1', '::1']) assert.equal(isUnspecified(h), false, h);
});

test("Tailscale addresses come only from an interface carrying Tailscale's own IPv6 prefix", () => {
  assert.deepEqual(tailscaleAddresses(HOME), ['100.101.102.103', 'fd7a:115c:a1e0::abcd']);
  assert.deepEqual(tailscaleAddresses({ tailscale0: [v4('100.80.1.1'), v6('fd7a:115c:a1e0::5')] }), ['100.80.1.1', 'fd7a:115c:a1e0::5'], 'Linux');
  assert.deepEqual(tailscaleAddresses({ en0: [v4('100.70.1.2'), v6('fd7a:115c:a1e0::9')] }), [], 'never a Wi-Fi or Ethernet interface');
  assert.deepEqual(tailscaleAddresses({}), []);
});

test('the network identity changes when the Mac moves, and ignores the tunnels', () => {
  assert.equal(prefix64('2001:db8::1'), '2001:0db8:0000:0000');
  assert.equal(prefix64('2001:db8:aa:1::5'), '2001:0db8:00aa:0001');
  assert.equal(networkIdentity(HOME), 'en0:192.0.2.31/255.255.255.0 en0:2001:0db8:00aa:0001::/64');
  assert.notEqual(networkIdentity(HOTEL), networkIdentity(HOME));
  assert.equal(networkIdentity({ ...HOME, utun3: [], utun4: [] }), networkIdentity(HOME), 'Tailscale or a VPN coming and going is not a new network');
  assert.equal(networkIdentity({ lo0: HOME.lo0 }), '', 'no network');
  const sigA = 'IPv4.Router=192.0.2.1;IPv4.RouterHardwareAddress=02:00:00:00:00:0a'; const sigB = 'IPv4.Router=192.0.2.1;IPv4.RouterHardwareAddress=02:00:00:00:00:0b';
  assert.notEqual(networkIdentity(HOME, sigA), networkIdentity(HOME, sigB), 'same numbering and the same lease behind another router is another network');
  assert.match(networkIdentity(HOME, sigA), /(^| )router:IPv4\.Router=192\.0\.2\.1;/);
});

test('the listening plan: this Mac by default, the tailnet when asked, the local network only in a window on the same network', () => {
  const now = Date.parse('2026-11-09T08:00:00Z'); const here = networkIdentity(HOME);
  assert.deepEqual(listenPlan({}, { now }).addresses, ['127.0.0.1']);
  assert.deepEqual(listenPlan({ host: 'localhost' }, { now }).addresses, ['127.0.0.1']);
  const ts = listenPlan({ host: 'tailscale' }, { now, ifaces: HOME });
  assert.equal(ts.mode, 'tailscale'); assert.equal(ts.lan, false);
  assert.deepEqual(ts.addresses, ['127.0.0.1', '100.101.102.103', 'fd7a:115c:a1e0::abcd']);
  assert.deepEqual(listenPlan({ host: 'tailscale' }, { now, ifaces: {} }).addresses, ['127.0.0.1'], 'no Tailscale yet: this Mac only');
  for (const h of ['0.0.0.0', '::0', '0', ' LAN ']) { const p = listenPlan({ host: h }, { now }); assert.equal(p.lan, true, h); assert.equal(p.legacy, true, h); assert.equal(p.expires, null, h); }
  const win = listenPlan({ host: 'tailscale', lan_until: '2026-11-09T12:00:00Z', lan_network: here }, { now, ifaces: HOME });
  assert.equal(win.lan, true); assert.deepEqual(win.addresses, ['0.0.0.0']); assert.equal(win.expires, '2026-11-09T12:00:00.000Z'); assert.equal(win.legacy, false);
  assert.equal(listenPlan({ host: 'tailscale', lan_until: '2026-11-09T12:00:00Z', lan_network: here }, { now, ifaces: HOTEL }).lan, false, 'moved to another network: the window is paused');
  assert.equal(listenPlan({ host: 'tailscale', lan_until: '2026-11-09T12:00:00Z' }, { now, ifaces: HOME }).lan, false, 'a window without a recorded network never opens');
  assert.equal(listenPlan({ host: 'tailscale', lan_until: '2026-11-09T07:59:00Z', lan_network: here }, { now, ifaces: HOME }).lan, false, 'time is up');
  assert.equal(listenPlan({ lan_until: 'not a date', lan_network: here }, { now, ifaces: HOME }).lan, false);
  const literal = listenPlan({ host: '192.0.2.31' }, { now });
  assert.equal(literal.lan, true); assert.equal(literal.expires, null); assert.equal(literal.mode, 'address');
  assert.equal(listenPlan({ host: 'my-mac.local' }, { now }).lan, true, 'a host name is a network binding');
  assert.equal(listenPlan({ host: '100.101.102.103' }, { now, ifaces: HOME }).lan, false, "a literal address that is this Mac's Tailscale address is not");
  assert.equal(listenPlan({ host: '100.70.1.2' }, { now, ifaces: HOTEL }).lan, true, 'a 100.64/10 address on the Wi-Fi is a network binding');
  const sigA = 'IPv4.Router=192.0.2.1;IPv4.RouterHardwareAddress=02:00:00:00:00:0a';
  const opened = { host: 'tailscale', lan_until: '2026-11-09T12:00:00Z', lan_network: networkIdentity(HOME, sigA) };
  assert.equal(listenPlan(opened, { now, ifaces: HOME, signature: sigA }).lan, true);
  assert.equal(listenPlan(opened, { now, ifaces: HOME, signature: sigA.replace('0a', '0b') }).lan, false, 'another router with the same numbering pauses the window');
  // macOS requires the router: a window recorded without it, or a moment the router cannot be read, is no window
  assert.equal(listenPlan(opened, { now, ifaces: HOME, signature: sigA, requireRouter: true }).lan, true);
  assert.equal(listenPlan(opened, { now, ifaces: HOME, signature: '', requireRouter: true }).lan, false, 'router unreadable: closed');
  const noRouter = { host: 'tailscale', lan_until: '2026-11-09T12:00:00Z', lan_network: networkIdentity(HOME) };
  assert.equal(listenPlan(noRouter, { now, ifaces: HOME, signature: '', requireRouter: false }).lan, true);
  assert.equal(listenPlan(noRouter, { now, ifaces: HOME, signature: sigA, requireRouter: true }).lan, false, 'a window recorded without the router never opens on macOS');
});

test('who may connect under each plan, and at what moment', () => {
  const local = listenPlan({});
  const ts = listenPlan({ host: 'tailscale' }, { ifaces: HOME });
  const lan = listenPlan({ host: '0.0.0.0' });
  assert.equal(peerAllowed('127.0.0.1', local), true);
  assert.equal(peerAllowed('100.101.1.1', local), false);
  assert.equal(peerAllowed('192.0.2.40', local), false);
  assert.equal(peerAllowed('::ffff:100.101.1.1', ts), true);
  assert.equal(peerAllowed('fd7a:115c:a1e0::77', ts), true);
  assert.equal(peerAllowed('192.0.2.40', ts), false, 'a Wi-Fi neighbour reaching the Tailscale address (weak host) is refused');
  assert.equal(peerAllowed('::ffff:192.0.2.40', ts), false);
  assert.equal(peerAllowed('192.0.2.40', lan), true);
  assert.equal(peerAllowed('127.0.0.1', null), false);
  const win = { ...lan, legacy: false, expires: '2026-11-09T12:00:00.000Z' };
  assert.equal(peerAllowed('192.0.2.40', win, Date.parse('2026-11-09T11:59:59Z')), true);
  assert.equal(peerAllowed('192.0.2.40', win, Date.parse('2026-11-09T12:00:00Z')), false, 'refused from the second the window ends, before the next check');
  assert.equal(peerAllowed('127.0.0.1', win, Date.parse('2026-11-10T00:00:00Z')), true);
});

// one fresh connection per request: a pooled keep-alive socket to a listener that has just closed would only test the pool
const get = (host, port) => new Promise((resolve, reject) => { http.get({ host, port, path: '/', agent: false }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b)); }).on('error', reject); });
const canConnect = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 1500 });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false)); s.once('timeout', () => { s.destroy(); resolve(false); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const toV6Loopback = (a) => (a === '0.0.0.0' ? '::1' : a);

// The window tests bind "every interface" to ::1 instead, so the suite never opens a port on the network it runs on (it runs
// unattended in the public sync). KITT_TEST_LAN=1 adds one real 0.0.0.0 check against this machine's network address.
test('a local-network window closes by itself when its time is up, and when the Mac changes network', async () => {
  const port = 29871; let clock = Date.parse('2026-11-09T08:00:00Z'); let ifaces = HOME;
  const opts = () => ({ port, server: { host: '127.0.0.1', lan_until: '2026-11-09T09:00:00Z', lan_network: networkIdentity(HOME) }, log: quiet, ifaces: () => ifaces, signature: () => '', requireRouter: false, now: () => clock, intervalMs: 3_600_000, bindAddress: toV6Loopback });
  const l = createListeners((req, res) => { res.end('ok'); }, opts());
  await l.start();
  try {
    assert.deepEqual(l.addresses(), ['0.0.0.0']);
    assert.equal(await get('::1', port), 'ok', 'open during the window');
    clock = Date.parse('2026-11-09T09:00:01Z');
    await l.refresh();
    assert.deepEqual(l.addresses(), ['127.0.0.1']);
    assert.equal(await get('127.0.0.1', port), 'ok', 'this Mac still reaches it');
    assert.equal(await canConnect('::1', port), false, 'the "network" listener is gone once the window ends');
  } finally { await new Promise((r) => l.close(r)); }

  clock = Date.parse('2026-11-09T08:00:00Z');
  const m = createListeners((req, res) => { res.end('ok'); }, opts());
  await m.start();
  try {
    assert.deepEqual(m.addresses(), ['0.0.0.0']);
    ifaces = HOTEL; await m.refresh();
    assert.deepEqual(m.addresses(), ['127.0.0.1'], 'a new network pauses the window at once');
  } finally { await new Promise((r) => m.close(r)); }
});

test('real network check (KITT_TEST_LAN=1 only)', { skip: process.env.KITT_TEST_LAN !== '1' }, async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.'));
  if (!lan) return;
  const port = 29873; let clock = Date.parse('2026-11-09T08:00:00Z');
  const l = createListeners((req, res) => { res.end('ok'); }, { port, server: { lan_until: '2026-11-09T09:00:00Z', lan_network: currentNetwork() }, log: quiet, now: () => clock, intervalMs: 3_600_000 });
  await l.start();
  try {
    assert.equal(await canConnect(lan.address, port), true);
    clock = Date.parse('2026-11-09T09:00:01Z'); await l.refresh();
    assert.equal(await canConnect(lan.address, port), false);
  } finally { await new Promise((r) => l.close(r)); }
});

test('close() waits for a change in progress and leaves nothing listening', async () => {
  const port = 29874; const server = { host: '127.0.0.1' };
  const l = createListeners((req, res) => res.end('ok'), { port, server, log: quiet, ifaces: () => ({}), intervalMs: 3_600_000 });
  await l.start();
  server.host = '::1'; l.refresh();
  await new Promise((r) => l.close(r));
  await wait(300);
  assert.deepEqual(l.addresses(), []);
  assert.equal(await canConnect('::1', port), false);
  assert.equal(await canConnect('127.0.0.1', port), false);
});

test('shutting down lets a request in progress finish', async () => {
  const port = 29875;
  const l = createListeners((req, res) => setTimeout(() => res.end('done'), 300), { port, server: {}, log: quiet, intervalMs: 3_600_000 });
  await l.start();
  const inflight = get('127.0.0.1', port);
  await wait(50);
  await new Promise((r) => l.close(r));
  assert.equal(await inflight, 'done');
});

test('the hub refuses to start when its own address is taken, instead of failing quietly', async () => {
  const port = 29872;
  const a = createListeners((req, res) => res.end('a'), { port, server: {}, log: quiet });
  await a.start();
  try {
    const b = createListeners((req, res) => res.end('b'), { port, server: {}, log: quiet });
    await assert.rejects(() => b.start(), /EADDRINUSE/);
  } finally { await new Promise((r) => a.close(r)); }
});

test('firewall state, open sockets and the exposure findings', () => {
  assert.equal(parseFirewall('Firewall is disabled. (State = 0)', 'Firewall has block all state set to disabled.'), 'off');
  assert.equal(parseFirewall('Firewall is enabled. (State = 1)', 'Firewall has block all state set to disabled.'), 'on');
  assert.equal(parseFirewall('Firewall is enabled. (State = 1)', 'Firewall has block all state set to enabled.'), 'block-all');
  assert.equal(parseFirewall('', ''), 'unknown');
  const sev = (r) => r.fnd.map((f) => `${f.key}:${f.severity}`);
  const legacy = listenPlan({ host: '0.0.0.0' });
  const lanLegacy = exposureFindings({ listening: legacy, firewall: 'off' });
  assert.deepEqual(sev(lanLegacy), ['mac.hub_lan:HIGH', 'mac.firewall_off:MEDIUM']);
  assert.match(lanLegacy.fnd[0].detail, /every interface.*uat-lan\.sh off/);
  assert.match(exposureFindings({ listening: listenPlan({ host: '192.0.2.31' }), firewall: 'on' }).fnd[0].detail, /network address 192\.0\.2\.31/);
  const win = { ...legacy, legacy: false, expires: '2999-01-01T00:00:00.000Z' };
  assert.deepEqual(sev(exposureFindings({ listening: win, firewall: 'on' })), ['mac.hub_lan:MEDIUM']);
  assert.match(exposureFindings({ listening: win, firewall: 'on' }).fnd[0].detail, /until 2999/);
  assert.deepEqual(sev(exposureFindings({ listening: legacy, firewall: 'unknown' })), ['mac.firewall_unknown:INFO', 'mac.hub_lan:HIGH'], 'an unreadable firewall is not a safe one');
  assert.deepEqual(sev(exposureFindings({ listening: listenPlan({}), firewall: 'unknown', previousFirewall: 'off' })), ['mac.firewall_unknown:INFO', 'mac.firewall_off:MEDIUM'], 'and never clears "off"');
  assert.deepEqual(sev(exposureFindings({ listening: listenPlan({}), firewall: 'off' })), ['mac.firewall_off:MEDIUM']);
  assert.deepEqual(exposureFindings({ listening: listenPlan({ host: 'tailscale' }), firewall: 'block-all' }).fnd, []);
  const lsof = 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 me 15u IPv4 0x1 0t0 TCP 127.0.0.1:2000 (LISTEN)\nPython 2 me 3u IPv4 0x2 0t0 TCP *:8787 (LISTEN)\nnode 3 me 4u IPv6 0x3 0t0 TCP [::1]:5173 (LISTEN)\nControlCe 4 me 9u IPv4 0x4 0t0 TCP *:7000 (LISTEN)';
  const ls = parseLsof(lsof);
  assert.deepEqual(ls.map((l) => `${l.command}@${l.host}:${l.port}`), ['node@127.0.0.1:2000', 'Python@*:8787', 'node@::1:5173', 'ControlCe@*:7000']);
  assert.deepEqual(ls.map((l) => openToNetwork(l.host, [])), [false, true, false, true]);
  assert.equal(openToNetwork('100.70.1.2', []), true, 'a 100.64/10 address that is not a Tailscale interface is the network');
  assert.equal(openToNetwork('100.101.102.103', ['100.101.102.103']), false);
  const withListeners = exposureFindings({ listening: listenPlan({}), firewall: 'on', listeners: ls });
  assert.deepEqual(sev(withListeners), ['mac.network_listeners:LOW']);
  assert.match(withListeners.fnd[0].detail, /Python :8787/);
  assert.deepEqual(exposureFindings({ listening: listenPlan({}), firewall: 'on' }).obs.map((o) => o.key), ['hub.listen', 'mac.firewall']);
  // the sockets are the truth: a hub socket on the network is raised even when the plan says this Mac only
  const stray = exposureFindings({ listening: listenPlan({}), firewall: 'off', listeners: parseLsof('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 me 15u IPv4 0x1 0t0 TCP *:2000 (LISTEN)'), hubPort: 2000 });
  assert.deepEqual(sev(stray), ['mac.hub_lan:HIGH', 'mac.firewall_off:MEDIUM']);
  assert.match(stray.fnd[0].detail, /\*:2000 is open to the network although kitt\.json does not ask for it/);
  // lsof could not run: say so, and leave the socket findings as they were
  const blind = exposureFindings({ listening: listenPlan({}), firewall: 'on', listeners: null });
  assert.deepEqual(sev(blind), ['mac.listeners_unknown:INFO']);
  assert.deepEqual(blind.unchecked, ['mac.hub_lan', 'mac.network_listeners']);
  assert.deepEqual(exposureFindings({ listening: listenPlan({}), firewall: 'on', listeners: [] }).unchecked, []);
});
