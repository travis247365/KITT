// Writing ONE secret into the chmod-600 env file without ever printing it, plus a login check for the board password.
import fs from 'node:fs';
import path from 'node:path';

/** Secrets the CLI is allowed to set (kitt secret set NAME). Tokens that gate the hub itself use `kitt token new`. */
export const SETTABLE = ['KITT_COO_PASSWORD', 'KITT_COO_EMAIL', 'KITT_COO_BASE_URL', 'KITT_CLOUDFLARE_TOKEN', 'KITT_ANTHROPIC_API_KEY', 'KITT_EMAIL_TO'];

/** Return env-file text with KEY set to value: replace the first assignment, drop duplicates, append when absent. */
export function setEnvValue(text, key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('bad key');
  if (/[\r\n\0]/.test(value)) throw new Error('value must be a single line');
  if (!value) throw new Error('empty value');
  // parseEnvFile() trims and strips one pair of matching quotes, so only quote when that would change the value.
  let v = value;
  if (value !== value.trim() || /^(['"]).*\1$/.test(value)) {
    if (!value.includes('"')) v = `"${value}"`;
    else if (!value.includes("'")) v = `'${value}'`;
    else throw new Error('value has edge spaces or quotes plus both quote kinds; cannot store it safely');
  }
  const out = []; let done = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (m && m[1] === key) { if (!done) { out.push(`${key}=${v}`); done = true; } continue; }
    out.push(raw);
  }
  if (!done) { while (out.length && out[out.length - 1] === '') out.pop(); out.push(`${key}=${v}`); }
  return out.join('\n').replace(/\n*$/, '\n');
}

/** Atomically write the secret (temp file, mode 600, rename) and keep ONE previous copy as .bak (also mode 600). */
export function writeSecret(envFile, key, value) {
  fs.mkdirSync(path.dirname(envFile), { recursive: true, mode: 0o700 });
  let before = ''; try { before = fs.readFileSync(envFile, 'utf8'); } catch { /* new file */ }
  const next = setEnvValue(before, key, value);
  if (before) { fs.writeFileSync(`${envFile}.bak`, before, { mode: 0o600 }); fs.chmodSync(`${envFile}.bak`, 0o600); }
  const tmp = `${envFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, { mode: 0o600 }); fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, envFile);
}

/** Names that are set in the env file (never values). */
export function listSecretNames(envFile) {
  let t = ''; try { t = fs.readFileSync(envFile, 'utf8'); } catch { return []; }
  return [...t.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*\S/gm)].map((m) => m[1]);
}

/**
 * Try the board login exactly as the Chief of Staff skill does. With an email it uses the account sign-in (/api/auth/login),
 * without one the shared team password (/api/login). Returns { ok, role?, status?, error?, via } and never the cookie.
 */
export async function checkBoardLogin(base, password, { email = '', fetchImpl = fetch } = {}) {
  const via = email ? 'account' : 'team password';
  try {
    const r = await fetchImpl(`${String(base).replace(/\/$/, '')}${email ? '/api/auth/login' : '/api/login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(email ? { email, password } : { password }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, status: r.status, via };
    const j = await r.json().catch(() => ({}));
    return { ok: true, role: j.role || 'member', via };
  } catch (e) { return { ok: false, error: e.message, via }; }
}

/** Read a value without echo from a TTY (paste works). Resolves with the typed text; rejects on Ctrl-C. */
export function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(); return resolve(buf); }
        if (ch === '\u0003') { finish(); return reject(new Error('cancelled')); }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Read all of piped stdin (for `pbpaste | kitt secret set NAME`). */
export async function readStdin() {
  let s = ''; process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, '');
}
