// Structured JSON-lines logger with secret redaction. stdout only; launchd redirects to the log file.
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]{8,}/g,
  /\b(re_[A-Za-z0-9_]{10,})\b/g,              // Resend
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,        // GitHub
  /\b(sk-ant-[A-Za-z0-9\-_]{10,})\b/g,        // Anthropic
  /\b(eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b/g, // JWT
  /\b([a-f0-9]{48,})\b/g,                      // long hex tokens
];

export function redact(input) {
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  if (s == null) return s;
  for (const re of SECRET_PATTERNS) s = s.replace(re, (m) => m.slice(0, 6) + '…[redacted]');
  return s;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS[process.env.KITT_LOG_LEVEL] || LEVELS.info;

export function setLevel(name) { minLevel = LEVELS[name] || minLevel; }

function emit(level, msg, fields) {
  if (LEVELS[level] < minLevel) return;
  const rec = { ts: new Date().toISOString(), level, msg, ...(fields || {}) };
  let line;
  try { line = redact(JSON.stringify(rec)); } catch { line = redact(`${rec.ts} ${level} ${msg}`); }
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (msg, f) => emit('debug', msg, f),
  info: (msg, f) => emit('info', msg, f),
  warn: (msg, f) => emit('warn', msg, f),
  error: (msg, f) => emit('error', msg, f),
  child: (base) => ({
    debug: (m, f) => emit('debug', m, { ...base, ...f }),
    info: (m, f) => emit('info', m, { ...base, ...f }),
    warn: (m, f) => emit('warn', m, { ...base, ...f }),
    error: (m, f) => emit('error', m, { ...base, ...f }),
  }),
};
