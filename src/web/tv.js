// Always-on, big-screen view for a TV or a propped-up laptop. Separate from /dashboard on purpose:
// this reads only the cheap, already-computed app.state() (same data as /v1/state) — never the
// per-skill dashboard panels, which make live calls and took the admin dashboard ~27s to render.
// Rendered HTML must also run on a 2017 webOS TV browser if proxied there: ES5 only, flexbox only,
// no CSS custom properties, no blur, animate transform/opacity only. See lgtv-vibehack/CLAUDE.md.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function latestBrief(briefs) {
  const entries = Object.entries(briefs || {});
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const [kind, b] = entries[0];
  return { kind, at: b.at, text: b.text };
}

export async function renderTV(app) {
  const s = await app.state();
  const brief = latestBrief(s.briefs);
  const skillEntries = Object.entries(s.skills || {});
  const unhealthy = skillEntries.filter(([, v]) => v && v.ok === false);
  const allOk = unhealthy.length === 0 && (s.unavailable || []).length === 0;
  const pendingN = (s.pending || []).length;
  const cov = s.coverage || {};

  const problemRows = unhealthy
    .map(([id, v]) => `<div class="prob">${esc(v.name || id)} — ${esc(v.detail || 'needs attention')}</div>`)
    .join('');
  const unavailRows = (s.unavailable || [])
    .map((f) => `<div class="prob">${esc(f.id || f.name || String(f))} failed to load</div>`)
    .join('');

  const briefBlock = brief
    ? `<p class="brief-text">${esc(brief.text)}</p><p class="brief-meta">${esc(brief.kind)} brief · as of ${esc(new Date(brief.at).toLocaleString('en-ZM', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }))}</p>`
    : `<p class="brief-text muted">No brief generated yet.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>KITT</title>
<style>
html,body{margin:0;padding:0;background:#050507;color:#f2f2f2;height:100%;font-family:Poppins,-apple-system,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
.wrap{display:flex;flex-direction:column;justify-content:space-between;min-height:100vh;padding:48px 64px}
.top{display:flex;flex-direction:row;justify-content:space-between;align-items:flex-start}
.brand{display:flex;flex-direction:row;align-items:center}
.dot{width:14px;height:14px;background:#FFC107;margin-right:14px}
.brand h1{font-size:28px;font-weight:700;margin:0;letter-spacing:2px}
.clockwrap{text-align:right}
#clock{font-size:56px;font-weight:700;line-height:1}
#date{font-size:18px;color:#B8C5D6;margin-top:4px}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:1100px}
.brief-text{font-size:34px;line-height:1.45;font-weight:500;margin:0}
.brief-text.muted{color:#777}
.brief-meta{font-size:16px;color:#8a97ab;margin-top:16px}
.bottom{display:flex;flex-direction:row;justify-content:space-between;align-items:flex-end;flex-wrap:wrap}
.status{display:flex;flex-direction:row;align-items:center}
.status .pill{padding:8px 16px;font-size:16px;font-weight:600;margin-right:16px}
.pill.ok{background:#123420;color:#3ddc97}
.pill.bad{background:#3a1420;color:#ff6b6b}
.pill.warn{background:#3a2e10;color:#FFC107}
.probs{max-width:420px;text-align:right}
.prob{font-size:14px;color:#ff9a9a;margin-bottom:4px}
.footer{font-size:13px;color:#555;margin-top:16px}
@media (max-width:900px){.wrap{padding:28px 24px}.brief-text{font-size:24px}#clock{font-size:40px}}
</style></head>
<body><div class="wrap">
  <div class="top">
    <div class="brand"><div class="dot"></div><h1>KITT</h1></div>
    <div class="clockwrap"><div id="clock">--:--</div><div id="date"></div></div>
  </div>
  <div class="mid">${briefBlock}</div>
  <div class="bottom">
    <div class="status">
      <div class="pill ${allOk ? 'ok' : 'bad'}">${allOk ? 'All systems nominal' : (unhealthy.length + (s.unavailable || []).length) + ' need attention'}</div>
      ${pendingN > 0 ? `<div class="pill warn">${pendingN} pending confirmation${pendingN === 1 ? '' : 's'}</div>` : ''}
      ${cov.days ? `<div class="pill ${cov.uptime_pct >= 80 ? 'ok' : 'warn'}">coverage ${esc(cov.uptime_pct)}% (${esc(cov.days)}d)</div>` : ''}
    </div>
    <div class="probs">${problemRows}${unavailRows}</div>
  </div>
  <div class="footer">v${esc(s.version)} · brain ${s.brain && s.brain.ok ? 'ready' : 'unavailable'} · refreshes every 60s</div>
</div>
<script>
function tick(){
  var d=new Date();
  var c=document.getElementById('clock'); if(c) c.textContent=d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  var dt=document.getElementById('date'); if(dt) dt.textContent=d.toLocaleDateString([], {weekday:'long',day:'numeric',month:'long'});
}
tick();
setInterval(tick, 1000);
</script>
</body></html>`;
}
