// Where the hub listens and who may connect (GRC audit 8 Nov 2026, R1: the hub was listening on every interface of a laptop that
// spends half its time away from home, with the firewall off). server.host in kitt.json chooses:
//   "127.0.0.1" (default), "localhost"  this Mac only
//   "tailscale"                         this Mac plus its Tailscale addresses: picked up within about ten seconds of Tailscale
//                                       connecting, dropped when it disconnects; a connection from any other address is refused
//   server.lan_until + server.lan_network (written by scripts/uat-lan.sh on)
//                                       ALSO every interface until that time, but only while the Mac is on the network the window
//                                       was opened on (same router, by its hardware address, and same address): it pauses
//                                       elsewhere and resumes if the Mac returns before the end time; uat-lan.sh off ends it
//   "0.0.0.0", "::", "0" and the like   every interface with no end time: legacy, warned at start, raised by the security sweep
//   any other address or host name      that address only (a network address is warned about like the legacy case)
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import nodeNet from 'node:net';

const TS_V6 = /^fd7a:115c:a1e0:/i;                       // Tailscale's own IPv6 prefix (fd7a:115c:a1e0::/48)

const bare = (a) => String(a ?? '').trim().toLowerCase().replace(/^::ffff:/, '').replace(/%.*$/, '');
export function isLoopback(a) { const x = bare(a); return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(x) || x === '::1'; }
/** 100.64.0.0/10 (Tailscale's IPv4 range) or fd7a:115c:a1e0::/48. */
export function isTailnet(a) {
  const x = bare(a); if (TS_V6.test(x)) return true;
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(x); return Boolean(m) && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}
/** Every spelling of "all interfaces": 0.0.0.0, ::, ::0, 0, 0000, 0:0:0:0:0:0:0:0, plus the words lan and *. */
export function isUnspecified(host) { const h = bare(host); return h === 'lan' || h === '*' || (h !== '' && /^[0.:]+$/.test(h)); }
const isV4 = (a) => a.family === 'IPv4' || a.family === 4;
const isV6 = (a) => a.family === 'IPv6' || a.family === 6;

/** This machine's Tailscale addresses. Only an interface that carries Tailscale's own IPv6 prefix counts (utunN on macOS,
 *  tailscale0 on Linux), so a network that hands out 100.64/10 addresses, or another VPN on that range, is never mistaken for it. */
export function tailscaleAddresses(ifaces = os.networkInterfaces()) {
  const out = new Set();
  for (const [name, list] of Object.entries(ifaces || {})) {
    if (!/^(utun|tailscale)\d*$/.test(name) || !Array.isArray(list)) continue;
    if (!list.some((a) => isV6(a) && TS_V6.test(a.address))) continue;
    for (const a of list) if ((isV4(a) && isTailnet(a.address)) || (isV6(a) && TS_V6.test(a.address))) out.add(a.address);
  }
  return [...out].sort();
}

/** The first four groups of an IPv6 address, written out in full ("2001:db8::1" → "2001:0db8:0000:0000"). */
export function prefix64(addr) {
  const [head, tail = ''] = bare(addr).split('::');
  const h = head ? head.split(':') : []; const t = tail ? tail.split(':') : [];
  const groups = addr.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':');
}

/** macOS: the NetworkSignature of each physical interface's IPv4 service (en0, en1, …) from the system configuration store. It
 *  carries the router's address and hardware (MAC) address, e.g. "IPv4.Router=…;IPv4.RouterHardwareAddress=…". Physical services,
 *  not the primary one, so an always-on VPN as the primary service does not hide the router. Readable without root, unlike the ARP
 *  table (which macOS hides from Homebrew's node). '' when there is none or on another platform. */
export function readNetworkSignature(platform = process.platform) {
  if (platform !== 'darwin') return '';
  try {
    const scutil = (cmds) => execFileSync('/usr/sbin/scutil', { input: `${cmds.join('\n')}\n`, encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] });
    const keys = [...scutil(['list State:/Network/Service/[^/]+/IPv4']).matchAll(/= (State:\/Network\/Service\/[0-9A-Fa-f-]{36}\/IPv4)/g)].map((m) => m[1]);
    if (!keys.length) return '';
    const sigs = [];
    for (const block of scutil(keys.map((k) => `show ${k}`)).split('<dictionary>').slice(1)) {
      const iface = (/InterfaceName : (\S+)/.exec(block) || [])[1] || '';
      const sig = ((/NetworkSignature : (.+)/.exec(block) || [])[1] || '').trim();
      if (/^en\d+$/.test(iface) && /RouterHardwareAddress=/.test(sig)) sigs.push(`${iface}=${sig}`);
    }
    return sigs.sort().join('|');
  } catch { return ''; }
}

