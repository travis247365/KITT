// Builds and signs the Siri Shortcuts for the iPhone/CarPlay (delegates to scripts/build_shortcuts.py, which uses plistlib).
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadConfig, REPO_DIR } from '../config.js';

export async function buildAll({ baseUrl } = {}) {
  const { config, secrets, paths } = loadConfig();
  const base = baseUrl || config.server?.public_base_url;
  if (!base) throw new Error('public base URL unknown: pass it (kitt shortcuts build https://xxx.ngrok-free.dev) or set server.public_base_url in ~/.config/kitt/kitt.json');
  const token = secrets.KITT_APP_TOKEN || secrets.KITT_TOKEN; // the phone carries the app token (no admin scope)
  if (!token) throw new Error('KITT_APP_TOKEN missing — run: kitt token new app');
  const script = path.join(REPO_DIR, 'scripts', 'build_shortcuts.py');
  const args = [script, paths.shortcutsDir, base, token];
  if (secrets.KITT_FEED_TOKEN) args.push(secrets.KITT_FEED_TOKEN);
  const out = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-I', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; let e = '';
    child.stdout.on('data', (d) => { o += d; }); child.stderr.on('data', (d) => { e += d; });
    child.on('close', (code) => (code === 0 ? resolve(o) : reject(new Error(`build_shortcuts.py exit ${code}: ${e.slice(-400)}`))));
    child.on('error', reject);
  });
  const manifest = JSON.parse(out);
  fs.writeFileSync(path.join(paths.shortcutsDir, 'README.md'), readme(manifest), 'utf8');
  return manifest.shortcuts.map((s) => ({ status: s.signed ? 'signed' : `UNSIGNED (${s.error})`, file: s.file, name: s.name }));
}

function readme(m) {
  return `# KITT Siri Shortcuts

Base URL: ${m.base_url}
${m.feed_url ? `Podcast feed (Apple Podcasts → Follow a Show by URL): ${m.feed_url}\n` : ''}
## Install on the iPhone
1. AirDrop each \`*.signed.shortcut\` to the iPhone (or put them in iCloud Drive and open from Files) → **Add Shortcut**.
2. In Shortcuts, open each one once and tap the **i** → turn OFF "Ask Before Running" where offered.
3. Say **"Hey Siri, Kit"** (free-form), **"Kit Brief"**, **"Kit Plate"**, **"Kit Idea"**, **"Kit Confirm"**, **"Kit More"**.
4. Money SMS relay: Shortcuts → Automation → **Message** → *When I get a message from* MTNMoMo (then Airtel Money, FNB, Stanbic) → **Run Immediately** → Run Shortcut **Kit SMS Relay** with input *Shortcut Input*.

The bearer token is embedded in these files: do not share them. Rebuild with \`kitt shortcuts build\` after rotating the token.

${m.shortcuts.map((s) => `- ${s.name}: ${s.signed ? 'signed' : 'NOT signed (' + s.error + ')'}`).join('\n')}
`;
}
