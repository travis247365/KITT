// Private podcast feed: briefs rendered to audio with macOS `say` → afconvert (AAC .m4a). Apple Podcasts / Overcast follow the feed URL
// and the episodes appear in CarPlay like any show. Siri Shortcuts remain the interactive channel; this is the passive one.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { log } from '../log.js';

// `say` normally takes a few seconds, but right after the Mac wakes it competes with every catch-up routine and the speech daemon
// (6 Nov 2026: killed at 120 s, no episode, a partial .aiff left behind). Audio is not time-critical: give it ten minutes and one retry.
const SAY_TIMEOUT_MS = 600000;
const CONVERT_TIMEOUT_MS = 180000;
const SAY_RETRY_DELAY_MS = 5000;

function run(cmd, args, timeoutMs = 120000, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; let out = ''; let killed = false;
    const t = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { if (capture) out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${killed ? `killed after ${Math.round(timeoutMs / 1000)}s` : `exit ${code}`}: ${err.slice(-200)}`));
    });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The length in whole seconds from `afinfo` output ("estimated duration: 45.828209 sec"), or null when it says nothing usable. */
export function parseAfinfoDuration(text) {
  const m = /estimated duration:\s*([0-9.]+)\s*sec/i.exec(String(text || ''));
  if (!m) return null;
  const s = Number(m[1]);
  return Number.isFinite(s) && s > 0 ? Math.round(s) : null;
}

/** Fallback when the audio cannot be measured: 175 wpm speech is about 2.9 words a second. */
export function estimateDuration(text) {
  return Math.round(String(text || '').split(/\s+/).filter(Boolean).length / 2.9);
}

export function createPodcast(app) {
  const { paths, config, db } = app;
  db.exec(`CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT, file TEXT NOT NULL, bytes INTEGER NOT NULL, duration_s INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const voice = config.voice?.say_voice || 'Daniel';

  /** Render spoken text to an .m4a episode; returns the episode row. Partial files never survive a failure. */
  async function render({ slug, title, text, description }) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const base = `${slug}-${stamp}`;
    const aiff = path.join(paths.audioDir, `${base}.aiff`); const m4a = path.join(paths.audioDir, `${base}.m4a`);
    const txt = path.join(paths.audioDir, `${base}.txt`);
    const discard = () => { for (const f of [aiff, txt]) fs.rmSync(f, { force: true }); };
    try {
      fs.writeFileSync(txt, text, 'utf8');
      try {
        await run('/usr/bin/say', ['-v', voice, '-r', '175', '-o', aiff, '-f', txt], SAY_TIMEOUT_MS);
      } catch (e) {
        log.warn('say failed, retrying once', { slug, err: e.message });
        fs.rmSync(aiff, { force: true });
        await sleep(SAY_RETRY_DELAY_MS);
        await run('/usr/bin/say', ['-v', voice, '-r', '175', '-o', aiff, '-f', txt], SAY_TIMEOUT_MS);
      }
      await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', aiff, m4a], CONVERT_TIMEOUT_MS);
    } catch (e) {
      discard(); fs.rmSync(m4a, { force: true });
      throw e;
    }
    discard();
    const bytes = fs.statSync(m4a).size;
    let duration = null;
    try { duration = parseAfinfoDuration(await run('/usr/bin/afinfo', [m4a], 30000, { capture: true })); } catch (e) { log.warn('afinfo failed; estimating the length', { slug, err: e.message }); }
    if (!duration) duration = estimateDuration(text);
    db.prepare('INSERT INTO episodes(slug, title, description, file, bytes, duration_s) VALUES (?, ?, ?, ?, ?, ?)').run(slug, title, (description || text).slice(0, 4000), path.basename(m4a), bytes, duration);
    prune(30);
    log.info('episode rendered', { slug, bytes, duration });
    return { file: path.basename(m4a), bytes, duration };
  }

  function prune(keep) {
    const old = db.prepare('SELECT id, file FROM episodes ORDER BY id DESC LIMIT -1 OFFSET ?').all(keep);
    for (const e of old) { fs.rmSync(path.join(paths.audioDir, e.file), { force: true }); db.prepare('DELETE FROM episodes WHERE id = ?').run(e.id); }
  }

  function rss(base) {
    const eps = db.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 30').all();
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const items = eps.map((e) => `<item><title>${esc(e.title)}</title><description>${esc(e.description)}</description><guid isPermaLink="false">kitt-${e.id}</guid><pubDate>${new Date(e.created_at.replace(' ', 'T') + 'Z').toUTCString()}</pubDate><enclosure url="${esc(base)}/audio/${esc(e.file)}" length="${e.bytes}" type="audio/mp4"/><itunes:duration>${e.duration_s || 0}</itunes:duration></item>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>KITT Briefings</title><link>${esc(base)}/kitt.xml</link><language>en-gb</language><description>Private daily briefings from KITT for Travis.</description><itunes:author>KITT</itunes:author><itunes:block>Yes</itunes:block><itunes:explicit>false</itunes:explicit>
${items}
</channel></rss>`;
  }

  return { render, rss, list: () => db.prepare('SELECT id, slug, title, file, bytes, duration_s, created_at FROM episodes ORDER BY id DESC LIMIT 30').all() };
}