/** Which network the Mac is on, as a string: the router's signature (its address and hardware address, when readable), plus the
 *  Mac's own IPv4 address and mask on each physical interface and any global IPv6 /64 prefix. Another router, or another address,
 *  changes it. Empty when there is no network. */
export function networkIdentity(ifaces = os.networkInterfaces(), signature = '') {
  const parts = [];
  if (signature) parts.push(`router:${signature}`);
  for (const [name, list] of Object.entries(ifaces || {})) {
    if (!/^(en|eth|wl|bridge)\w*$/.test(name) || !Array.isArray(list)) continue;
    for (const a of list) {
      if (a.internal) continue;
      if (isV4(a) && !a.address.startsWith('169.254.')) parts.push(`${name}:${a.address}/${a.netmask}`);
      if (isV6(a) && /^[23][0-9a-f]{3}:/i.test(a.address)) parts.push(`${name}:${prefix64(a.address)}::/64`);
    }
  }
  return [...new Set(parts)].sort().join(' ');
}

/** The identity of the network this Mac is on right now (the same function uat-lan.sh records a window with). */
export function currentNetwork() { return networkIdentity(os.networkInterfaces(), readNetworkSignature()); }

/** What to listen on right now, from the server block of kitt.json. Pure: the clock, the interfaces and the router signature are
 *  passed in (callers outside the hub pass the live ones, or an open window looks closed). */
export function listenPlan(server = {}, { now = Date.now(), ifaces = {}, signature = '', requireRouter = false } = {}) {
  const host = String(server.host ?? '127.0.0.1').trim().toLowerCase() || '127.0.0.1';
  if (isUnspecified(host)) return { mode: 'lan', addresses: ['0.0.0.0'], lan: true, tailnet: true, expires: null, legacy: true };
  const until = server.lan_until ? Date.parse(server.lan_until) : NaN;
  // requireRouter (macOS): a window recorded without the router's identity, or a moment when it cannot be read, is no window
  const sameNetwork = Boolean(server.lan_network) && (!requireRouter || (server.lan_network.includes('router:') && Boolean(signature)))
    && networkIdentity(ifaces, signature) === server.lan_network;
  if (Number.isFinite(until) && until > now && sameNetwork) return { mode: 'lan', addresses: ['0.0.0.0'], lan: true, tailnet: true, expires: new Date(until).toISOString(), legacy: false, after: host };
  if (host === 'tailscale') return { mode: 'tailscale', addresses: ['127.0.0.1', ...tailscaleAddresses(ifaces)], lan: false, tailnet: true };
  if (host === 'localhost' || host === 'local') return { mode: 'local', addresses: ['127.0.0.1'], lan: false, tailnet: false };
  if (isLoopback(host)) return { mode: 'local', addresses: [host], lan: false, tailnet: false };
  // a literal tailnet address counts as the tailnet only while it is this Mac's own Tailscale address: a network that hands out
  // 100.64/10 addresses would otherwise pass for it
  if (nodeNet.isIP(bare(host)) && tailscaleAddresses(ifaces).includes(bare(host))) return { mode: 'address', addresses: [host], lan: false, tailnet: true };
  return { mode: 'address', addresses: [host], lan: true, tailnet: true, expires: null };   // a network address or a host name
}

/** May a connection from this address be served under this plan, at this moment? Loopback always; Tailscale peers when the plan
 *  includes the tailnet; anyone only on a local-network plan whose window has not ended. */
export function peerAllowed(addr, plan, now = Date.now()) {
  if (!plan) return false;
  if (isLoopback(addr)) return true;
  if (plan.lan && !(plan.expires && now >= Date.parse(plan.expires))) return true;
  return Boolean(plan.tailnet) && isTailnet(addr);
}

