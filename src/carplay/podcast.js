// Private podcast feed: briefs rendered to audio with macOS `say` → afconvert (AAC .m4a). Apple Podcasts / Overcast follow the feed URL
// and the episodes appear in CarPlay like any show. Siri Shortcuts remain the interactive channel; this is the passive one.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { log } from '../log.js';

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-200)}`)); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

export function createPodcast(app) {
  const { paths, config, db } = app;
  db.exec(`CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT, file TEXT NOT NULL, bytes INTEGER NOT NULL, duration_s INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const voice = config.voice?.say_voice || 'Daniel';

  /** Render spoken text to an .m4a episode; returns the episode row. */
  async function render({ slug, title, text, description }) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const base = `${slug}-${stamp}`;
    const aiff = path.join(paths.audioDir, `${base}.aiff`); const m4a = path.join(paths.audioDir, `${base}.m4a`);
    const txt = path.join(paths.audioDir, `${base}.txt`);
    fs.writeFileSync(txt, text, 'utf8');
    await run('/usr/bin/say', ['-v', voice, '-r', '175', '-o', aiff, '-f', txt]);
    await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', aiff, m4a]);
    fs.rmSync(aiff, { force: true }); fs.rmSync(txt, { force: true });
    const bytes = fs.statSync(m4a).size;
    const duration = Math.round(text.split(/\s+/).length / 2.9);
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
