// Skill 12 — 5-Minute Security Checker: daily read-only sweep of GitHub, Vercel, Fly.io, Cloudflare and this Mac's own exposure
// (where the hub listens, the firewall), baseline-and-diff so the brief is about what CHANGED, severity-ranked, spoken in under a minute.
import { ghApi, vercelApi, fly, BIN } from '../../services/cli.js';
import { spokenList, plural } from '../../voice.js';
import os from 'node:os';
import { currentListening, listenPlan, readNetworkSignature, tailscaleAddresses } from '../../net.js';
import { exposureFindings, readFirewall, readListeners } from './exposure.js';
import fs from 'node:fs';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sec_observations (
     run_id INTEGER NOT NULL, provider TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, provider, key)
   );
   CREATE TABLE IF NOT EXISTS sec_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, status TEXT, summary TEXT, providers TEXT, duration_ms INTEGER);
   CREATE TABLE IF NOT EXISTS sec_findings (
     key TEXT PRIMARY KEY, provider TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, status TEXT NOT NULL DEFAULT 'open',
     first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, acknowledged INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE INDEX IF NOT EXISTS sec_observations_key ON sec_observations(provider, key, run_id);`,   // the diff looks each key up in its own history
];

const SEV = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const SECRETISH = /secret|token|key|password|passwd|private|credential|auth|api/i;

export default function define(ctx) {
  const { db, secrets, config, log } = ctx;
  const cfg = { github_owner: null, vercel_scope: null, public_ok_vercel: [], fly_apps_expected: [], max_repos: 45, ...(config.security || {}) }; // account names and public-by-design projects live in ~/.config/kitt/kitt.json
  let running = null;

  // ---------- providers: each returns { observations: [{key,value}], findings: [{key,severity,title,detail}] } ----------
  async function github() {
    const obs = []; const fnd = []; const unchecked = [];   // keys a sub-check could not settle this run: left as they were
    // /user/repos (not /users/{owner}/repos): the latter only lists PUBLIC repos; private ones need the authenticated endpoint
    const repos = await ghApi('/user/repos?per_page=100&affiliation=owner&sort=pushed', { timeoutMs: 60000 });
    if (repos.status !== 200 || !Array.isArray(repos.body)) { fnd.push({ key: 'github.unreachable', severity: 'INFO', title: 'GitHub check could not run', detail: repos.err || `HTTP ${repos.status}` }); return { obs, fnd, failed: true }; }
    const list = repos.body.filter((r) => !r.archived);
    obs.push({ key: 'repos.count', value: String(list.length) });
    for (const r of list) obs.push({ key: `repo.visibility:${r.name}`, value: r.private ? 'private' : 'public' });
    const pub = list.filter((r) => !r.private).map((r) => r.name);
    obs.push({ key: 'repos.public', value: pub.sort().join(',') });
    const user = await ghApi('/user');
    if (user.status !== 200 || !user.body) unchecked.push('github.2fa', 'github.2fa.unknown');
    if (user.body && user.body.two_factor_authentication === false) fnd.push({ key: 'github.2fa', severity: 'CRITICAL', title: 'GitHub two-factor authentication is OFF', detail: `account ${user.body.login}` });
    else if (user.body && user.body.two_factor_authentication == null) fnd.push({ key: 'github.2fa.unknown', severity: 'INFO', title: 'GitHub 2FA state not readable', detail: "gh token lacks the 'user' scope; run: gh auth refresh -s user" });
    // active repos (pushed in the last 120 days): Dependabot alerts enabled? open alerts?
    const active = list.filter((r) => Date.now() - new Date(r.pushed_at).getTime() < 120 * 86400000).slice(0, cfg.max_repos);
    let disabled = []; let checked = 0;
    for (const r of active) {
      const v = await ghApi(`/repos/${r.owner?.login || cfg.github_owner}/${r.name}/vulnerability-alerts`, { timeoutMs: 30000 });
      checked++;
      if (v.status === 404) disabled.push(r.name);
      else if (v.status !== 204) unchecked.push(`github.dependabot.critical:${r.name}`, `github.dependabot.high:${r.name}`, 'github.dependabot.disabled');
      else {
        const al = await ghApi(`/repos/${r.owner?.login || cfg.github_owner}/${r.name}/dependabot/alerts?state=open&per_page=50`, { timeoutMs: 30000 });
        if (al.status !== 200 || !Array.isArray(al.body)) unchecked.push(`github.dependabot.critical:${r.name}`, `github.dependabot.high:${r.name}`);
        else {
          const bySev = {}; for (const a of al.body) { const s = (a.security_advisory?.severity || 'unknown').toLowerCase(); bySev[s] = (bySev[s] || 0) + 1; }
          obs.push({ key: `repo.dependabot_open:${r.name}`, value: JSON.stringify(bySev) });
          if (bySev.critical) fnd.push({ key: `github.dependabot.critical:${r.name}`, severity: 'HIGH', title: `${bySev.critical} critical Dependabot alert${bySev.critical > 1 ? 's' : ''} in ${r.name}`, detail: Object.entries(bySev).map(([k, n]) => `${k} ${n}`).join(', ') });
          else if (bySev.high) fnd.push({ key: `github.dependabot.high:${r.name}`, severity: 'MEDIUM', title: `${bySev.high} high Dependabot alert${bySev.high > 1 ? 's' : ''} in ${r.name}`, detail: Object.entries(bySev).map(([k, n]) => `${k} ${n}`).join(', ') });
        }
      }
    }
    obs.push({ key: 'repos.dependabot_disabled', value: disabled.sort().join(',') });
    if (disabled.length) fnd.push({ key: 'github.dependabot.disabled', severity: 'MEDIUM', title: `Dependabot alerts are off on ${plural(disabled.length, 'active repo')}`, detail: `${disabled.slice(0, 12).join(', ')}${disabled.length > 12 ? '…' : ''} — enable in Settings → Code security, or org-wide` });
    for (const name of pub) {
      const sa = await ghApi(`/repos/${(list.find((x) => x.name === name)?.owner?.login) || cfg.github_owner}/${name}/secret-scanning/alerts?state=open&per_page=20`, { timeoutMs: 30000 });
      if (sa.status !== 200 || !Array.isArray(sa.body)) unchecked.push(`github.secrets:${name}`);
      else if (sa.body.length) fnd.push({ key: `github.secrets:${name}`, severity: 'CRITICAL', title: `${sa.body.length} open secret-scanning alert${sa.body.length > 1 ? 's' : ''} in public repo ${name}`, detail: sa.body.map((a) => a.secret_type_display_name || a.secret_type).join(', ') });
    }
    return { obs, fnd, unchecked, note: `${list.length} repos, ${checked} active checked, ${pub.length} public${unchecked.length ? `; partial: ${new Set(unchecked).size} checks could not run` : ''}` };
  }

  async function vercel() {
    const obs = []; const fnd = []; const unchecked = [];
    const r = await vercelApi('/v9/projects?limit=100', { scope: cfg.vercel_scope, timeoutMs: 60000 });
    if (!r.ok || !r.body?.projects) { fnd.push({ key: 'vercel.unreachable', severity: 'INFO', title: 'Vercel check could not run', detail: r.err || 'no projects payload' }); return { obs, fnd, failed: true }; }
    const projects = r.body.projects;
    obs.push({ key: 'projects.count', value: String(projects.length) });
    for (const p of projects) {
      const prot = p.ssoProtection ? 'sso' : p.passwordProtection ? 'password' : 'none';
      obs.push({ key: `project.protection:${p.name}`, value: prot });
      if (prot === 'none' && !cfg.public_ok_vercel.includes(p.name)) fnd.push({ key: `vercel.unprotected:${p.name}`, severity: 'MEDIUM', title: `Vercel project ${p.name} has no deployment protection`, detail: 'turn on Vercel Authentication or add it to security.public_ok_vercel if it is meant to be public' });
      const latest = p.latestDeployments?.[0];
      if (latest && latest.readyState === 'ERROR') fnd.push({ key: `vercel.deploy_error:${p.name}`, severity: 'LOW', title: `Latest deployment of ${p.name} is in ERROR`, detail: latest.url || '' });
      const env = await vercelApi(`/v9/projects/${p.id}/env`, { scope: cfg.vercel_scope, timeoutMs: 30000 });
      if (!env.ok || !Array.isArray(env.body?.envs)) unchecked.push(`vercel.env_plain:${p.name}`, `vercel.env_readable:${p.name}`);
      else {
        const plain = env.body.envs.filter((e) => e.type === 'plain' && SECRETISH.test(e.key)).map((e) => e.key);
        const readable = env.body.envs.filter((e) => e.type === 'encrypted' && SECRETISH.test(e.key)).map((e) => e.key);
        obs.push({ key: `project.env_plain_secretish:${p.name}`, value: plain.sort().join(',') });
        if (plain.length) fnd.push({ key: `vercel.env_plain:${p.name}`, severity: 'HIGH', title: `${p.name}: ${plural(plain.length, 'secret-looking env var')} stored as plain text`, detail: plain.join(', ') });
        if (readable.length) fnd.push({ key: `vercel.env_readable:${p.name}`, severity: 'LOW', title: `${p.name}: ${plural(readable.length, 'secret-looking env var')} readable in the dashboard`, detail: `${readable.slice(0, 8).join(', ')} — mark as Sensitive` });
      }
      const dom = await vercelApi(`/v9/projects/${p.id}/domains`, { scope: cfg.vercel_scope, timeoutMs: 30000 });
      if (!dom.ok || !Array.isArray(dom.body?.domains)) unchecked.push('vercel.domain_unverified');   // domain names unknown: all of them
      else {
        obs.push({ key: `project.domains:${p.name}`, value: dom.body.domains.map((d) => d.name).sort().join(',') });
        for (const d of dom.body.domains) if (d.verified === false) fnd.push({ key: `vercel.domain_unverified:${d.name}`, severity: 'LOW', title: `Domain ${d.name} on ${p.name} is not verified`, detail: 'DNS not pointed yet or verification pending' });
      }
    }
    return { obs, fnd, unchecked, note: `${projects.length} projects${unchecked.length ? `; partial: ${new Set(unchecked).size} checks could not run` : ''}` };
  }

  async function flyio() {
    const obs = []; const fnd = []; const unchecked = [];
    const apps = await fly(['apps', 'list'], { timeoutMs: 60000 });
    if (!apps.ok || !Array.isArray(apps.body)) { fnd.push({ key: 'fly.unreachable', severity: 'INFO', title: 'Fly.io check could not run', detail: apps.err || 'no apps payload' }); return { obs, fnd, failed: true }; }
    obs.push({ key: 'apps', value: apps.body.map((a) => `${a.Name}:${a.Status}`).sort().join(',') });
    const deployed = apps.body.filter((a) => a.Status === 'deployed');
    for (const a of deployed) {
      const ips = await fly(['ips', 'list', '-a', a.Name], { timeoutMs: 30000 });
      if (ips.ok && Array.isArray(ips.body)) obs.push({ key: `app.ips:${a.Name}`, value: ips.body.map((i) => `${i.Type}:${i.Address}`).sort().join(',') });
      const certs = await fly(['certs', 'list', '-a', a.Name], { timeoutMs: 30000 });
      if (!certs.ok || !Array.isArray(certs.body)) unchecked.push('fly.cert');
      else for (const c of certs.body) if (c.ClientStatus && c.ClientStatus !== 'Ready') fnd.push({ key: `fly.cert:${c.Hostname}`, severity: 'MEDIUM', title: `Fly certificate for ${c.Hostname} is ${c.ClientStatus}`, detail: `app ${a.Name}` });
    }
    return { obs, fnd, unchecked, note: `${apps.body.length} apps, ${deployed.length} deployed${unchecked.length ? '; partial: certificates not read' : ''}` };
  }

  async function cloudflare() {
    const obs = []; const fnd = []; const unchecked = [];
    const token = secrets.KITT_CLOUDFLARE_TOKEN;
    if (!token) { fnd.push({ key: 'cloudflare.disabled', severity: 'INFO', title: 'Cloudflare checks are off', detail: 'create a read-only API token (Zone:Read, DNS:Read, Account Settings:Read, Pages:Read) and set KITT_CLOUDFLARE_TOKEN' }); return { obs, fnd, failed: true, resolve: ['cloudflare.token'] }; }   // checks off: the old token finding is settled, zone findings are not
    const h = { Authorization: `Bearer ${token}` };
    const get = async (p) => { const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: h, signal: AbortSignal.timeout(20000) }); return r.json(); };
    const v = await get('/user/tokens/verify').catch((e) => ({ success: false, errors: [{ message: e.message }] }));
    if (!v.success) { fnd.push({ key: 'cloudflare.token', severity: 'MEDIUM', title: 'Cloudflare API token is invalid or expired', detail: (v.errors || []).map((e) => e.message).join('; ') }); return { obs, fnd, failed: true }; }
    const zones = await get('/zones?per_page=50');
    if (zones.success === false || !Array.isArray(zones.result)) { fnd.push({ key: 'cloudflare.zones', severity: 'INFO', title: 'Cloudflare zones could not be listed', detail: (zones.errors || []).map((e) => e.message).join('; ') || 'no zones payload' }); return { obs, fnd, failed: true }; }
    for (const z of zones.result) {
      obs.push({ key: `zone:${z.name}`, value: `${z.status}/${z.plan?.name || ''}` });
      for (const s of ['ssl', 'always_use_https', 'min_tls_version', 'security_level']) {
        const r = await get(`/zones/${z.id}/settings/${s}`).catch(() => null);
        if (r?.result) { obs.push({ key: `zone.setting:${z.name}:${s}`, value: String(r.result.value) }); }
        else if (s === 'ssl') unchecked.push(`cloudflare.ssl:${z.name}`);
        else if (s === 'always_use_https') unchecked.push(`cloudflare.https:${z.name}`);
        if (s === 'ssl' && r?.result && ['off', 'flexible'].includes(r.result.value)) fnd.push({ key: `cloudflare.ssl:${z.name}`, severity: 'HIGH', title: `Zone ${z.name} SSL mode is ${r.result.value}`, detail: 'use Full (strict)' });
        if (s === 'always_use_https' && r?.result?.value === 'off') fnd.push({ key: `cloudflare.https:${z.name}`, severity: 'MEDIUM', title: `Zone ${z.name} does not force HTTPS`, detail: '' });
      }
      const dns = await get(`/zones/${z.id}/dns_records?per_page=200`).catch(() => null);
      if (dns?.result) obs.push({ key: `zone.dns:${z.name}`, value: dns.result.map((r) => `${r.type} ${r.name}`).sort().join(',') });
    }
    const pages = cfg.cloudflare_account ? await get(`/accounts/${cfg.cloudflare_account}/pages/projects`).catch(() => null) : null;
    if (pages?.result) obs.push({ key: 'pages.projects', value: pages.result.map((p) => p.name).sort().join(',') });
    return { obs, fnd, unchecked, note: `${zones.result.length} zones${unchecked.length ? `; partial: ${unchecked.length} settings not read` : ''}` };
  }

  // This Mac: the running hub's listeners (or, from the command line, what kitt.json would make it listen on) and the firewall.
  async function mac() {
    // inside the hub: what it actually bound; from the command line: the plan for the live network (or an open window looks closed)
    const listening = currentListening() || listenPlan(config.server || {}, { ifaces: os.networkInterfaces(), signature: readNetworkSignature(), requireRouter: process.platform === 'darwin' });
    const firewall = await readFirewall();
    const previousFirewall = db.prepare("SELECT o.value FROM sec_observations o JOIN sec_runs r ON r.id = o.run_id WHERE o.provider = 'mac' AND o.key = 'mac.firewall' AND o.value != 'unknown' AND r.status = 'ok' ORDER BY o.run_id DESC LIMIT 1").get()?.value || null;
    const { obs, fnd, unchecked } = exposureFindings({ listening, firewall, previousFirewall, listeners: await readListeners(), hubPort: config.server?.port || 2000, tailscale: tailscaleAddresses() });
    return { obs, fnd, unchecked, note: `hub ${listening.mode}${listening.lan ? ' (local network)' : ''}, firewall ${firewall}` };
  }

  // ---------- diffing against the previous run ----------
  function diffFindings(runId, prevRunId, provider, obs) {
    const out = [];
    const last = db.prepare('SELECT value FROM sec_observations WHERE provider = ? AND key = ? AND run_id < ? ORDER BY run_id DESC LIMIT 1');
    const prev = Object.fromEntries(obs.map((o) => [o.key, last.get(provider, o.key, runId)?.value]).filter(([, v]) => v !== undefined));
    for (const o of obs) {
      const was = prev[o.key];
      if (was === undefined || was === o.value) continue;
      if (o.key.startsWith('repo.visibility:') && o.value === 'public') out.push({ key: `change:${provider}:${o.key}`, severity: 'CRITICAL', title: `Repo ${o.key.split(':')[1]} became PUBLIC`, detail: `was ${was}` });
      else if (o.key === 'repos.public') { const added = o.value.split(',').filter((x) => x && !was.split(',').includes(x)); if (added.length) out.push({ key: `change:${provider}:public_repos`, severity: 'CRITICAL', title: `New public repo${added.length > 1 ? 's' : ''}: ${added.join(', ')}`, detail: '' }); }
      else if (o.key.startsWith('project.protection:') && o.value === 'none') out.push({ key: `change:${provider}:${o.key}`, severity: 'HIGH', title: `Deployment protection removed from ${o.key.split(':')[1]}`, detail: `was ${was}` });
      else if (o.key.startsWith('project.domains:')) out.push({ key: `change:${provider}:${o.key}`, severity: 'MEDIUM', title: `Domains changed on ${o.key.split(':')[1]}`, detail: `${was} → ${o.value}` });
      else if (o.key.startsWith('app.ips:')) out.push({ key: `change:${provider}:${o.key}`, severity: 'HIGH', title: `Public IPs changed for Fly app ${o.key.split(':')[1]}`, detail: `${was} → ${o.value}` });
      else if (o.key === 'apps') out.push({ key: `change:${provider}:apps`, severity: 'MEDIUM', title: 'Fly app list or status changed', detail: `${was} → ${o.value}` });
      else if (o.key.startsWith('zone.dns:')) out.push({ key: `change:${provider}:${o.key}`, severity: 'HIGH', title: `DNS records changed in ${o.key.split(':')[1]}`, detail: `${was} → ${o.value}`.slice(0, 500) });
      else if (o.key.startsWith('zone.setting:')) out.push({ key: `change:${provider}:${o.key}`, severity: 'MEDIUM', title: `Cloudflare setting changed: ${o.key.slice('zone.setting:'.length)}`, detail: `${was} → ${o.value}` });
      else if (o.key.startsWith('project.env_plain_secretish:')) out.push({ key: `change:${provider}:${o.key}`, severity: 'HIGH', title: `Plain-text secret-like env vars changed on ${o.key.split(':')[1]}`, detail: `${was} → ${o.value}` });
    }
    return out;
  }

  let onlyProviders = null; let failedProviders = []; let uncheckedKeys = []; let settledKeys = [];   // what this run could not check stays open; settled keys resolve anyway
  function upsertFindings(found) {
    const ins = db.prepare(`INSERT INTO sec_findings(key, provider, severity, title, detail, status, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, 'open', datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET severity = excluded.severity, title = excluded.title, detail = excluded.detail, last_seen = excluded.last_seen, status = 'open', resolved_at = NULL`);
    const keys = new Set();
    let fresh = 0;
    for (const f of found) { if (!db.prepare('SELECT 1 FROM sec_findings WHERE key = ? AND status = \'open\'').get(f.key)) fresh++; ins.run(f.key, f.provider, f.severity, f.title, f.detail || ''); keys.add(f.key); }
    // anything open that was not reported this run (and is not a change: finding, which is point-in-time) resolves
    const open = db.prepare("SELECT key, provider FROM sec_findings WHERE status = 'open'").all();
    let resolved = 0;
    for (const o of open) if (!keys.has(o.key) && !o.key.startsWith('change:') && (!onlyProviders || onlyProviders.includes(o.provider)) && ((!failedProviders.includes(o.provider) && !uncheckedKeys.some((k) => o.key === k || o.key.startsWith(`${k}:`))) || settledKeys.includes(o.key))) { db.prepare("UPDATE sec_findings SET status = 'resolved', resolved_at = datetime('now') WHERE key = ?").run(o.key); resolved++; }
    return { fresh, resolved };
  }

  async function runAll({ source = 'cron', only = null } = {}) {
    const started = Date.now();
    const runId = Number(db.prepare('INSERT INTO sec_runs(status) VALUES (\'running\') RETURNING id').get().id);
    const prev = db.prepare("SELECT id FROM sec_runs WHERE status = 'ok' AND id < ? ORDER BY id DESC LIMIT 1").get(runId)?.id || null;
    const providers = { github, vercel, fly: flyio, cloudflare, mac };
    const notes = {}; const all = []; const uncheckedAll = []; const resolveAll = [];
    for (const [name, fn] of Object.entries(providers)) {
      if (only && !only.includes(name)) continue;
      try {
        const { obs, fnd, note, failed, unchecked, resolve } = await fn();
        if (Array.isArray(resolve)) resolveAll.push(...resolve);
        notes[name] = failed ? `failed: ${note || 'could not run'}` : (note || 'ok');   // a check that could not run resolves nothing
        if (Array.isArray(unchecked)) uncheckedAll.push(...unchecked);
        const insObs = db.prepare('INSERT OR REPLACE INTO sec_observations(run_id, provider, key, value) VALUES (?, ?, ?, ?)');
        for (const o of obs) insObs.run(runId, name, o.key, o.value);
        for (const f of fnd) all.push({ ...f, provider: name });
        for (const f of diffFindings(runId, prev, name, obs)) all.push({ ...f, provider: name });
      } catch (e) { notes[name] = `failed: ${e.message}`; all.push({ key: `${name}.failed`, provider: name, severity: 'INFO', title: `${name} check failed`, detail: e.message.slice(0, 200) }); log.warn('security provider failed', { name, err: e.message }); }
    }
    onlyProviders = only; failedProviders = Object.keys(notes).filter((n) => String(notes[n]).startsWith('failed')); uncheckedKeys = uncheckedAll; settledKeys = resolveAll; const { fresh, resolved } = upsertFindings(all); onlyProviders = null; failedProviders = []; uncheckedKeys = []; settledKeys = [];
    const ms = Date.now() - started;
    const summary = summarize({ fresh, resolved });
    db.prepare("UPDATE sec_runs SET finished_at = datetime('now'), status = 'ok', summary = ?, providers = ?, duration_ms = ? WHERE id = ?").run(summary.speak, JSON.stringify(notes), ms, runId);
    ctx.kv.set('security', 'last_run', { at: new Date().toISOString(), ms, fresh, resolved, counts: summary.counts, source });
    log.info('security sweep done', { ms, fresh, resolved, counts: summary.counts });
    return { ...summary, fresh, resolved, ms, notes };
  }

  function openFindings() { return db.prepare("SELECT * FROM sec_findings WHERE status = 'open' ORDER BY CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC, last_seen DESC").all(); }

  function summarize({ fresh = 0, resolved = 0 } = {}) {
    const open = openFindings();
    const counts = {}; for (const f of open) counts[f.severity] = (counts[f.severity] || 0) + 1;
    const top = open.filter((f) => SEV[f.severity] >= SEV.MEDIUM).slice(0, 5).map((f) => f.title);
    const actionable = open.filter((f) => SEV[f.severity] >= SEV.MEDIUM).length;
    let speak;
    if (!actionable) speak = `Security sweep clear: no critical, high or medium findings.${counts.LOW ? ` ${plural(counts.LOW, 'low item')} on file.` : ''}`;
    else speak = `Security: ${plural(actionable, 'finding')} need attention${counts.CRITICAL ? `, ${counts.CRITICAL} critical` : ''}${counts.HIGH ? `, ${counts.HIGH} high` : ''}${fresh ? `, ${fresh} new` : ''}. ${spokenList(top, { max: 4 })}.`;
    return { speak, counts, top, open: open.length, display: open };
  }

  const sevIcon = (s) => ({ CRITICAL: 'rotating_light', HIGH: 'warning', MEDIUM: 'eyes', LOW: 'information_source', INFO: 'information_source' }[s] || 'robot');

  return {
    id: 'security', name: 'Security Checker', aliases: ['sec'],
    description: "daily read-only checks on GitHub, Vercel, Fly, Cloudflare and this Mac's exposure, with change detection",
    migrations: MIGRATIONS,
    intents: [
      { name: 'run', description: 'run the security sweep now', examples: ['run the security check'], patterns: ['run (the )?security (check|sweep|scan)', 'security (check|sweep|scan)( now)?', 'check (my )?(security|infra(structure)?)', 'sweep (the )?infra(structure)?'] },
      { name: 'brief', description: 'current security posture', examples: ['security status'], patterns: ['security (status|brief|summary|posture|report)', 'any security (issues|problems|findings|alerts)', 'how (secure|safe) (are we|is everything)', "what's the security (status|situation)", 'am i secure'] },
      { name: 'detail', description: 'findings for one provider', examples: ['security details on GitHub'], patterns: ['security (details|findings) (on|for) {provider}', '(github|vercel|fly|cloudflare|mac|firewall) (security )?(findings|issues|status)', 'what did you find on {provider}'], slots: ['provider'] },
      { name: 'acknowledge', description: 'acknowledge all current findings so they stop being spoken', examples: ['acknowledge the security findings'], patterns: ['acknowledge (the |all )?(security )?findings', 'security findings (acknowledged|noted)', 'mute (the )?security findings'], write: true },
    ],
    routines: [
      { name: 'security.daily', cron: '0 7 * * *', description: 'daily sweep; ntfy push on critical/high', catchUpMinutes: 480, run: async () => { const r = await runAll(); const bad = openFindings().filter((f) => SEV[f.severity] >= SEV.HIGH && !f.acknowledged); return { summary: r.speak, notify: bad.length ? { push: { title: `KITT security: ${plural(bad.length, 'high finding')}`, body: bad.slice(0, 5).map((f) => `• ${f.title}`).join('\n'), tags: sevIcon(bad[0].severity), priority: bad.some((f) => f.severity === 'CRITICAL') ? 'urgent' : 'high' } } : undefined }; } },
      { name: 'security.weekly_email', cron: '15 7 * * 1', description: 'Monday email with the full findings table', catchUpMinutes: 0, run: async () => { const open = openFindings(); const rows = open.map((f) => `<tr><td>${f.severity}</td><td>${f.provider}</td><td>${esc(f.title)}</td><td>${esc(f.detail || '')}</td><td>${f.first_seen}</td></tr>`).join(''); return { summary: `${open.length} open findings emailed`, notify: { email: { subject: `KITT weekly security report — ${open.length} open findings`, html: `<p>Open findings as of ${new Date().toUTCString()}.</p><table border="1" cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px"><tr><th>Severity</th><th>Provider</th><th>Finding</th><th>Detail</th><th>First seen</th></tr>${rows}</table>` } } }; } },
    ],
    async handle(intent, slots, c) {
      if (intent === 'run') {
        if (c.source === 'cli') { const r = await runAll({ source: 'cli' }); return { speak: `${r.speak} Sweep took ${Math.round(r.ms / 1000)} seconds.`, display: r }; }
        if (running) return { speak: 'A sweep is already running. Ask for the security status in a minute.' };
        running = runAll({ source: c.source }).catch((e) => log.warn('sweep failed', { err: e.message })).finally(() => { running = null; });
        return { speak: 'Running the security sweep now. It takes a couple of minutes; say security status when you want the result.' };
      }
      if (intent === 'brief') { const last = ctx.kv.get('security', 'last_run'); if (!last) return { speak: "I haven't run a security sweep yet. Say 'run the security check'." }; const s = summarize(); return { speak: `${s.speak} Last sweep ${relTime(last.at)}.`, display: s.display }; }
      if (intent === 'detail') { const p = String(slots.provider || c.norm || '').toLowerCase().replace(/\.io|\s/g, ''); const prov = p.includes('firewall') ? 'mac' : ['github', 'vercel', 'fly', 'cloudflare', 'mac'].find((x) => p.includes(x)); const rows = openFindings().filter((f) => !prov || f.provider === prov); if (!rows.length) return { speak: `Nothing open${prov ? ` on ${prov}` : ''}.` }; return { speak: `${plural(rows.length, 'finding')}${prov ? ` on ${prov}` : ''}: ${spokenList(rows.map((f) => `${f.severity.toLowerCase()}: ${f.title}`), { max: 6 })}.`, display: rows }; }
      if (intent === 'acknowledge') return { speak: `Acknowledge ${plural(openFindings().length, 'open finding')} so they are not repeated in briefs?`, confirm: { summary: 'acknowledge all open security findings', action: { type: 'ack_all' } } };
      return { speak: "I didn't catch which security question that was." };
    },
    async execute(action) { if (action.type === 'ack_all') { const n = db.prepare("UPDATE sec_findings SET acknowledged = 1 WHERE status = 'open'").run().changes; return { speak: `Acknowledged ${plural(n, 'finding')}. New ones will still be spoken.` }; } return { speak: 'Unknown action.' }; },
    async brief({ kind }) {
      const last = ctx.kv.get('security', 'last_run'); if (!last) return kind === 'morning' ? { speak: 'Security: no sweep yet.' } : null;
      const open = openFindings().filter((f) => !f.acknowledged && SEV[f.severity] >= SEV.MEDIUM);
      if (!open.length) return kind === 'morning' ? { speak: 'Security is clear.' } : null;
      return { speak: `Security: ${plural(open.length, 'finding')}, top: ${spokenList(open.slice(0, 2).map((f) => f.title), { max: 2 })}.`, decisions: open.length };
    },
    async view() { return { last_run: ctx.kv.get('security', 'last_run'), ...summarize(), findings: openFindings() }; },
    async health() { const last = ctx.kv.get('security', 'last_run'); const ok = fs.existsSync(BIN.gh) && fs.existsSync(BIN.vercel); return { ok, detail: `${ok ? 'gh+vercel present' : 'gh or vercel missing'}${fs.existsSync(BIN.flyctl) ? ', flyctl present' : ', flyctl missing'}${secrets.KITT_CLOUDFLARE_TOKEN ? ', cloudflare token set' : ', cloudflare token not set'}; last run ${last ? last.at : 'never'}` }; },
    async dashboard() { const open = openFindings(); const rows = open.map((f) => `<tr><td class="${SEV[f.severity] >= 3 ? 'bad' : ''}">${f.severity}</td><td>${f.provider}</td><td>${esc(f.title)}</td><td>${esc(f.detail || '')}</td><td>${f.first_seen}</td><td>${f.acknowledged ? 'yes' : ''}</td></tr>`).join(''); const last = ctx.kv.get('security', 'last_run'); return `<p>Last sweep: ${last ? `${esc(last.at)} (${Math.round(last.ms / 1000)} s)` : 'never'}. Open findings: ${open.length}.</p><table><tr><th>Severity</th><th>Provider</th><th>Finding</th><th>Detail</th><th>First seen</th><th>Ack</th></tr>${rows}</table>`; },
    _internal: { runAll, summarize, openFindings, diffFindings, upsertFindings },
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function relTime(iso) { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (m < 2) return 'just now'; if (m < 60) return `${m} minutes ago`; const h = Math.round(m / 60); if (h < 36) return `${h} hours ago`; return `${Math.round(h / 24)} days ago`; }