let current = null; let currentOwner = null;
/** The plan and the addresses actually bound by the running hub (null outside the hub process). */
export function currentListening() { return current ? { ...current, addresses: [...current.addresses] } : null; }

/** One http.Server per address, kept in step with the plan every `intervalMs` (Tailscale coming and going, the network changing,
 *  the local-network window ending). `bindAddress` maps a planned address to the one actually bound (tests only). */
export function createListeners(handler, { port, server = {}, log = console, intervalMs = 10_000, ifaces = () => os.networkInterfaces(), signature = () => readNetworkSignature(), requireRouter = process.platform === 'darwin', now = () => Date.now(), setup = () => {}, bindAddress = (a) => a } = {}) {
  const live = new Map();
  const owner = {};
  let plan = null; let timer = null; let busy = null; let stopped = false;

  function open(address) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(handler); setup(s);
      s.on('connection', (sock) => {
        if (peerAllowed(sock.remoteAddress, plan, now())) return;
        log.warn('refused a connection from outside this Mac and its tailnet', { from: sock.remoteAddress, on: address });
        sock.destroy();
        if (plan?.lan) tick();      // a window that has just ended: close it now rather than at the next tick
      });
      const fail = (e) => reject(e);
      s.once('error', fail);
      s.listen(port, bindAddress(address), () => {
        s.off('error', fail);
        if (stopped) { s.close(); return resolve(null); }       // close() ran while this listen was pending
        s.on('error', (e) => log.warn('listener error', { address, err: e.code || e.message }));
        live.set(address, s); resolve(s);
      });
    });
  }
  /** force: the address left the plan, so its open connections end now. Otherwise requests in progress may finish. */
  function close(address, { force = false } = {}) {
    const s = live.get(address); live.delete(address);
    return new Promise((resolve) => {
      if (!s) return resolve();
      const t = setTimeout(resolve, 2000); t.unref?.();
      s.close(() => { clearTimeout(t); resolve(); });
      if (force) s.closeAllConnections?.(); else s.closeIdleConnections?.();
    });
  }
  function publish() {
    if (stopped) return;
    current = { mode: plan.mode, lan: plan.lan, tailnet: plan.tailnet, expires: plan.expires || null, legacy: Boolean(plan.legacy), addresses: [...live.keys()], port };
    currentOwner = owner;
  }
  async function reconcile(first = false) {
    if (stopped) return;
    const t = now(); const until = server.lan_until ? Date.parse(server.lan_until) : NaN;
    const windowOpen = Number.isFinite(until) && until > t;   // the router lookup (a subprocess) only while a window is still running
    const next = listenPlan(server, { now: t, ifaces: ifaces(), signature: windowOpen ? signature() : '', requireRouter });
    const want = new Set(next.addresses);
    const gone = [...live.keys()].filter((a) => !want.has(a));
    const fresh = next.addresses.filter((a) => !live.has(a));
    const changed = !plan || plan.mode !== next.mode || plan.expires !== next.expires || gone.length || fresh.length;
    plan = next;
    for (const a of gone) await close(a, { force: true });   // first, so 0.0.0.0 and 127.0.0.1 never fight over the port
    for (const a of fresh) {
      if (stopped) return;
      try { await open(a); } catch (e) {
        if (first && a === next.addresses[0]) throw e;       // the hub cannot start without its primary address
        log.warn('could not listen', { address: a, err: e.code || e.message });
      }
    }
    publish();
    if (changed && !first) log.info('kitt listeners changed', { mode: plan.mode, addresses: [...live.keys()], lan_until: plan.expires || undefined });
  }
  function tick() {
    if (busy || stopped) return busy;
    busy = reconcile().catch((e) => log.warn('listener check failed', { err: e.message })).finally(() => { busy = null; });
    return busy;
  }

  return {
    async start() { await reconcile(true); timer = setInterval(tick, intervalMs); timer.unref?.(); return this; },
    refresh() { return tick() || Promise.resolve(); },
    plan() { return plan; },
    addresses() { return [...live.keys()]; },
    close(cb) {
      stopped = true; if (timer) clearInterval(timer);
      Promise.resolve(busy).then(() => Promise.all([...live.keys()].map((a) => close(a)))).then(() => {
        if (currentOwner === owner) { current = null; currentOwner = null; }
        if (cb) cb();
      });
    },
  };
}
