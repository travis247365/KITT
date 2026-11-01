// LLM brain via the Claude Code CLI (`claude -p`) — runs under Travis's Max subscription, no API key.
// Verified 2026-10-26: --setting-sources "" --strict-mcp-config --tools "" keeps context to ~1.4k tokens;
// `--bare` must NOT be used (it skips credential loading and returns "Not logged in").
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { log } from '../log.js';

const BIN = process.env.KITT_CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');

export class BrainError extends Error {
  constructor(message, kind = 'error', extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

function classifyError(text) {
  const t = String(text || '');
  if (/not logged in|please run \/login|authentication/i.test(t)) return 'auth';
  if (/usage limit|rate limit|too many requests|overloaded|429|capacity/i.test(t)) return 'rate_limit';
  if (/timeout/i.test(t)) return 'timeout';
  return 'error';
}

export function createClaudeCli({ brainDir, defaultModel = 'claude-haiku-5-5', timeoutMs = 90000 }) {
  function cleanEnv() {
    return { PATH: `${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: os.homedir(), USER: os.userInfo().username, LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1' };
  }

  /**
   * @param {object} o
   * @param {string} o.prompt        user turn (stdin)
   * @param {string} [o.system]      full system prompt (replaces Claude Code's default)
   * @param {object} [o.schema]      JSON schema → result.structured
   * @param {string} [o.model]
   * @param {string} [o.resume]      session id to continue
   * @param {string} [o.sessionId]   force a new session id (uuid)
   * @param {boolean} [o.persist]    keep the session on disk (default false)
   */
  function complete({ prompt, system, schema, model, resume, sessionId, persist = false, maxTurns = 1, effort, timeoutMs: t = timeoutMs }) {
    const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns), '--strict-mcp-config', '--setting-sources', '', '--tools', '', '--model', model || defaultModel];
    if (!persist && !resume && !sessionId) args.push('--no-session-persistence');
    if (resume) args.push('--resume', resume);
    if (sessionId) args.push('--session-id', sessionId);
    if (system) args.push('--system-prompt', system);
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (effort) args.push('--effort', effort);
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(BIN, args, { cwd: brainDir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; let err = ''; let killed = false;
      const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, t);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(new BrainError(`claude spawn failed: ${e.message}`, 'spawn')); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const ms = Date.now() - started;
        if (killed) return reject(new BrainError(`claude -p timed out after ${t} ms`, 'timeout', { ms }));
        let parsed = null;
        try { parsed = JSON.parse(out.trim()); } catch { /* maybe stream noise */ }
        if (!parsed) {
          const kind = classifyError(out + err);
          return reject(new BrainError(`claude -p exit ${code}: ${(err || out).trim().slice(-300)}`, kind, { ms }));
        }
        if (parsed.is_error) {
          const kind = classifyError(parsed.result);
          return reject(new BrainError(String(parsed.result).slice(0, 300), kind, { ms }));
        }
        log.debug('brain call', { ms, api_ms: parsed.duration_api_ms, cost: parsed.total_cost_usd, model: model || defaultModel });
        resolve({ text: parsed.result ?? '', structured: parsed.structured_output ?? null, sessionId: parsed.session_id, costUsd: parsed.total_cost_usd, ms, apiMs: parsed.duration_api_ms, provider: 'claude-cli' });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
  }

  return { name: 'claude-cli', complete };
}
