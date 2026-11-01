// Shared runner for the CLIs KITT leans on (gh, vercel, flyctl). Clean env, timeouts, JSON parsing, never throws on exit code.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
export const BIN = {
  gh: process.env.KITT_GH_BIN || '/opt/homebrew/bin/gh',
  vercel: process.env.KITT_VERCEL_BIN || '/opt/homebrew/bin/vercel',
  flyctl: process.env.KITT_FLYCTL_BIN || path.join(HOME, '.fly', 'bin', 'flyctl'),
  firecrawl: process.env.KITT_FIRECRAWL_BIN || '/opt/homebrew/bin/firecrawl',
};

export function run(cmd, args, { timeoutMs = 60000, env = {}, input, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { PATH: `/Library/Developer/CommandLineTools/usr/bin:${path.join(HOME, '.local', 'bin')}:${path.join(HOME, '.fly', 'bin')}:/opt/homebrew/bin:/usr/bin:/bin`, HOME, USER: os.userInfo().username, LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = ''; let timedOut = false;
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: `${err}\n${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err, timedOut }); });
    child.stdin.on('error', () => {});
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

export function parseJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* fall through */ }
  const i = Math.min(...['{', '['].map((c) => { const k = t.indexOf(c); return k < 0 ? Infinity : k; }));
  if (!Number.isFinite(i)) return null;
  try { return JSON.parse(t.slice(i)); } catch { return null; }
}

/** gh api wrapper: returns {status, body} where status is parsed from `gh api -i` when available. */
export async function ghApi(endpoint, { method = 'GET', fields = [], timeoutMs = 60000 } = {}) {
  const args = ['api', '-i', '-X', method, endpoint, ...fields.flatMap((f) => ['-f', f])];
  const { code, out, err, timedOut } = await run(BIN.gh, args, { timeoutMs });
  const m = /^HTTP\/[\d.]+\s+(\d{3})/m.exec(out);
  const status = m ? Number(m[1]) : (code === 0 ? 200 : 0);
  const bodyStart = out.indexOf('\r\n\r\n') >= 0 ? out.indexOf('\r\n\r\n') + 4 : out.indexOf('\n\n') + 2;
  const body = parseJson(bodyStart > 1 ? out.slice(bodyStart) : out);
  return { status, body, err: err.trim(), timedOut };
}

export async function vercelApi(pathname, { scope, timeoutMs = 60000 } = {}) {
  const args = ['api', pathname]; if (scope) args.push('--scope', scope);
  const { code, out, err, timedOut } = await run(BIN.vercel, args, { timeoutMs });
  return { ok: code === 0 && !timedOut, body: parseJson(out), err: err.trim(), timedOut };
}

export async function fly(args, { timeoutMs = 60000 } = {}) {
  const { code, out, err, timedOut } = await run(BIN.flyctl, [...args, '--json'], { timeoutMs });
  return { ok: code === 0 && !timedOut, body: parseJson(out), err: err.trim(), timedOut };
}
