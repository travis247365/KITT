// KITT configuration: non-secret defaults (repo) + personal config + secrets (chmod-600 env file).
// Nothing here is ever logged; use redact() from log.js before printing anything derived from secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(HERE, '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'package.json'), 'utf8')).version;

export const CONFIG_DIR = process.env.KITT_CONFIG_DIR || path.join(os.homedir(), '.config', 'kitt');
export const DATA_DIR = process.env.KITT_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'kitt');
export const LOG_DIR = process.env.KITT_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs');

/** Parse a KEY=VALUE env file (comments, blank lines, optional single/double quotes). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function readJsonIfExists(p) {
  const t = readIfExists(p);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (e) { throw new Error(`invalid JSON in ${p}: ${e.message}`); }
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || typeof over !== 'object' || !base || !over) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}

/** Warn (once) if a secrets file is readable by group/others. */
function checkMode(p, warn) {
  try {
    const mode = fs.statSync(p).mode & 0o777;
    if (mode & 0o077) warn(`${p} is mode ${mode.toString(8)}; expected 600`);
  } catch { /* missing is fine */ }
}

/**
 * Load everything. Secrets precedence: KITT env file > process.env (only for KITT_* keys) >
 * shared files already on disk (~/.config/bdl/resend.env, ~/.config/tpcl-alerts.conf).
 */
export function loadConfig({ warn = () => {} } = {}) {
  const defaults = readJsonIfExists(path.join(REPO_DIR, 'config', 'defaults.json')) || {};
  const personal = readJsonIfExists(path.join(CONFIG_DIR, 'kitt.json')) || {};
  const config = deepMerge(defaults, personal);

  const secrets = {};
  const shared = [
    path.join(os.homedir(), '.config', 'bdl', 'resend.env'),
    path.join(os.homedir(), '.config', 'tpcl-alerts.conf'),
  ];
  for (const p of shared) {
    const t = readIfExists(p);
    if (t) Object.assign(secrets, parseEnvFile(t)); // shared files are owned by other tools; their mode is not ours to police
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('KITT_')) secrets[k] = v;
  const own = path.join(CONFIG_DIR, 'kitt.env');
  const ownText = readIfExists(own);
  if (ownText) { checkMode(own, warn); Object.assign(secrets, parseEnvFile(ownText)); }

  const paths = {
    configDir: CONFIG_DIR,
    dataDir: DATA_DIR,
    dbFile: path.join(DATA_DIR, 'kitt.sqlite'),
    audioDir: path.join(DATA_DIR, 'audio'),
    spoolDir: path.join(DATA_DIR, 'spool'),
    brainDir: path.join(CONFIG_DIR, 'brain'),
    logFile: path.join(LOG_DIR, 'kitt.log'),
    envFile: own,
    shortcutsDir: path.join(REPO_DIR, 'shortcuts'),
  };
  for (const d of [paths.dataDir, paths.audioDir, paths.spoolDir, paths.brainDir]) fs.mkdirSync(d, { recursive: true });
  return { config, secrets, paths, version: VERSION };
}

export function requireSecret(secrets, key, why) {
  const v = secrets[key];
  if (!v) throw new Error(`missing secret ${key}${why ? ` (${why})` : ''} — add it to ${path.join(CONFIG_DIR, 'kitt.env')}`);
  return v;
}
