// This Mac's own exposure (GRC audit 8 Nov 2026, R1): where the hub listens, what else listens on every interface, and whether
// the macOS firewall is on. Read-only: it asks for state and never changes it (turning the firewall on is the owner's step).
import { execFile } from 'node:child_process';
import { isLoopback, tailscaleAddresses } from '../../net.js';

const FW = '/usr/libexec/ApplicationFirewall/socketfilterfw';
const run = (cmd, args) => new Promise((resolve) => { execFile(cmd, args, { timeout: 8000 }, (err, out, errOut) => resolve({ text: `${out || ''}${errOut || ''}`, out: out || '', stderr: String(errOut || '').trim(), failed: Boolean(err), missing: err?.code === 'ENOENT', timedOut: Boolean(err?.killed) })); });

/** "on", "block-all", "off" or "unknown", from the text of `--getglobalstate` and `--getblockall`. */
export function parseFirewall(globalState = '', blockAll = '') {
  const m = /State = (\d)/.exec(globalState);
  const on = m ? Number(m[1]) > 0 : /\benabled\b/i.test(globalState) ? true : /\bdisabled\b/i.test(globalState) ? false : null;
  if (on === null) return 'unknown';
  if (!on) return 'off';
  return /\benabled\b/i.test(blockAll) ? 'block-all' : 'on';
}

export async function readFirewall(platform = process.platform) {
  if (platform !== 'darwin') return 'n/a';
  return parseFirewall((await run(FW, ['--getglobalstate'])).text, (await run(FW, ['--getblockall'])).text);
}

/** Listening TCP sockets of this user's processes, from lsof: [{ command, pid, host, port }]; null when lsof could not run. */
export async function readListeners(platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'linux') return null;
  const r = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
  if (r.missing || r.timedOut || (r.failed && r.stderr)) return null;   // exit 1 with no output is lsof's "nothing found"
  return parseLsof(r.out);
}
export function parseLsof(text = '') {
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/); if (f.length < 9) continue;
    const name = f[8]; const i = name.lastIndexOf(':'); if (i < 0) continue;
    out.push({ command: f[0], pid: Number(f[1]), host: name.slice(0, i).replace(/^\[|\]$/g, ''), port: Number(name.slice(i + 1)) });
  }
  return out;
}
/** A socket anyone on the local network can reach: every interface, or an address that is neither loopback nor one of this
 *  Mac's own Tailscale addresses (a 100.64/10 address on the Wi-Fi is a local-network address). */
export function openToNetwork(host, tailscale = tailscaleAddresses()) {
  const h = String(host || '').toLowerCase().replace(/^::ffff:/, '');
  return h === '*' || h === '0.0.0.0' || h === '::' || (!isLoopback(h) && !tailscale.includes(h));
}

const SAFE = new Set(['on', 'block-all']);

/** Observations and findings for the sweep. `previousFirewall` is last run's reading: an unreadable state never clears "off".
 *  `listeners` (from lsof) are the truth about the hub's sockets; the plan is only a prediction. `unchecked` lists the finding keys
 *  this run could not check, which the sweep must leave open. */
export function exposureFindings({ listening, firewall, previousFirewall = null, listeners = undefined, hubPort = 2000, tailscale = [] }) {   // listeners: null = lsof failed, undefined = not asked
  const obs = []; const fnd = []; const unchecked = [];
  if (listening) obs.push({ key: 'hub.listen', value: `${listening.mode}:${(listening.addresses || []).join(',')}${listening.expires ? ` until ${listening.expires}` : ''}` });
  if (firewall && firewall !== 'n/a') obs.push({ key: 'mac.firewall', value: firewall });
  const effective = firewall === 'unknown' && previousFirewall === 'off' ? 'off' : firewall;   // carry "off" over an unreadable run
  if (firewall === 'unknown') fnd.push({ key: 'mac.firewall_unknown', severity: 'INFO', title: 'The Mac firewall state could not be read', detail: `socketfilterfw gave no answer; last reading: ${previousFirewall || 'none'}` });
  const hubSocket = Array.isArray(listeners) ? listeners.find((l) => l.port === hubPort && openToNetwork(l.host, tailscale)) : null;
  if (listeners === null) { unchecked.push('mac.hub_lan', 'mac.network_listeners'); fnd.push({ key: 'mac.listeners_unknown', severity: 'INFO', title: "This Mac's open sockets could not be read", detail: 'lsof did not run; the hub and listener findings are left as they were' }); }
  if (listening?.lan || hubSocket) {
    const detail = !listening?.lan ? `the hub's socket ${hubSocket.host}:${hubSocket.port} is open to the network although kitt.json does not ask for it; restart the hub (node bin/kitt restart) and run node bin/kitt doctor`
      : listening.expires ? `test window open until ${listening.expires}; close it now with: bash scripts/uat-lan.sh off`
      : listening.legacy ? 'server.host is every interface (0.0.0.0) with no end time; close it with: bash scripts/uat-lan.sh off'
        : `server.host is the network address ${(listening.addresses || [])[0] || '?'} with no end time; set it to "tailscale" or 127.0.0.1 (bash scripts/uat-lan.sh off does this)`;
    fnd.push({ key: 'mac.hub_lan', severity: SAFE.has(effective) ? 'MEDIUM' : 'HIGH', title: `The KITT hub is open to the local network${effective === 'off' ? ' and the Mac firewall is off' : ''}`, detail });
  }
  if (effective === 'off') fnd.push({ key: 'mac.firewall_off', severity: 'MEDIUM', title: 'The Mac firewall is off', detail: 'System Settings › Network › Firewall: turn it on (GRC audit R1)' });
  if (Array.isArray(listeners)) {
    const others = listeners.filter((l) => l.port !== hubPort && openToNetwork(l.host, tailscale) && /^(node|python|ruby|php|java|deno|bun)/i.test(l.command));
    const list = [...new Set(others.map((l) => `${l.command} :${l.port}`))].sort();
    obs.push({ key: 'mac.network_listeners', value: list.join(',') || 'none' });
    if (list.length) fnd.push({ key: 'mac.network_listeners', severity: 'LOW', title: `${list.length} other local server${list.length === 1 ? '' : 's'} open to the network`, detail: `${list.join(', ')}${list.some((x) => x.endsWith(':8787')) ? ' (:8787 is the LG TV launcher: it answers this Mac, or the TV\'s address while the paired TV proves itself)' : ''}` });
  }
  return { obs, fnd, unchecked };
}
