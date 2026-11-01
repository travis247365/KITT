// Thin wrapper over the Composio CLI (managed OAuth for Gmail, Calendar, GitHub, Notion, Instagram, OneNote...).
// We shell out rather than embed an SDK: the CLI already holds Travis's session and tool schemas.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { log } from './log.js';

const BIN = process.env.KITT_COMPOSIO_BIN || path.join(os.homedir(), '.local', 'bin', 'composio');

export class ComposioError extends Error {
  constructor(message, { slug, code, stderr, needsLink } = {}) { super(message); this.slug = slug; this.code = code; this.stderr = stderr; this.needsLink = needsLink; }
}

export function composioAvailable() { try { fs.accessSync(BIN, fs.constants.X_OK); return true; } catch { return false; } }

function run(args, { timeoutMs = 60000, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { env: { PATH: `${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: os.homedir(), LANG: 'en_US.UTF-8', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); err += '\n[kitt] timeout'; }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: err + e.message }); });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

function parseJsonLoose(text) {
  const t = text.trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* ignore */ } }
  return null;
}

/**
 * Execute a Composio tool. Returns the tool's `data` payload (or the whole parsed object when no data key).
 * Throws ComposioError with needsLink=true when the toolkit is not connected.
 */
export async function execute(slug, params = {}, { timeoutMs = 60000, account } = {}) {
  const args = ['execute', slug, '-d', '-'];
  if (account) args.push('--account', account);
  const started = Date.now();
  const { code, out, err } = await run(args, { timeoutMs, input: JSON.stringify(params) });
  let parsed = parseJsonLoose(out);
  // Large results are written to a temp file by the CLI ({storedInFile:true, outputFilePath}); read them back.
  if (parsed && parsed.storedInFile && parsed.outputFilePath) {
    try { const full = JSON.parse(fs.readFileSync(parsed.outputFilePath, 'utf8')); parsed = { ...parsed, ...(full && typeof full === 'object' ? full : { data: full }) }; if (parsed.data === undefined && full && full.data !== undefined) parsed.data = full.data; }
    catch (e) { log.warn('composio stored output unreadable', { slug, file: parsed.outputFilePath, err: e.message }); }
  }
  const ms = Date.now() - started;
  const combined = `${out}\n${err}`;
  const needsLink = /not connected|no connected account|composio link|connect(ed)? account.*(missing|required)|EXPIRED/i.test(combined);
  if (code !== 0 || !parsed || parsed.successful === false || parsed.error) {
    const msg = parsed?.error || err.trim().split('\n').slice(-3).join(' ') || `composio exit ${code}`;
    log.warn('composio failed', { slug, code, ms, msg: String(msg).slice(0, 300) });
    throw new ComposioError(String(msg).slice(0, 500), { slug, code, stderr: err.slice(-800), needsLink });
  }
  log.debug('composio ok', { slug, ms });
  return parsed.data !== undefined ? parsed.data : parsed;
}

export async function schema(slug) {
  const { code, out } = await run(['execute', slug, '--get-schema'], { timeoutMs: 60000 });
  if (code !== 0) throw new ComposioError(`schema fetch failed for ${slug}`, { slug, code });
  return parseJsonLoose(out);
}

export async function connections() {
  const { code, out } = await run(['connections', 'list'], { timeoutMs: 60000 });
  if (code !== 0) throw new ComposioError('connections list failed', { code });
  const parsed = parseJsonLoose(out) || {};
  const result = {};
  for (const [toolkit, arr] of Object.entries(parsed)) result[toolkit] = Array.isArray(arr) && arr[0] ? arr[0].status : 'UNKNOWN';
  return result;
}

export async function search(useCase) {
  const { code, out } = await run(['search', useCase], { timeoutMs: 60000 });
  if (code !== 0) throw new ComposioError('search failed', { code });
  return parseJsonLoose(out);
}
