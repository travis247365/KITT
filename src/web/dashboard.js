// Minimal status dashboard (TPCL light mode: white, charcoal text, amber accent, Poppins if installed). No data from skills yet beyond health.
import { tailAudit } from '../audit.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function renderDashboard(app) {
  const h = await app.health();
  const audit = tailAudit(app.db, 25);
  const skillRows = Object.entries(h.skills).map(([id, s]) => `<tr><td>${esc(id)}</td><td class="${s.ok ? 'ok' : 'bad'}">${s.ok ? 'OK' : (s.unavailable ? 'unavailable' : 'attention')}</td><td>${esc(s.detail || '')}</td></tr>`).join('');
  const routineRows = h.routines.map((r) => `<tr><td>${esc(r.name)}</td><td><code>${esc(r.cron)}</code></td><td>${esc(r.last_run_at || 'never')}</td><td class="${r.last_status === 'error' ? 'bad' : ''}">${esc(r.last_status || '')}</td><td>${esc((r.last_summary || '').slice(0, 120))}</td></tr>`).join('');
  const auditRows = audit.map((a) => `<tr><td>${esc(a.ts)}</td><td>${esc(a.source)}</td><td>${esc(a.skill || '')}.${esc(a.intent || '')}</td><td class="${a.outcome === 'error' ? 'bad' : ''}">${esc(a.outcome)}</td><td>${esc((a.input || '').slice(0, 80))}</td><td>${esc(a.latency_ms ?? '')}</td></tr>`).join('');
  const skillPanels = [];
  for (const s of app.skillList) if (typeof s.dashboard === 'function') { try { skillPanels.push(`<section><h2>${esc(s.name)}</h2>${await s.dashboard(app)}</section>`); } catch (e) { skillPanels.push(`<section><h2>${esc(s.name)}</h2><p class="bad">${esc(e.message)}</p></section>`); } }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KITT</title>
<style>
:root{--ink:#3A3A3A;--bg:#FFFFFF;--amber:#FFC107;--cyan:#00BCD4;--mute:#B8C5D6;--ok:#1b7f3b;--bad:#b00020}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Poppins,-apple-system,Helvetica,Arial,sans-serif;padding:24px 16px;max-width:1200px;margin-inline:auto}
.accent{width:48px;height:12px;background:var(--amber);margin-bottom:14px}h1{font-weight:700;margin:0 0 4px;font-size:28px}h2{font-size:18px;font-weight:500;margin:28px 0 8px}
.sub{color:#666;margin:0 0 18px}table{width:100%;border-collapse:collapse;margin:6px 0 10px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;font-size:14px}th{font-weight:500;color:#555}
.ok{color:var(--ok)}.bad{color:var(--bad);font-weight:500}code{font:13px ui-monospace,Menlo,monospace;background:#f4f6f8;padding:1px 4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.tile{border:1px solid #e6e6e6;padding:12px}.tile b{display:block;font-size:22px;font-weight:700}
@media (max-width:600px){body{padding:16px 12px}h1{font-size:22px}}
</style></head><body>
<div class="accent"></div><h1>KITT</h1><p class="sub">Version ${esc(h.version)} · brain ${h.brain.ok ? 'ready' : 'unavailable'} (${esc(h.brain.detail || h.brain.provider || '')}) · push ${h.notifier.push ? 'on' : 'off'} · email ${h.notifier.email ? 'on' : 'off'} · Composio ${h.composio ? 'present' : 'missing'}</p>
<div class="grid"><div class="tile"><span>Skills loaded</span><b>${app.skillList.length}</b></div><div class="tile"><span>Unavailable</span><b>${app.failures.length}</b></div><div class="tile"><span>Pending confirmations</span><b>${h.pending.length}</b></div><div class="tile"><span>Routines</span><b>${h.routines.length}</b></div></div>
<h2>Skills</h2><table><tr><th>Skill</th><th>State</th><th>Detail</th></tr>${skillRows}</table>
${skillPanels.join('\n')}
<h2>Routines</h2><table><tr><th>Name</th><th>Cron</th><th>Last run (UTC)</th><th>Status</th><th>Summary</th></tr>${routineRows}</table>
<h2>Recent commands</h2><table><tr><th>Time (UTC)</th><th>Source</th><th>Intent</th><th>Outcome</th><th>Input</th><th>ms</th></tr>${auditRows}</table>
</body></html>`;
}
